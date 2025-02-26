// eslint-disable-next-line no-restricted-imports
import {Api as IBeaconPoolApi} from "@chainsafe/lodestar-api/lib/routes/beacon/pool";
import {Epoch} from "@chainsafe/lodestar-types";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {validateGossipAttestation} from "../../../../chain/validation";
import {validateGossipAttesterSlashing} from "../../../../chain/validation/attesterSlashing";
import {validateGossipProposerSlashing} from "../../../../chain/validation/proposerSlashing";
import {validateGossipVoluntaryExit} from "../../../../chain/validation/voluntaryExit";
import {validateSyncCommitteeSigOnly} from "../../../../chain/validation/syncCommittee";
import {ApiModules} from "../../types";
import {OpSource} from "../../../../metrics/validatorMonitor";

export function getBeaconPoolApi({
  chain,
  logger,
  metrics,
  network,
  db,
}: Pick<ApiModules, "chain" | "logger" | "metrics" | "network" | "db">): IBeaconPoolApi {
  return {
    async getPoolAttestations(filters) {
      // Already filtered by slot
      let attestations = chain.aggregatedAttestationPool.getAll(filters?.slot);

      if (filters?.committeeIndex !== undefined) {
        attestations = attestations.filter((attestation) => filters.committeeIndex === attestation.data.index);
      }

      return {data: attestations};
    },

    async getPoolAttesterSlashings() {
      return {data: await db.attesterSlashing.values()};
    },

    async getPoolProposerSlashings() {
      return {data: await db.proposerSlashing.values()};
    },

    async getPoolVoluntaryExits() {
      return {data: await db.voluntaryExit.values()};
    },

    async submitPoolAttestations(attestations) {
      const seenTimestampSec = Date.now() / 1000;
      const errors: Error[] = [];

      await Promise.all(
        attestations.map(async (attestation, i) => {
          try {
            const {indexedAttestation, subnet} = await validateGossipAttestation(chain, attestation, null);

            metrics?.registerUnaggregatedAttestation(OpSource.api, seenTimestampSec, indexedAttestation);

            await Promise.all([
              network.gossip.publishBeaconAttestation(attestation, subnet),
              chain.attestationPool.add(attestation),
            ]);
          } catch (e) {
            errors.push(e);
            logger.error(
              `Error on submitPoolAttestations [${i}]`,
              {slot: attestation.data.slot, index: attestation.data.index},
              e
            );
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on submitPoolAttestations\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },

    async submitPoolAttesterSlashing(slashing) {
      await validateGossipAttesterSlashing(chain, db, slashing);
      await Promise.all([network.gossip.publishAttesterSlashing(slashing), db.attesterSlashing.add(slashing)]);
    },

    async submitPoolProposerSlashing(slashing) {
      await validateGossipProposerSlashing(chain, db, slashing);
      await Promise.all([network.gossip.publishProposerSlashing(slashing), db.proposerSlashing.add(slashing)]);
    },

    async submitPoolVoluntaryExit(exit) {
      await validateGossipVoluntaryExit(chain, db, exit);
      await Promise.all([network.gossip.publishVoluntaryExit(exit), db.voluntaryExit.add(exit)]);
    },

    /**
     * POST `/eth/v1/beacon/pool/sync_committees`
     *
     * Submits sync committee signature objects to the node.
     * Sync committee signatures are not present in phase0, but are required for Altair networks.
     * If a sync committee signature is validated successfully the node MUST publish that sync committee signature on all applicable subnets.
     * If one or more sync committee signatures fail validation the node MUST return a 400 error with details of which sync committee signatures have failed, and why.
     *
     * https://github.com/ethereum/eth2.0-APIs/pull/135
     */
    async submitPoolSyncCommitteeSignatures(signatures) {
      // Fetch states for all slots of the `signatures`
      const slots = new Set<Epoch>();
      for (const signature of signatures) {
        slots.add(signature.slot);
      }

      // TODO: Fetch states at signature slots
      const state = chain.getHeadState();

      // TODO: Cache this value
      const SYNC_COMMITTEE_SUBNET_SIZE = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);

      const errors: Error[] = [];

      await Promise.all(
        signatures.map(async (signature, i) => {
          try {
            const synCommittee = allForks.getIndexedSyncCommittee(state, signature.slot);
            const indexesInCommittee = synCommittee.validatorIndexMap.get(signature.validatorIndex);
            if (indexesInCommittee === undefined || indexesInCommittee.length === 0) {
              return; // Not a sync committee member
            }

            // Verify signature only, all other data is very likely to be correct, since the `signature` object is created by this node.
            // Worst case if `signature` is not valid, gossip peers will drop it and slightly downscore us.
            await validateSyncCommitteeSigOnly(chain, state, signature);

            await Promise.all(
              indexesInCommittee.map(async (indexInCommittee) => {
                // Sync committee subnet members are just sequential in the order they appear in SyncCommitteeIndexes array
                const subnet = Math.floor(indexInCommittee / SYNC_COMMITTEE_SUBNET_SIZE);
                const indexInSubCommittee = indexInCommittee % SYNC_COMMITTEE_SUBNET_SIZE;
                chain.syncCommitteeMessagePool.add(subnet, signature, indexInSubCommittee);
                await network.gossip.publishSyncCommitteeSignature(signature, subnet);
              })
            );
          } catch (e) {
            errors.push(e);
            logger.error(
              `Error on submitPoolSyncCommitteeSignatures [${i}]`,
              {slot: signature.slot, validatorIndex: signature.validatorIndex},
              e
            );
          }
        })
      );

      if (errors.length > 1) {
        throw Error("Multiple errors on publishAggregateAndProofs\n" + errors.map((e) => e.message).join("\n"));
      } else if (errors.length === 1) {
        throw errors[0];
      }
    },
  };
}
