import got from "got";
import {TreeBacked} from "@chainsafe/ssz";
import {allForks} from "@chainsafe/lodestar-types";
import {IBeaconNodeOptions} from "@chainsafe/lodestar";
// eslint-disable-next-line no-restricted-imports
import {getStateTypeFromBytes} from "@chainsafe/lodestar/lib/util/multifork";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import {IBeaconParamsUnparsed} from "../config/types";
import * as mainnet from "./mainnet";
import * as pyrmont from "./pyrmont";
import * as prater from "./prater";
import * as altairDevnet3 from "./altair-devnet-3";

export type NetworkName = "mainnet" | "pyrmont" | "prater" | "dev" | "altair-devnet-3";
export const networkNames: NetworkName[] = ["mainnet", "pyrmont", "prater", "altair-devnet-3"];
/** Networks that infura supports */
export const infuraNetworks: NetworkName[] = ["mainnet", "pyrmont", "prater"];

function getNetworkData(
  network: NetworkName
): {
  beaconParams: IBeaconParamsUnparsed;
  depositContractDeployBlock: number;
  genesisFileUrl: string | null;
  bootnodesFileUrl: string;
  bootEnrs: string[];
} {
  switch (network) {
    case "mainnet":
      return mainnet;
    case "pyrmont":
      return pyrmont;
    case "prater":
      return prater;
    case "altair-devnet-3":
      return altairDevnet3;
    default:
      throw Error(`Network not supported: ${network}`);
  }
}

export function getEth1ProviderUrl(networkId: number): string {
  switch (networkId) {
    case 1:
      return "https://mainnet.infura.io/v3/84842078b09946638c03157f83405213";
    case 5:
      return "https://goerli.infura.io/v3/84842078b09946638c03157f83405213";
    default:
      throw Error(`Eth1 network not supported: ${networkId}`);
  }
}

export function getNetworkBeaconParams(network: NetworkName): IBeaconParamsUnparsed {
  return getNetworkData(network).beaconParams;
}

export function getNetworkBeaconNodeOptions(network: NetworkName): RecursivePartial<IBeaconNodeOptions> {
  const {depositContractDeployBlock, bootEnrs, beaconParams} = getNetworkData(network);
  const networkId = parseInt((beaconParams.DEPOSIT_NETWORK_ID || 1) as string, 10);
  return {
    eth1: {
      providerUrls: [getEth1ProviderUrl(networkId)],
      depositContractDeployBlock,
    },
    network: {
      discv5: {
        enabled: true,
        bootEnrs,
      },
    },
  };
}

/**
 * Get genesisStateFile URL to download. Returns null if not available
 */
export function getGenesisFileUrl(network: NetworkName): string | null {
  return getNetworkData(network).genesisFileUrl;
}

/**
 * Fetches the latest list of bootnodes for a network
 * Bootnodes file is expected to contain bootnode ENR's concatenated by newlines
 */
export async function fetchBootnodes(network: NetworkName): Promise<string[]> {
  const bootnodesFileUrl = getNetworkData(network).bootnodesFileUrl;
  const bootnodesFile = await got.get(bootnodesFileUrl).text();

  const enrs: string[] = [];
  for (const line of bootnodesFile.trim().split(/\r?\n/)) {
    // File may contain a row with '### Ethereum Node Records'
    // File may be YAML, with `- enr:-KG4QOWkRj`
    if (line.includes("enr:")) enrs.push("enr:" + line.split("enr:")[1]);
  }
  return enrs;
}

// TODO these URLs are from a local infura account.  switch with a ChainSafe account when available
const INFURA_CREDENTIALS = "1sla4tyOFn0bB1ohyCKaH2sLmHu:b8cdb9d881039fd04fe982a5ec57b0b8";

export function getInfuraBeaconUrl(network: NetworkName): string | undefined {
  if (infuraNetworks.includes(network)) {
    return `https://${INFURA_CREDENTIALS}@eth2-beacon-${network}.infura.io`;
  }
  return undefined;
}

/**
 * Fetch weak subjectivity state from a remote beacon node
 */
export async function fetchWeakSubjectivityState(
  config: IChainForkConfig,
  url: string
): Promise<TreeBacked<allForks.BeaconState>> {
  try {
    const response = await got(url, {headers: {accept: "application/octet-stream"}});
    const stateBytes = response.rawBody;
    return getStateTypeFromBytes(config, stateBytes).createTreeBackedFromBytes(stateBytes);
  } catch (e) {
    throw new Error("Unable to fetch weak subjectivity state: " + (e as Error).message);
  }
}
