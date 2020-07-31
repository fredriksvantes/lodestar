import {IBeaconNodeOptionsPartial} from "../../../options";

/* eslint-disable max-len */

// Use a Typescript file instead of JSON so it's automatically included in the built files

export const medallaConfig: IBeaconNodeOptionsPartial = {
  api: {
    rest: {
      enabled: true,
    },
  },
  eth1: {
    provider: {
      url: "http://goerli.prylabs.net",
    },
    depositContract: {
      deployedAt: 3085928,
    },
  },
  metrics: {
    enabled: true,
    serverPort: 8008,
  },
  network: {
    discv5: {
      // TODO: Add `network.discv5.enabled` to the `IDiscv5DiscoveryInputOptions` type
      // @ts-ignore
      enabled: true,
      bindAddr: "/ip4/0.0.0.0/udp/9000",
      bootEnrs: [
        "enr:-LK4QKWk9yZo258PQouLshTOEEGWVHH7GhKwpYmB5tmKE4eHeSfman0PZvM2Rpp54RWgoOagAsOfKoXgZSbiCYzERWABh2F0dG5ldHOIAAAAAAAAAACEZXRoMpAAAAAAAAAAAAAAAAAAAAAAgmlkgnY0gmlwhDQlA5CJc2VjcDI1NmsxoQOYiWqrQtQksTEtS3qY6idxJE5wkm0t9wKqpzv2gCR21oN0Y3CCIyiDdWRwgiMo",
        "enr:-LK4QEnIS-PIxxLCadJdnp83VXuJqgKvC9ZTIWaJpWqdKlUFCiup2sHxWihF9EYGlMrQLs0mq_2IyarhNq38eoaOHUoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpAAAAAAAAAAAAAAAAAAAAAAgmlkgnY0gmlwhA37LMaJc2VjcDI1NmsxoQJ7k0mKtTd_kdEq251flOjD1HKpqgMmIETDoD-Msy_O-4N0Y3CCIyiDdWRwgiMo",
        "enr:-KG4QIOJRu0BBlcXJcn3lI34Ub1aBLYipbnDaxBnr2uf2q6nE1TWnKY5OAajg3eG6mHheQSfRhXLuy-a8V5rqXKSoUEChGV0aDKQGK5MywAAAAH__________4JpZIJ2NIJpcIQKAAFhiXNlY3AyNTZrMaEDESplmV9c2k73v0DjxVXJ6__2bWyP-tK28_80lf7dUhqDdGNwgiMog3VkcIIjKA"
      ],
    },
    maxPeers: 25,
    bootMultiaddrs: [],
    localMultiaddrs: ["/ip4/0.0.0.0/tcp/30607"],
  },
  params: {
    MIN_GENESIS_TIME: 1596546000,
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 16384,
    GENESIS_DELAY: 172800,
    GENESIS_FORK_VERSION: "0x00000001",
    DEPOSIT_NETWORK_ID: 5,
    DEPOSIT_CONTRACT_ADDRESS: "0x07b39F4fDE4A38bACe212b546dAc87C58DfE3fDC",
  },
};
