import {phase0, ssz} from "@chainsafe/lodestar-types";
import {
  getPubkeys,
  buildPerformanceStateAllForks,
  addPendingAttestations,
} from "../../../beacon-state-transition/test/perf/util";
import {init} from "@chainsafe/bls";
import {allForks} from "../../../beacon-state-transition";
import {config} from "../../../config/default";
import {TreeBacked} from "@chainsafe/ssz";

class MemoryTracker {
  prev = process.memoryUsage();

  logDiff(id: string): void {
    const curr = process.memoryUsage();
    const parts: string[] = [];
    for (const key of Object.keys(this.prev) as (keyof NodeJS.MemoryUsage)[]) {
      const prevVal = this.prev[key];
      const currVal = curr[key];
      const bytesDiff = currVal - prevVal;
      const sign = bytesDiff < 0 ? "-" : bytesDiff > 0 ? "+" : " ";
      parts.push(`${key} ${sign}${formatBytes(Math.abs(bytesDiff)).padEnd(15)}`);
    }
    this.prev = curr;
    console.log(id.padEnd(20), parts.join(" "));
  }
}

async function analyzeStateMemory(): Promise<void> {
  await init("blst-native");

  const tracker = new MemoryTracker();
  tracker.logDiff("start");

  const pubkeys = getPubkeys().pubkeys;
  tracker.logDiff("getPubkeys()");

  const defaultState = ssz.phase0.BeaconState.defaultValue();
  tracker.logDiff(".defaultValue()");

  const state = buildPerformanceStateAllForks(defaultState, pubkeys);
  tracker.logDiff("build raw state");

  addPendingAttestations(state as phase0.BeaconState);
  tracker.logDiff("addPendingAtt");

  const stateTB = ssz.phase0.BeaconState.createTreeBackedFromStruct(state as phase0.BeaconState);
  tracker.logDiff("toTreeBacked");

  const cached = allForks.createCachedBeaconState(config, stateTB);
  tracker.logDiff("CachedBeaconState");
}

analyzeStateMemory();

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}
