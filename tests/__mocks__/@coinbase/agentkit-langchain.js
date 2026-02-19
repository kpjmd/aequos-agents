// Mock for @coinbase/agentkit-langchain to avoid ESM-incompatible dependency in Jest
export const getLangChainTools = () => Promise.resolve([]);

export default { getLangChainTools };
