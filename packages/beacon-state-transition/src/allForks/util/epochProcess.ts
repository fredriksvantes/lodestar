import {Epoch, ValidatorIndex, Gwei, phase0, allForks} from "@chainsafe/lodestar-types";
import {readonlyValues} from "@chainsafe/ssz";
import {intDiv} from "@chainsafe/lodestar-utils";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_SLASHINGS_VECTOR,
  FAR_FUTURE_EPOCH,
  ForkName,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";

import {isActiveValidator} from "../../util";
import {
  IAttesterStatus,
  createIAttesterStatus,
  hasMarkers,
  FLAG_UNSLASHED,
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_SOURCE_ATTESTER,
  FLAG_PREV_TARGET_ATTESTER,
  FLAG_PREV_HEAD_ATTESTER,
  FLAG_CURR_SOURCE_ATTESTER,
  FLAG_CURR_TARGET_ATTESTER,
  FLAG_CURR_HEAD_ATTESTER,
} from "./attesterStatus";
import {IEpochStakeSummary} from "./epochStakeSummary";
import {CachedBeaconState} from "./cachedBeaconState";
import {statusProcessEpoch} from "../../phase0/epoch/processPendingAttestations";
import {computeBaseRewardPerIncrement} from "../../altair/util/misc";

/**
 * Pre-computed disposable data to process epoch transitions faster at the cost of more memory.
 *
 * The AttesterStatus (and FlatValidator under status.validator) objects and
 * EpochStakeSummary are tracked in the IEpochProcess and made available as additional context in the
 * epoch transition.
 *
 * Block processing:
 * - Does not need to iterate over validators or balances
 *
 * Epoch processing:
 * - processRewardsAndPenalties() mutates almost all the state.balances array
 * - processSlashings() mutates some of state.balances
 * - processEffectiveBalanceUpdates() needs to iterate over all state.balances (readonly)
 * - processRegistryUpdates() needs to mutate state.validator but only sparsly or not at all
 *
 * About balances in epoch processing:
 * | epoch process fn                    | balances action |
 * | ----------------------------------- | --------------- |
 * | processJustificationAndFinalization | -
 * | processInactivityUpdates (altair)   | -
 * | processRewardsAndPenalties          | read + write all
 * | processRegistryUpdates              | -
 * | processSlashings                    | read + write a few
 * | processEth1DataReset                | -
 * | processEffectiveBalanceUpdates      | read all
 * | processSlashingsReset               | -
 * | processRandaoMixesReset             | -
 * | processHistoricalRootsUpdate        | -
 * | processParticipationRecordUpdates   | -
 * | processSyncCommitteeUpdates         | -
 *
 * So the strategy with state.balances:
 * 1. Create a flag balances array before epoch processing
 * 2. Mutate flat balances only in processRewardsAndPenalties() and processSlashings()
 * 3. In processEffectiveBalanceUpdates() read from flat balances
 * 4. After epoch transition, create the balances tree again from scratch
 */
