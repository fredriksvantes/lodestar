/**
 * @module chain
 */

import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconState, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {allForks, ForkDigest, Number64, Root, phase0, Slot} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {TreeBacked} from "@chainsafe/ssz";
import {LightClientUpdater} from "@chainsafe/lodestar-light-client/server";
import {AbortController} from "@chainsafe/abort-controller";
import {GENESIS_EPOCH, ZERO_HASH} from "../constants";
import {IBeaconDb} from "../db";
import {CheckpointStateCache, StateContextCache} from "./stateCache";
import {IMetrics} from "../metrics";
import {BlockPool, BlockProcessor} from "./blocks";
import {IBeaconClock, LocalClock} from "./clock";
import {ChainEventEmitter} from "./emitter";
import {handleChainEvents} from "./eventHandlers";
import {IBeaconChain} from "./interface";
import {IChainOptions} from "./options";
import {IStateRegenerator, QueuedStateRegenerator} from "./regen";
import {LodestarForkChoice} from "./forkChoice";
import {restoreStateCaches} from "./initState";
import {IBlsVerifier, BlsSingleThreadVerifier, BlsMultiThreadWorkerPool} from "./bls";
import {SeenAttesters, SeenAggregators, SeenSyncCommitteeMessages, SeenContributionAndProof} from "./seenCache";
import {AttestationPool, SyncCommitteeMessagePool, SyncContributionAndProofPool} from "./opPools";
import {ForkDigestContext, IForkDigestContext} from "../util/forkDigestContext";
import {LightClientIniter} from "./lightClient";
import {AggregatedAttestationPool} from "./opPools/aggregatedAttestationPool";

export interface IBeaconChainModules {
  config: IBeaconConfig;
  db: IBeaconDb;
  logger: ILogger;
  metrics: IMetrics | null;
  anchorState: TreeBacked<allForks.BeaconState>;
}

export class BeaconChain implements IBeaconChain {
  readonly genesisTime: Number64;
  readonly genesisValidatorsRoot: Root;

  bls: IBlsVerifier;
  forkChoice: IForkChoice;
  clock: IBeaconClock;
  emitter = new ChainEventEmitter();
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  regen: IStateRegenerator;
  pendingBlocks: BlockPool;
  forkDigestContext: IForkDigestContext;
  lightclientUpdater: LightClientUpdater;
  lightClientIniter: LightClientIniter;

  // Ops pool
  readonly attestationPool = new AttestationPool();
  readonly aggregatedAttestationPool = new AggregatedAttestationPool();
  readonly syncCommitteeMessagePool = new SyncCommitteeMessagePool();
  readonly syncContributionAndProofPool = new SyncContributionAndProofPool();

  // Gossip seen cache
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof = new SeenContributionAndProof();

  protected readonly blockProcessor: BlockProcessor;
  protected readonly config: IBeaconConfig;
  protected readonly db: IBeaconDb;
  protected readonly logger: ILogger;
  protected readonly metrics: IMetrics | null;
  protected readonly opts: IChainOptions;
  /**
   * Internal event emitter is used internally to the chain to update chain state
   * Once event have been handled internally, they are re-emitted externally for downstream consumers
   */
  protected internalEmitter = new ChainEventEmitter();
  private abortController = new AbortController();

