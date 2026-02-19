// Mock for @coinbase/agentkit to avoid ESM-incompatible jose dependency in Jest
// Uses plain functions since jest global is not available in module-level mocks

function mockFn() {
  const fn = (...args) => fn._returnValue;
  fn._returnValue = undefined;
  fn.mockResolvedValue = (v) => { fn._returnValue = Promise.resolve(v); return fn; };
  fn.mockReturnValue = (v) => { fn._returnValue = v; return fn; };
  fn.mock = { calls: [] };
  return fn;
}

export function CdpEvmWalletProvider() {
  return {
    getAddress: () => Promise.resolve('0xmockaddress'),
    sendTransaction: () => Promise.resolve({ hash: '0xmockhash' }),
    configureWithWallet: () => Promise.resolve({}),
  };
}

CdpEvmWalletProvider.configureWithWallet = () => Promise.resolve({
  getAddress: () => Promise.resolve('0xmockaddress'),
  sendTransaction: () => Promise.resolve({ hash: '0xmockhash' }),
});

export const AgentKit = {
  from: () => Promise.resolve({}),
};

export default { CdpEvmWalletProvider, AgentKit };