export interface IEpochProcess {
  prevEpoch: Epoch;
  currentEpoch: Epoch;
  totalActiveStake: Gwei;
  /** For altair */
  baseRewardPerIncrement: Gwei;
  prevEpochUnslashedStake: IEpochStakeSummary;
  currEpochUnslashedTargetStake: Gwei;
  /**
   * Indices which will receive the slashing penalty
   * ```
   * v.withdrawableEpoch === currentEpoch + EPOCHS_PER_SLASHINGS_VECTOR / 2
   * ```
   * There's a practical limitation in number of possible validators slashed by epoch, which would share the same
   * withdrawableEpoch. Note that after some count exitChurn would advance the withdrawableEpoch.
   * ```
   * maxSlashedPerSlot = SLOTS_PER_EPOCH * (MAX_PROPOSER_SLASHINGS + MAX_ATTESTER_SLASHINGS * bits)
   * ```
   * For current mainnet conditions (bits = 128) that's `maxSlashedPerSlot = 8704`.
   * For less than 327680 validators, churnLimit = 4 (minimum possible)
   * For exitChurn to overtake the slashing delay, there should be
   * ```
   * churnLimit * (EPOCHS_PER_SLASHINGS_VECTOR / 2 - 1 - MAX_SEED_LOOKAHEAD)
   * ```
   * For mainnet conditions that's 16364 validators. So the limiting factor is the max operations on the block. Note
   * that on average indicesToSlash must contain churnLimit validators (4), but it can spike to a max of 8704 in a
   * single epoch if there haven't been exits in a while and there's a massive attester slashing at once of validators
   * that happen to be in the same committee, which is very unlikely.
   */
  indicesToSlash: ValidatorIndex[];
  /**
   * Indices of validators that just joinned and will be eligible for the active queue.
   * ```
   * v.activationEligibilityEpoch === FAR_FUTURE_EPOCH && v.effectiveBalance === MAX_EFFECTIVE_BALANCE
   * ```
   * All validators in indicesEligibleForActivationQueue get activationEligibilityEpoch set. So it can only include
   * validators that have just joinned the registry through a valid full deposit(s).
   * ```
   * max indicesEligibleForActivationQueue = SLOTS_PER_EPOCH * MAX_DEPOSITS
   * ```
   * For mainnet spec = 512
   */
  indicesEligibleForActivationQueue: ValidatorIndex[];
  /**
   * Indices of validators that may become active once churn and finaly allow.
   * ```
   * v.activationEpoch === FAR_FUTURE_EPOCH && v.activationEligibilityEpoch <= currentEpoch
   * ```
   * Many validators could be on indicesEligibleForActivation, but only up to churnLimit will be activated.
   * For less than 327680 validators, churnLimit = 4 (minimum possible), so max processed is 4.
   */
  indicesEligibleForActivation: ValidatorIndex[];
  /**
   * Indices of validators that will be ejected due to low balance.
   * ```
   * status.active && v.exitEpoch === FAR_FUTURE_EPOCH && v.effectiveBalance <= config.EJECTION_BALANCE
   * ```
   * Potentially the entire validator set could be added to indicesToEject, and all validators in the array will have
   * their validator object mutated. Exit queue churn delays exit, but the object is mutated immediately.
   */
  indicesToEject: ValidatorIndex[];
  // to be used for rotateEpochs()
  nextEpochActiveValidatorIndices: ValidatorIndex[];

  // Flat arrays for fast iteration
  statusesFlat: IAttesterStatus[];
  // TODO: Benchmark using a BigUint64Array instead
  balancesFlat: Gwei[];
}

/**
 * Runs just before running an epoch transition on state. It is used to prepare data required to run an epoch transition
 * faster at the cost of added memory. When the epoch transition is over, rotateEpochs() is called, which would be the
 * other hook:
 * ```
 * beforeProcessEpoch() // before epoch transition hook
 * epochTransition()
 * rotateEpochs() // after epoch transition hook
 * ```
 */
