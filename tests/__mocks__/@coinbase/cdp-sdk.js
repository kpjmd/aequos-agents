// Mock for @coinbase/cdp-sdk to avoid ESM-incompatible jose dependency in Jest
export function CdpClient() {
  return {
    evm: {
      createAccount: () => Promise.resolve({ address: '0xmockaddress' }),
      requestFaucet: () => Promise.resolve({ transactionHash: '0xmockhash' }),
    },
  };
}

export const Cdp = {
  configureFromJson: () => {},
  configure: () => {},
};

export default { CdpClient, Cdp };