  constructor(opts: IChainOptions, {config, db, logger, metrics, anchorState}: IBeaconChainModules) {
    this.opts = opts;
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.metrics = metrics;
    this.genesisTime = anchorState.genesisTime;
    this.genesisValidatorsRoot = anchorState.genesisValidatorsRoot.valueOf() as Uint8Array;

    this.forkDigestContext = new ForkDigestContext(config, this.genesisValidatorsRoot);

    const signal = this.abortController.signal;
    const emitter = this.internalEmitter; // All internal compoments emit to the internal emitter first
    const bls = opts.useSingleThreadVerifier
      ? new BlsSingleThreadVerifier()
      : new BlsMultiThreadWorkerPool({logger, metrics, signal: this.abortController.signal});

    const clock = new LocalClock({config, emitter, genesisTime: this.genesisTime, signal});
    const stateCache = new StateContextCache();
    const checkpointStateCache = new CheckpointStateCache();
    const cachedState = restoreStateCaches(config, stateCache, checkpointStateCache, anchorState);
    const forkChoice = new LodestarForkChoice({
      config,
      emitter,
      currentSlot: clock.currentSlot,
      state: cachedState,
      metrics,
    });
    const regen = new QueuedStateRegenerator({
      config,
      emitter,
      forkChoice,
      stateCache,
      checkpointStateCache,
      db,
      metrics,
      signal,
    });
    this.pendingBlocks = new BlockPool(config, logger);
    this.blockProcessor = new BlockProcessor({
      config,
      forkChoice,
      clock,
      regen,
      bls,
      metrics,
      emitter,
      checkpointStateCache,
      signal,
      opts,
    });

    this.forkChoice = forkChoice;
    this.clock = clock;
    this.regen = regen;
    this.bls = bls;
    this.checkpointStateCache = checkpointStateCache;
    this.stateCache = stateCache;

    this.lightclientUpdater = new LightClientUpdater(this.db);
    this.lightClientIniter = new LightClientIniter({config: this.config, forkChoice, db: this.db, stateCache});

    handleChainEvents.bind(this)(this.abortController.signal);
  }

  close(): void {
    this.abortController.abort();
    this.stateCache.clear();
    this.checkpointStateCache.clear();
  }

  getGenesisTime(): Number64 {
    return this.genesisTime;
  }

  getHeadState(): CachedBeaconState<allForks.BeaconState> {
    // head state should always exist
    const head = this.forkChoice.getHead();
    const headState =
      this.checkpointStateCache.getLatest({
        root: head.blockRoot,
        epoch: Infinity,
      }) || this.stateCache.get(head.stateRoot);
    if (!headState) throw Error("headState does not exist");
    return headState;
  }

  async getHeadStateAtCurrentEpoch(): Promise<CachedBeaconState<allForks.BeaconState>> {
    const currentEpochStartSlot = computeStartSlotAtEpoch(this.clock.currentEpoch);
    const head = this.forkChoice.getHead();
    const bestSlot = currentEpochStartSlot > head.slot ? currentEpochStartSlot : head.slot;
    return await this.regen.getBlockSlotState(head.blockRoot, bestSlot);
  }

  async getHeadStateAtCurrentSlot(): Promise<CachedBeaconState<allForks.BeaconState>> {
    return await this.regen.getBlockSlotState(this.forkChoice.getHeadRoot(), this.clock.currentSlot);
  }

  async getHeadBlock(): Promise<allForks.SignedBeaconBlock | null> {
    const headSummary = this.forkChoice.getHead();
    const unfinalizedBlock = await this.db.block.get(headSummary.blockRoot);
    if (unfinalizedBlock) {
      return unfinalizedBlock;
    }
    return await this.db.blockArchive.get(headSummary.slot);
  }

  async getCanonicalBlockAtSlot(slot: Slot): Promise<allForks.SignedBeaconBlock | null> {
    const finalizedBlock = this.forkChoice.getFinalizedBlock();
    if (finalizedBlock.slot > slot) {
      return this.db.blockArchive.get(slot);
    }
    const summary = this.forkChoice.getCanonicalBlockSummaryAtSlot(slot);
    if (!summary) {
      return null;
    }
    return await this.db.block.get(summary.blockRoot);
  }

  async getStateByBlockRoot(blockRoot: Root): Promise<CachedBeaconState<allForks.BeaconState> | null> {
    const blockSummary = this.forkChoice.getBlock(blockRoot);
    if (!blockSummary) {
      return null;
    }
    try {
      return await this.regen.getState(blockSummary.stateRoot);
    } catch (e) {
      return null;
    }
  }

