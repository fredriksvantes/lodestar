import {allForks} from "@chainsafe/lodestar-types";
import {bigIntMin} from "@chainsafe/lodestar-utils";
import {readonlyValues} from "@chainsafe/ssz";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkName,
  PROPORTIONAL_SLASHING_MULTIPLIER,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR,
} from "@chainsafe/lodestar-params";

import {decreaseBalance} from "../../util";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";

/**
 * Update validator registry for validators that activate + exit
 *
 * PERF: Cost 'proportional' to only validators that are slashed. For mainnet conditions:
 * - indicesToSlash: max len is 8704. But it's very unlikely since it would require all validators on the same
 *   committees to sign slashable attestations.
 */
export function processSlashingsAllForks(
  fork: ForkName,
  state: CachedBeaconState<allForks.BeaconState>,
  epochProcess: IEpochProcess
): void {
  // No need to compute totalSlashings if there no index to slash
  if (epochProcess.indicesToSlash.length === 0) {
    return;
  }

  const totalBalance = epochProcess.totalActiveStake;
  // TODO: Use readonlyAllValues()
  let totalSlashings = BigInt(0);
  for (const slashing of readonlyValues(state.slashings)) {
    totalSlashings += slashing;
  }

  const proportionalSlashingMultiplier =
    fork === ForkName.phase0 ? PROPORTIONAL_SLASHING_MULTIPLIER : PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR;

  const adjustedTotalSlashingBalance = bigIntMin(totalSlashings * proportionalSlashingMultiplier, totalBalance);
  const increment = EFFECTIVE_BALANCE_INCREMENT;
  for (const index of epochProcess.indicesToSlash) {
    const effectiveBalance = state.epochCtx.effectiveBalances.get(index)!;

    const penaltyNumerator = (effectiveBalance / increment) * adjustedTotalSlashingBalance;
    const penalty = (penaltyNumerator / totalBalance) * increment;

    // In all forks processSlashings() is called after processRewardsAndPenalties() but before processEffectiveBalanceUpdates()
    // The changes done here must apply to both the state and balances array mutated in processRewardsAndPenalties()
    decreaseBalance(state, index, penalty);
  }
}
