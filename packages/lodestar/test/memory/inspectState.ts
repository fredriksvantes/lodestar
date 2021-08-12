import fs from "fs";
import {ssz} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";

const stateBytes = fs.readFileSync("prater.head.ssz");

const state = ssz.phase0.BeaconState.deserialize(stateBytes);
console.log(state.slot);

// for (const attestation of state.previousEpochAttestations) {
//   console.log(ssz.phase0.PendingAttestation.serialize(attestation).length);
// }

for (let i = 0, len = state.randaoMixes.length; i < len; i++) {
  console.log(i, toHexString(state.randaoMixes[i]));
}

// blockRoots 8192 x 32 bytes
// stateRoots 8192 x 32 bytes
// historicalRoots 114 x 32 bytes
// eth1DataVotes 611 x 72 bytes
// validators 215612 x 121 bytes
// balances 215612 x 8 bytes
// randaoMixes 65536 x 32 bytes
// slashings 8192 x 8 bytes
// previousEpochAttestations 3431 x 165 bytes
// currentEpochAttestations 2494 x 165 bytes

// block_roots: Vector[Root, SLOTS_PER_HISTORICAL_ROOT]
// state_roots: Vector[Root, SLOTS_PER_HISTORICAL_ROOT]
// historical_roots: List[Root, HISTORICAL_ROOTS_LIMIT]
// eth1_data_votes: List[Eth1Data, EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH]
// validators: List[Validator, VALIDATOR_REGISTRY_LIMIT]
// balances: List[Gwei, VALIDATOR_REGISTRY_LIMIT]
// randao_mixes: Vector[Bytes32, EPOCHS_PER_HISTORICAL_VECTOR]
// slashings: Vector[Gwei, EPOCHS_PER_SLASHINGS_VECTOR]  # Per-epoch sums of slashed effective balances
// previous_epoch_attestations: List[PendingAttestation, MAX_ATTESTATIONS * SLOTS_PER_EPOCH]
// current_epoch_attestations: List[PendingAttestation, MAX_ATTESTATIONS * SLOTS_PER_EPOCH]