  /** Returned blocks have the same ordering as `slots` */
  async getUnfinalizedBlocksAtSlots(slots: Slot[]): Promise<allForks.SignedBeaconBlock[]> {
    if (slots.length === 0) {
      return [];
    }

    const slotsSet = new Set(slots);
    const blockRootsPerSlot = new Map<Slot, Promise<allForks.SignedBeaconBlock | null>>();

    // these blocks are on the same chain to head
    for (const summary of this.forkChoice.iterateBlockSummaries(this.forkChoice.getHeadRoot())) {
      if (slotsSet.has(summary.slot)) {
        blockRootsPerSlot.set(summary.slot, this.db.block.get(summary.blockRoot));
      }
    }

    const unfinalizedBlocks = await Promise.all(slots.map((slot) => blockRootsPerSlot.get(slot)));
    return unfinalizedBlocks.filter((block): block is allForks.SignedBeaconBlock => block != null);
  }

  getFinalizedCheckpoint(): phase0.Checkpoint {
    return this.forkChoice.getFinalizedCheckpoint();
  }

  receiveBlock(signedBlock: allForks.SignedBeaconBlock, trusted = false): void {
    this.blockProcessor
      .processBlockJob({
        signedBlock,
        reprocess: false,
        prefinalized: trusted,
        validSignatures: trusted,
        validProposerSignature: trusted,
      })
      .catch(() => /* unreachable */ ({}));
  }

  async processBlock(
    signedBlock: allForks.SignedBeaconBlock,
    {prefinalized, trusted = false}: {prefinalized: boolean; trusted: boolean}
  ): Promise<void> {
    return await this.blockProcessor.processBlockJob({
      signedBlock,
      reprocess: false,
      prefinalized,
      validSignatures: trusted,
      validProposerSignature: trusted,
    });
  }

  async processChainSegment(
    signedBlocks: allForks.SignedBeaconBlock[],
    {prefinalized, trusted = false}: {prefinalized: boolean; trusted: boolean}
  ): Promise<void> {
    return await this.blockProcessor.processChainSegment({
      signedBlocks,
      reprocess: false,
      prefinalized,
      validSignatures: trusted,
      validProposerSignature: trusted,
    });
  }

  getHeadForkName(): ForkName {
    return this.config.getForkName(this.forkChoice.getHead().slot);
  }
  getClockForkName(): ForkName {
    return this.config.getForkName(this.clock.currentSlot);
  }
  getHeadForkDigest(): ForkDigest {
    return this.forkDigestContext.forkName2ForkDigest(this.getHeadForkName());
  }
  getClockForkDigest(): ForkDigest {
    return this.forkDigestContext.forkName2ForkDigest(this.getClockForkName());
  }

  getStatus(): phase0.Status {
    const head = this.forkChoice.getHead();
    const finalizedCheckpoint = this.forkChoice.getFinalizedCheckpoint();
    return {
      // fork_digest: The node's ForkDigest (compute_fork_digest(current_fork_version, genesis_validators_root)) where
      // - current_fork_version is the fork version at the node's current epoch defined by the wall-clock time (not necessarily the epoch to which the node is sync)
      // - genesis_validators_root is the static Root found in state.genesis_validators_root
      forkDigest: this.forkDigestContext.forkName2ForkDigest(this.config.getForkName(this.clock.currentSlot)),
      // finalized_root: state.finalized_checkpoint.root for the state corresponding to the head block (Note this defaults to Root(b'\x00' * 32) for the genesis finalized checkpoint).
      finalizedRoot: finalizedCheckpoint.epoch === GENESIS_EPOCH ? ZERO_HASH : finalizedCheckpoint.root,
      finalizedEpoch: finalizedCheckpoint.epoch,
      headRoot: head.blockRoot,
      headSlot: head.slot,
    };
  }
}