export function beforeProcessEpoch<T extends allForks.BeaconState>(state: CachedBeaconState<T>): IEpochProcess {
  const {config, epochCtx} = state;
  const forkName = config.getForkName(state.slot);
  const currentEpoch = epochCtx.currentShuffling.epoch;
  const prevEpoch = epochCtx.previousShuffling.epoch;
  const nextEpoch = currentEpoch + 1;

  const indicesToSlash: ValidatorIndex[] = [];
  const indicesEligibleForActivationQueue: ValidatorIndex[] = [];
  const indicesEligibleForActivation: ValidatorIndex[] = [];
  const indicesToEject: ValidatorIndex[] = [];
  const nextEpochActiveValidatorIndices: ValidatorIndex[] = [];

  // TODO: Investigate faster ways to convert to and from
  // TODO - SLOW CODE - 🐢
  const balancesFlat = Array.from(readonlyValues(state.balances));

  const statuses: IAttesterStatus[] = [];

  const slashingsEpoch = currentEpoch + intDiv(EPOCHS_PER_SLASHINGS_VECTOR, 2);

  let totalActiveStake = BigInt(0);

  // If it's too slow, consider having a persistent-ts array of references to the validator nodes for faster indexing
  // Reading 250_000 leaf nodes from a depth 40 tree costs ~50ms, it's pretty cheap
  // TODO: Use readonlyAllValues()
  // TODO - SLOW CODE - 🐢
  const validators: phase0.Validator[] = Array.from(readonlyValues(state.validators));
  const validatorCount = validators.length;

  for (let i = 0; i < validatorCount; i++) {
    // TODO - SLOW CODE - 🐢🐢🐢🐢🐢🐢🐢🐢🐢
    // Use a struct representation in the leaf nodes of the validators tree to have fast reads and slow writes
    const validator = validators[i].valueOf() as typeof validators[0];
    const status = createIAttesterStatus();

    if (validator.slashed) {
      if (slashingsEpoch === validator.withdrawableEpoch) {
        indicesToSlash.push(i);
      }
    } else {
      status.flags |= FLAG_UNSLASHED;
    }

    if (isActiveValidator(validator, prevEpoch) || (validator.slashed && prevEpoch + 1 < validator.withdrawableEpoch)) {
      status.flags |= FLAG_ELIGIBLE_ATTESTER;
    }

    const active = isActiveValidator(validator, currentEpoch);
    if (active) {
      status.active = true;
      totalActiveStake += validator.effectiveBalance;
    }

    // To optimize process_registry_updates():
    // ```python
    // def is_eligible_for_activation_queue(validator: Validator) -> bool:
    //   return (
    //     validator.activation_eligibility_epoch == FAR_FUTURE_EPOCH
    //     and validator.effective_balance == MAX_EFFECTIVE_BALANCE
    //   )
    // ```
    if (
      validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH &&
      validator.effectiveBalance === MAX_EFFECTIVE_BALANCE
    ) {
      indicesEligibleForActivationQueue.push(i);
    }

    // To optimize process_registry_updates():
    // ```python
    // def is_eligible_for_activation(state: BeaconState, validator: Validator) -> bool:
    //   return (
    //     validator.activation_eligibility_epoch <= state.finalized_checkpoint.epoch  # Placement in queue is finalized
    //     and validator.activation_epoch == FAR_FUTURE_EPOCH                          # Has not yet been activated
    //   )
    // ```
    // Here we have to check if `activationEligibilityEpoch <= currentEpoch` instead of finalized checkpoint, because the finalized
    // checkpoint may change during epoch processing at processJustificationAndFinalization(), which is called before processRegistryUpdates().
    // Then in processRegistryUpdates() we will check `activationEligibilityEpoch <= finalityEpoch`. This is to keep the array small.
    //
    // Use `else` since indicesEligibleForActivationQueue + indicesEligibleForActivation are mutually exclusive
    else if (validator.activationEpoch === FAR_FUTURE_EPOCH && validator.activationEligibilityEpoch <= currentEpoch) {
      indicesEligibleForActivation.push(i);
    }

    // To optimize process_registry_updates():
    // ```python
    // if is_active_validator(validator, get_current_epoch(state)) and validator.effective_balance <= EJECTION_BALANCE:
    // ```
    // Adding extra condition `exitEpoch === FAR_FUTURE_EPOCH` to keep the array as small as possible. initiateValidatorExit() will ignore them anyway
    //
    // Use `else` since indicesEligibleForActivationQueue + indicesEligibleForActivation + indicesToEject are mutually exclusive
    else if (
      active &&
      validator.exitEpoch === FAR_FUTURE_EPOCH &&
      validator.effectiveBalance <= config.EJECTION_BALANCE
    ) {
      indicesToEject.push(i);
    }

    statuses.push(status);
    if (isActiveValidator(validator, nextEpoch)) {
      nextEpochActiveValidatorIndices.push(i);
    }
  }

  if (totalActiveStake < EFFECTIVE_BALANCE_INCREMENT) {
    totalActiveStake = EFFECTIVE_BALANCE_INCREMENT;
  }

  // SPEC: function getBaseRewardPerIncrement()
  const baseRewardPerIncrement = computeBaseRewardPerIncrement(totalActiveStake);

  // To optimize process_registry_updates():
  // order by sequence of activationEligibilityEpoch setting and then index
  indicesEligibleForActivation.sort(
    (a, b) => validators[a].activationEligibilityEpoch - validators[b].activationEligibilityEpoch || a - b
  );

  if (forkName === ForkName.phase0) {
    statusProcessEpoch(
      state,
      statuses,
      ((state as unknown) as CachedBeaconState<phase0.BeaconState>).previousEpochAttestations,
      prevEpoch,
      FLAG_PREV_SOURCE_ATTESTER,
      FLAG_PREV_TARGET_ATTESTER,
      FLAG_PREV_HEAD_ATTESTER
    );
    statusProcessEpoch(
      state,
      statuses,
      ((state as unknown) as CachedBeaconState<phase0.BeaconState>).currentEpochAttestations,
      currentEpoch,
      FLAG_CURR_SOURCE_ATTESTER,
      FLAG_CURR_TARGET_ATTESTER,
      FLAG_CURR_HEAD_ATTESTER
    );
  } else {
    state.previousEpochParticipation.forEachStatus((status, i) => {
      statuses[i].flags |=
        ((status.timelySource && FLAG_PREV_SOURCE_ATTESTER) as number) |
        ((status.timelyTarget && FLAG_PREV_TARGET_ATTESTER) as number) |
        ((status.timelyHead && FLAG_PREV_HEAD_ATTESTER) as number);
    });
    state.currentEpochParticipation.forEachStatus((status, i) => {
      statuses[i].flags |=
        ((status.timelySource && FLAG_CURR_SOURCE_ATTESTER) as number) |
        ((status.timelyTarget && FLAG_CURR_TARGET_ATTESTER) as number) |
        ((status.timelyHead && FLAG_CURR_HEAD_ATTESTER) as number);
    });
  }

  let prevSourceUnslStake = BigInt(0);
  let prevTargetUnslStake = BigInt(0);
  let prevHeadUnslStake = BigInt(0);

  let currTargetUnslStake = BigInt(0);

  const FLAG_PREV_SOURCE_ATTESTER_UNSLASHED = FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
  const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED;
  const FLAG_PREV_HEAD_ATTESTER_UNSLASHED = FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED;
  const FLAG_CURR_TARGET_UNSLASHED = FLAG_CURR_TARGET_ATTESTER | FLAG_UNSLASHED;

  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    const effectiveBalance = epochCtx.effectiveBalances.get(i)!;

    if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER_UNSLASHED)) {
      prevSourceUnslStake += effectiveBalance;
    }
    if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
      prevTargetUnslStake += effectiveBalance;
    }
    if (hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER_UNSLASHED)) {
      prevHeadUnslStake += effectiveBalance;
    }
    if (hasMarkers(status.flags, FLAG_CURR_TARGET_UNSLASHED)) {
      currTargetUnslStake += effectiveBalance;
    }
  }
  // As per spec of `get_total_balance`:
  // EFFECTIVE_BALANCE_INCREMENT Gwei minimum to avoid divisions by zero.
  // Math safe up to ~10B ETH, afterwhich this overflows uint64.
  const increment = EFFECTIVE_BALANCE_INCREMENT;
  if (prevSourceUnslStake < increment) prevSourceUnslStake = increment;
  if (prevTargetUnslStake < increment) prevTargetUnslStake = increment;
  if (prevHeadUnslStake < increment) prevHeadUnslStake = increment;
  if (currTargetUnslStake < increment) currTargetUnslStake = increment;

  return {
    prevEpoch,
    currentEpoch,
    totalActiveStake,

    baseRewardPerIncrement,
    prevEpochUnslashedStake: {
      sourceStake: prevSourceUnslStake,
      targetStake: prevTargetUnslStake,
      headStake: prevHeadUnslStake,
    },
    currEpochUnslashedTargetStake: currTargetUnslStake,
    indicesToSlash,
    indicesEligibleForActivationQueue,
    indicesEligibleForActivation,
    indicesToEject,
    nextEpochActiveValidatorIndices,

    statusesFlat: statuses,
    balancesFlat,
  };
}
