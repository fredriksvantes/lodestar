import {BLSPubkey, Slot} from "@chainsafe/lodestar-types";
import {prettyBytes} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "@chainsafe/lodestar-api";
import {IClock, extendError, ILoggerVc} from "../util";
import {ValidatorStore} from "./validatorStore";
import {BlockDutiesService, GENESIS_SLOT} from "./blockDuties";

/**
 * Service that sets up and handles validator block proposal duties.
 */
export class BlockProposingService {
  private readonly dutiesService: BlockDutiesService;

  constructor(
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly graffiti?: string
  ) {
    this.dutiesService = new BlockDutiesService(logger, api, clock, validatorStore, this.notifyBlockProductionFn);
  }

  /**
   * `BlockDutiesService` must call this fn to trigger block creation
   * This function may run more than once at a time, rationale in `BlockDutiesService.pollBeaconProposers`
   */
  private notifyBlockProductionFn = (slot: Slot, proposers: BLSPubkey[]): void => {
    if (slot <= GENESIS_SLOT) {
      this.logger.debug("Not producing block before or at genesis slot");
      return;
    }

    if (proposers.length > 1) {
      this.logger.warn("Multiple block proposers", {slot, count: proposers.length});
    }

    Promise.all(proposers.map((pubkey) => this.createAndPublishBlock(pubkey, slot))).catch((e) => {
      this.logger.error("Error on block duties", {slot}, e);
    });
  };

  /** Produce a block at the given slot for pubkey */
  private async createAndPublishBlock(pubkey: BLSPubkey, slot: Slot): Promise<void> {
    const pubkeyHex = toHexString(pubkey);
    const logCtx = {slot, validator: prettyBytes(pubkeyHex)};

    // Wrap with try catch here to re-use `logCtx`
    try {
      const randaoReveal = await this.validatorStore.signRandao(pubkey, slot);
      const graffiti = this.graffiti || "";

      this.logger.debug("Producing block", logCtx);
      const block = await this.api.validator.produceBlock(slot, randaoReveal, graffiti).catch((e) => {
        throw extendError(e, "Failed to produce block");
      });
      this.logger.debug("Produced block", logCtx);

      const signedBlock = await this.validatorStore.signBlock(pubkey, block.data, slot);
      await this.api.beacon.publishBlock(signedBlock).catch((e) => {
        throw extendError(e, "Failed to publish block");
      });
      this.logger.info("Published block", {...logCtx, graffiti});
    } catch (e) {
      this.logger.error("Error proposing block", logCtx, e);
    }
  }
}
