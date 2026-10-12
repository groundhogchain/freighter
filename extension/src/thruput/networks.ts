export enum ThruputNetwork {
  DEVNET = "devnet",
  LOCALNET = "localnet",
}

export const THRUPUT_NETWORKS = {
  [ThruputNetwork.DEVNET]: {
    name: "Thruput Devnet",
    rpcUrl: "https://rpc.thruput.network",
    networkHash:
      "abb9cdbc56285d0e71c9845273ca06211fedf7ee2f58c43cfac6060f9402aa0f",
  },
  [ThruputNetwork.LOCALNET]: {
    name: "Thruput Localnet",
    rpcUrl: "http://127.0.0.1:9545",
    networkHash: "0".repeat(64),
  },
} as const;

export const HOG_ADDRESS = `0x${"0".repeat(63)}1`;

export interface ThruputNetworkSelection {
  network: ThruputNetwork;
  networkHash: string;
}

export interface ThruputToken {
  address: string;
  symbol: string;
  decimals: number;
}

export const HOG_TOKEN: ThruputToken = {
  address: HOG_ADDRESS,
  symbol: "HOG",
  decimals: 7,
};

export const thruputScope = (networkHash: string, address: string) =>
  JSON.stringify(["thruput", networkHash, address]);
