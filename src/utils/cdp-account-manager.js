import { CdpClient } from '@coinbase/cdp-sdk';
import logger from './logger.js';
import { agentConfig } from '../config/agent-config.js';

async function getSql() {
  const mod = await import('./db.js');
  return mod.default;
}

export class CdpAccountManager {
  constructor() {
    this.cdpClient = null;
    this.createdAccounts = new Map();
  }

  async initialize() {
    try {
      logger.info('Initializing CDP Account Manager');
      
      // Initialize CDP client with explicit authentication parameters
      this.cdpClient = new CdpClient({
        apiKeyId: process.env.CDP_API_KEY_ID,
        apiKeySecret: process.env.CDP_API_KEY_SECRET,
        walletSecret: process.env.CDP_WALLET_SECRET,
        debugging: process.env.NODE_ENV === 'development'
      });
      
      logger.info('✅ CDP Account Manager initialized successfully with explicit auth');
      return true;
    } catch (error) {
      logger.error(`❌ CDP Account Manager initialization failed: ${error.message}`);
      logger.error('Check that CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET are set correctly');
      throw error;
    }
  }

  async createAgentAccount(agentName, agentId) {
    try {
      logger.info(`Creating CDP account for agent: ${agentName}`);
      
      if (!this.cdpClient) {
        throw new Error('CDP Client not initialized');
      }

      // Create EVM account on Base Sepolia
      const account = await this.cdpClient.evm.createAccount();
      
      logger.info(`✅ Created CDP account for ${agentName}: ${account.address}`);
      
      // Store account info
      const accountInfo = {
        agentName,
        agentId,
        address: account.address,
        createdAt: new Date().toISOString(),
        network: agentConfig.network.id
      };
      
      this.createdAccounts.set(agentId, accountInfo);
      
      return accountInfo;
    } catch (error) {
      logger.error(`❌ Failed to create CDP account for ${agentName}: ${error.message}`);
      throw error;
    }
  }

  async fundAccountWithFaucet(accountInfo, amount = 'eth') {
    try {
      logger.info(`Requesting faucet funds for ${accountInfo.agentName} at ${accountInfo.address}`);
      
      const faucetResponse = await this.cdpClient.evm.requestFaucet({
        address: accountInfo.address,
        network: agentConfig.network.id,
        token: amount
      });
      
      logger.info(`✅ Faucet request successful for ${accountInfo.agentName}: https://sepolia.basescan.org/tx/${faucetResponse.transactionHash}`);
      
      return {
        transactionHash: faucetResponse.transactionHash,
        explorerUrl: `https://sepolia.basescan.org/tx/${faucetResponse.transactionHash}`
      };
    } catch (error) {
      logger.warn(`⚠️ Faucet request failed for ${accountInfo.agentName}: ${error.message}`);
      // Don't throw error since faucet failures shouldn't stop agent creation
      return null;
    }
  }

  /**
   * Look up persisted wallet by name; create + persist if not found.
   * This makes wallet addresses stable across server restarts (T0-1).
   */
  async getOrCreateAgentAccount(agentName, agentId) {
    const sql = await getSql();
    if (sql) {
      try {
        const rows = await sql`SELECT * FROM agent_wallets WHERE agent_name = ${agentName}`;
        if (rows.length > 0) {
          const row = rows[0];
          const info = {
            agentName: row.agent_name,
            agentId: row.agent_id,
            address: row.address,
            createdAt: row.created_at,
            network: row.network
          };
          this.createdAccounts.set(row.agent_id, info);
          logger.info(`Loaded persisted CDP account for ${agentName}: ${row.address}`);
          return info;
        }
      } catch (dbError) {
        logger.warn(`DB lookup failed for ${agentName}, falling back to create: ${dbError.message}`);
      }
    }

    // No existing record — create new CDP account
    const info = await this.createAgentAccount(agentName, agentId);

    if (sql) {
      try {
        await sql`
          INSERT INTO agent_wallets (agent_id, agent_name, address, network)
          VALUES (${info.agentId}, ${info.agentName}, ${info.address}, ${info.network})
          ON CONFLICT (agent_name) DO NOTHING
        `;
      } catch (dbError) {
        logger.warn(`Failed to persist wallet for ${agentName}: ${dbError.message}`);
      }
    }

    return info;
  }

  getAccountInfo(agentId) {
    return this.createdAccounts.get(agentId);
  }

  getAllAccounts() {
    return Array.from(this.createdAccounts.values());
  }

  async close() {
    if (this.cdpClient) {
      // CDP SDK doesn't seem to have an explicit close method, so just clean up references
      this.cdpClient = null;
      logger.info('CDP Account Manager closed');
    }
  }
}

export default CdpAccountManager;