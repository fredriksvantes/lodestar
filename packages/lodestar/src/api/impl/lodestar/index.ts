import {routes} from "@chainsafe/lodestar-api";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {Json, toHexString} from "@chainsafe/ssz";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ssz} from "@chainsafe/lodestar-types";
import {BeaconChain, IBlockJob, IChainSegmentJob} from "../../../chain";
import {QueuedStateRegenerator, RegenRequest} from "../../../chain/regen";
import {GossipType} from "../../../network";
import {ApiModules} from "../types";

export function getLodestarApi({
  chain,
  config,
  network,
  sync,
}: Pick<ApiModules, "chain" | "config" | "network" | "sync">): routes.lodestar.Api {
  let writingHeapdump = false;

  return {
    /**
     * Get a wtfnode dump of all active handles
     * Will only load the wtfnode after the first call, and registers async hooks
     * and other listeners to the global process instance
     */
    async getWtfNode() {
      // Browser interop
      if (typeof require !== "function") throw Error("NodeJS only");

      // eslint-disable-next-line
      const wtfnode = require("wtfnode");
      const logs: string[] = [];
      function logger(...args: string[]): void {
        for (const arg of args) logs.push(arg);
      }
      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      wtfnode.setLogger("info", logger);
      wtfnode.setLogger("warn", logger);
      wtfnode.setLogger("error", logger);
      wtfnode.dump();
      return {data: logs.join("\n")};
    },

    async writeHeapdump(dirpath = ".") {
      // Browser interop
      if (typeof require !== "function") throw Error("NodeJS only");

      if (writingHeapdump) {
        throw Error("Already writing heapdump");
      }
      // Lazily import NodeJS only modules
      const fs = await import("fs");
      const v8 = await import("v8");
      const snapshotStream = v8.getHeapSnapshot();
      // It's important that the filename end with `.heapsnapshot`,
      // otherwise Chrome DevTools won't open it.
      const filepath = `${dirpath}/${new Date().toISOString()}.heapsnapshot`;
      const fileStream = fs.createWriteStream(filepath);
      try {
        writingHeapdump = true;
        await new Promise<void>((resolve) => {
          snapshotStream.pipe(fileStream);
          snapshotStream.on("end", () => {
            resolve();
          });
        });
        return {data: {filepath}};
      } finally {
        writingHeapdump = false;
      }
    },

    async getLatestWeakSubjectivityCheckpointEpoch() {
      const state = chain.getHeadState();
      return {data: allForks.getLatestWeakSubjectivityCheckpointEpoch(config, state)};
    },

    async getSyncChainsDebugState() {
      return {data: sync.getSyncChainsDebugState()};
    },

    async getGossipQueueItems(gossipType: GossipType) {
      const jobQueue = network.gossip.jobQueues[gossipType];
      if (!jobQueue) {
        throw Error(`Unknown gossipType ${gossipType}, known values: ${Object.keys(jobQueue).join(", ")}`);
      }

      return jobQueue.getItems().map((item) => {
        const [topic, message] = item.args;
        return {
          topic: topic,
          receivedFrom: message.receivedFrom,
          data: message.data,
          addedTimeMs: item.addedTimeMs,
        };
      });
    },

    async getRegenQueueItems() {
      return (chain.regen as QueuedStateRegenerator).jobQueue.getItems().map((item) => ({
        key: item.args[0].key,
        args: regenRequestToJson(config, item.args[0]),
        addedTimeMs: item.addedTimeMs,
      }));
    },

    async getBlockProcessorQueueItems() {
      return (chain as BeaconChain)["blockProcessor"].jobQueue.getItems().map((item) => {
        const [job] = item.args;
        const blocks = (job as IChainSegmentJob).signedBlocks ?? [(job as IBlockJob).signedBlock];
        return {
          blocks: blocks.map((block) => block.message.slot),
          jobOpts: {
            reprocess: job.reprocess,
            prefinalized: job.prefinalized,
            validProposerSignature: job.validProposerSignature,
            validSignatures: job.validSignatures,
          },
          addedTimeMs: item.addedTimeMs,
        };
      });
    },

    async getStateCacheItems() {
      const states = (chain as BeaconChain)["stateCache"]["cache"].values();
      return Array.from(states).map((state) => ({
        slot: state.slot,
        root: state.hashTreeRoot(),
      }));
    },

    async getCheckpointStateCacheItems() {
      const states = (chain as BeaconChain)["checkpointStateCache"]["cache"].values();
      return Array.from(states).map((state) => ({
        slot: state.slot,
        root: state.hashTreeRoot(),
      }));
    },
  };
}

function regenRequestToJson(config: IChainForkConfig, regenRequest: RegenRequest): Json {
  switch (regenRequest.key) {
    case "getBlockSlotState":
      return {
        root: toHexString(regenRequest.args[0]),
        slot: regenRequest.args[1],
      };

    case "getCheckpointState":
      return ssz.phase0.Checkpoint.toJson(regenRequest.args[0]);

    case "getPreState": {
      const slot = regenRequest.args[0].slot;
      return {
        root: toHexString(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(regenRequest.args[0])),
        slot,
      };
    }

    case "getState":
      return {
        root: toHexString(regenRequest.args[0]),
      };
  }
}
