import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from './logger.js';
import { agentConfig } from '../config/agent-config.js';

// Load compiled contract artifacts
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractPath = join(__dirname, '../../artifacts/contracts/AequOsAgentToken.sol/AequOsAgentToken.json');

let compiledToken = null;
try {
  compiledToken = JSON.parse(readFileSync(contractPath, 'utf8'));
  logger.info('Loaded compiled AequOsAgentToken contract');
} catch (error) {
  logger.warn(`Compiled contract artifact not found at ${contractPath} — blockchain token minting disabled. Run "npm run compile:contract" to enable.`);
}

export class BlockchainUtils {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.contracts = new Map();
    this.transactionHistory = [];
    this.networkInfo = null;
  }

  async initialize() {
    try {
      logger.info('Initializing blockchain utilities');
      
      // Check if blockchain is enabled
      if (!agentConfig.blockchain.enabled) {
        logger.info('Blockchain disabled, running in offline mode');
        return {
          provider: false,
          wallet: false,
          network: 'offline',
          chainId: 0,
          enabled: false
        };
      }
      
      // Initialize provider for Base Sepolia testnet
      const rpcUrl = this.getRpcUrl(agentConfig.network.id);
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      
      // Note: CDP private keys should be used with CdpAgentkit, not directly with ethers.js
      // Individual agents will create their own CDP wallets as needed
      logger.info(`Blockchain provider initialized for ${agentConfig.network.id}`);
      
      // Get network information
      this.networkInfo = await this.provider.getNetwork();
      logger.info(`Connected to network: ${this.networkInfo.name} (Chain ID: ${this.networkInfo.chainId})`);
      
      return {
        provider: !!this.provider,
        wallet: false, // Wallets are created by individual agents using CDP
        network: this.networkInfo.name,
        chainId: Number(this.networkInfo.chainId),
        enabled: true
      };
    } catch (error) {
      logger.error(`Failed to initialize blockchain utilities: ${error.message}`);
      throw error;
    }
  }

  getRpcUrl(networkId) {
    const rpcUrls = {
      'base-sepolia': 'https://sepolia.base.org',
      'base-mainnet': 'https://mainnet.base.org',
      'base': 'https://mainnet.base.org'
    };
    
    return rpcUrls[networkId] || rpcUrls['base-sepolia'];
  }

  async getWalletBalance(address = null) {
    try {
      if (!address) {
        throw new Error('Wallet address required - BlockchainUtils does not manage wallets directly');
      }
      const walletAddress = address;
      
      const balance = await this.provider.getBalance(walletAddress);
      const balanceInEth = ethers.formatEther(balance);
      
      return {
        address: walletAddress,
        balance: balanceInEth,
        balanceWei: balance.toString(),
        currency: 'ETH'
      };
    } catch (error) {
      logger.error(`Error getting wallet balance: ${error.message}`);
      throw error;
    }
  }

  async sendTransaction(fromWalletProvider, toAddress, amountEth, data = '0x') {
    try {
      if (!fromWalletProvider) {
        throw new Error('Wallet provider required - pass agent wallet provider as first parameter');
      }
      
      logger.info(`Sending transaction: ${amountEth} ETH to ${toAddress}`);
      
      const tx = {
        to: toAddress,
        value: ethers.parseEther(amountEth.toString()),
        data: data
      };
      
      // Send transaction using CDP wallet provider
      const txResponse = await fromWalletProvider.sendTransaction(tx);
      
      logger.info(`Transaction sent: ${txResponse.hash}`);
      
      // Wait for confirmation
      const receipt = await txResponse.wait();
      
      const transactionRecord = {
        hash: txResponse.hash,
        from: await fromWalletProvider.getAddress(),
        to: toAddress,
        value: amountEth,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber,
        status: receipt.status === 1 ? 'success' : 'failed',
        timestamp: new Date().toISOString()
      };
      
      this.transactionHistory.push(transactionRecord);
      
      logger.info(`Transaction confirmed: ${txResponse.hash} (Block: ${receipt.blockNumber})`);
      
      return transactionRecord;
    } catch (error) {
      logger.error(`Transaction failed: ${error.message}`);
      throw error;
    }
  }

  async deployContract(deployerWalletProvider, contractAbi, contractBytecode, constructorArgs = []) {
    try {
      if (!deployerWalletProvider) {
        throw new Error('Deployer wallet provider required');
      }
      
      logger.info('Deploying smart contract');
      
      // Get signer from wallet provider
      const signer = await deployerWalletProvider.getSigner();
      
      const contractFactory = new ethers.ContractFactory(
        contractAbi,
        contractBytecode,
        signer
      );
      
      const contract = await contractFactory.deploy(...constructorArgs);
      await contract.waitForDeployment();
      
      const contractAddress = await contract.getAddress();
      
      logger.info(`Contract deployed at: ${contractAddress}`);
      
      // Store contract reference
      this.contracts.set(contractAddress, {
        contract,
        abi: contractAbi,
        deployedAt: new Date().toISOString()
      });
      
      return {
        address: contractAddress,
        transactionHash: contract.deploymentTransaction()?.hash,
        contract
      };
    } catch (error) {
      logger.error(`Contract deployment failed: ${error.message}`);
      throw error;
    }
  }

  async interactWithContract(contractAddress, functionName, args = [], value = 0) {
    try {
      const contractInfo = this.contracts.get(contractAddress);
      if (!contractInfo) {
        throw new Error(`Contract not found: ${contractAddress}`);
      }
      
      logger.info(`Calling ${functionName} on contract ${contractAddress}`);
      
      const contract = contractInfo.contract;
      
      // Prepare transaction options
      const txOptions = {};
      if (value > 0) {
        txOptions.value = ethers.parseEther(value.toString());
      }
      
      // Call contract function
      const tx = await contract[functionName](...args, txOptions);
      
      if (tx.wait) {
        // This is a transaction that modifies state
        const receipt = await tx.wait();
        
        const interactionRecord = {
          contractAddress,
          functionName,
          args,
          value,
          transactionHash: tx.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          status: receipt.status === 1 ? 'success' : 'failed',
          timestamp: new Date().toISOString()
        };
        
        this.transactionHistory.push(interactionRecord);
        
        return {
          ...interactionRecord,
          result: receipt
        };
      } else {
        // This is a read-only call
        return {
          contractAddress,
          functionName,
          args,
          result: tx,
          timestamp: new Date().toISOString()
        };
      }
    } catch (error) {
      logger.error(`Contract interaction failed: ${error.message}`);
      throw error;
    }
  }

  async createAgentTokenContract(_deployerWalletProvider) {
    // Deployment is handled out-of-band via Hardhat (scripts/deploy.js).
    // Runtime always binds to the deployed address from TOKEN_CONTRACT_ADDRESS,
    // or returns a mock contract if unset (dev/testing).
    return this.createMockTokenContract();
  }

  createMockTokenContract() {
    // Check if we have a deployed contract address from environment
    const deployedAddress = agentConfig.tokenEconomics.contractAddress;

    if (deployedAddress && deployedAddress !== '' && !agentConfig.blockchain.mockResponses) {
      logger.info(`Using deployed token contract: ${deployedAddress}`);

      // Register the deployed contract if we have the ABI
      if (compiledToken && this.provider) {
        try {
          const contract = new ethers.Contract(deployedAddress, compiledToken.abi, this.provider);
          this.contracts.set(deployedAddress, {
            contract,
            abi: compiledToken.abi,
            name: "AequOs Agent Token"
          });
        } catch (error) {
          logger.error(`Failed to register deployed contract: ${error.message}`);
        }
      }

      return {
        tokenAddress: deployedAddress,
        name: "AequOs Agent Token",
        symbol: "OAT",
        totalSupply: "1000000",
        deploymentTx: null,
        isMock: false
      };
    }

    // Return mock contract for development/testing
    const mockAddress = `0x${Math.random().toString(16).substring(2, 42).padStart(40, '0')}`;
    logger.info(`Created mock token contract at: ${mockAddress}`);

    return {
      tokenAddress: mockAddress,
      name: "AequOs Agent Token (Mock)",
      symbol: "OAT",
      totalSupply: "1000000",
      deploymentTx: `0x${Math.random().toString(16).substring(2, 66)}`,
      isMock: true
    };
  }

  async mintTokensToAgent(tokenAddress, agentAddress, amount, walletProvider) {
    try {
      logger.info(`Minting ${amount} tokens to agent: ${agentAddress}`);

      // Check if we should use mock responses
      if (agentConfig.blockchain.mockResponses) {
        logger.debug('Mock blockchain mode enabled, returning simulated mint');
        return this.createMockMintResult(tokenAddress, agentAddress, amount);
      }

      if (!walletProvider) {
        logger.warn('No wallet provider available for real minting, falling back to mock');
        return this.createMockMintResult(tokenAddress, agentAddress, amount);
      }

      if (!compiledToken) {
        logger.warn('Compiled contract ABI not available, falling back to mock');
        return this.createMockMintResult(tokenAddress, agentAddress, amount);
      }

      // Get signer from wallet provider
      const signer = await walletProvider.getSigner();
      const contract = new ethers.Contract(tokenAddress, compiledToken.abi, signer);

      // Call mint function with reason parameter
      const amountWei = ethers.parseEther(amount.toString());
      const reason = `Agent reward: ${Date.now()}`;
      const tx = await contract.mint(agentAddress, amountWei, reason);

      logger.info(`Mint transaction submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      logger.info(`Mint confirmed in block ${receipt.blockNumber}`);

      const mintResult = {
        contractAddress: tokenAddress,
        functionName: 'mint',
        args: [agentAddress, amount],
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status === 1 ? 'success' : 'failed',
        timestamp: new Date().toISOString(),
        isMock: false
      };

      this.transactionHistory.push(mintResult);

      return mintResult;
    } catch (error) {
      logger.error(`Token minting failed: ${error.message}`);
      throw error;
    }
  }
  
  createMockMintResult(tokenAddress, agentAddress, amount) {
    return {
      contractAddress: tokenAddress,
      functionName: 'mint',
      args: [agentAddress, amount],
      transactionHash: `0x${Math.random().toString(16).substring(2, 66)}`,
      status: 'success',
      timestamp: new Date().toISOString(),
      isMock: true
    };
  }

  async transferTokensBetweenAgents(tokenAddress, fromAddress, toAddress, amount) {
    try {
      logger.info(`Transferring ${amount} tokens from ${fromAddress} to ${toAddress}`);

      if (agentConfig.blockchain.mockResponses) {
        return {
          contractAddress: tokenAddress,
          functionName: 'transferFrom',
          args: [fromAddress, toAddress, amount],
          transactionHash: `0x${Math.random().toString(16).substring(2, 66)}`,
          status: 'success',
          timestamp: new Date().toISOString(),
          isMock: true
        };
      }
      
      const transferResult = await this.interactWithContract(
        tokenAddress,
        'transferFrom',
        [fromAddress, toAddress, ethers.parseEther(amount.toString())]
      );
      
      return transferResult;
    } catch (error) {
      logger.error(`Token transfer failed: ${error.message}`);
      throw error;
    }
  }

  async getTokenBalance(tokenAddress, agentAddress) {
    try {
      // Check if we should use mock responses
      if (agentConfig.blockchain.mockResponses) {
        return {
          address: agentAddress,
          balance: "0.0",
          tokenAddress: tokenAddress,
          timestamp: new Date().toISOString(),
          isMock: true
        };
      }

      if (!compiledToken || !this.provider) {
        throw new Error('Contract ABI or provider not available');
      }

      const contract = new ethers.Contract(tokenAddress, compiledToken.abi, this.provider);
      const balanceWei = await contract.balanceOf(agentAddress);
      const balance = ethers.formatEther(balanceWei);

      return {
        address: agentAddress,
        balance: balance,
        tokenAddress: tokenAddress,
        timestamp: new Date().toISOString(),
        isMock: false
      };
    } catch (error) {
      logger.error(`Failed to get token balance: ${error.message}`);
      return { address: agentAddress, balance: null, tokenAddress, isError: true, error: error.message };
    }
  }


  async verifyMedicalRecord(transactionHash) {
    try {
      const tx = await this.provider.getTransaction(transactionHash);
      if (!tx) {
        throw new Error('Transaction not found');
      }
      
      const receipt = await this.provider.getTransactionReceipt(transactionHash);
      
      return {
        hash: transactionHash,
        verified: receipt.status === 1,
        blockNumber: receipt.blockNumber,
        timestamp: tx.timestamp || new Date().toISOString(),
        gasUsed: receipt.gasUsed.toString(),
        dataHash: tx.data
      };
    } catch (error) {
      logger.error(`Medical record verification failed: ${error.message}`);
      throw error;
    }
  }


  async getNetworkStatistics() {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      const feeData = await this.provider.getFeeData();
      const balance = null; // Wallet balance requires specific address
      
      return {
        networkName: this.networkInfo?.name || 'Unknown',
        chainId: Number(this.networkInfo?.chainId) || 0,
        currentBlock: blockNumber,
        gasPrice: {
          standard: ethers.formatUnits(feeData.gasPrice || 0, 'gwei'),
          maxFee: ethers.formatUnits(feeData.maxFeePerGas || 0, 'gwei'),
          priorityFee: ethers.formatUnits(feeData.maxPriorityFeePerGas || 0, 'gwei')
        },
        walletBalance: balance,
        totalTransactions: this.transactionHistory.length,
        contractsDeployed: this.contracts.size
      };
    } catch (error) {
      logger.error(`Failed to get network statistics: ${error.message}`);
      return {
        error: error.message,
        networkInitialized: !!this.provider
      };
    }
  }

  getTransactionHistory(limit = 10) {
    return this.transactionHistory
      .slice(-limit)
      .reverse();
  }

  async estimateGasPrice() {
    try {
      const feeData = await this.provider.getFeeData();
      
      return {
        gasPrice: ethers.formatUnits(feeData.gasPrice || 0, 'gwei'),
        maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas || 0, 'gwei'),
        maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas || 0, 'gwei'),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Failed to estimate gas price: ${error.message}`);
      throw error;
    }
  }

  validateAddress(address) {
    try {
      return ethers.isAddress(address);
    } catch (error) {
      return false;
    }
  }

  formatEther(weiValue) {
    return ethers.formatEther(weiValue);
  }

  parseEther(etherValue) {
    return ethers.parseEther(etherValue.toString());
  }

  async isConnected() {
    try {
      if (!this.provider) return false;
      
      const blockNumber = await this.provider.getBlockNumber();
      return blockNumber > 0;
    } catch (error) {
      return false;
    }
  }

  // Development and testing utilities
  async fundTestWallet(address, amountEth = 0.1) {
    try {
      logger.info(`Funding test wallet ${address} with ${amountEth} ETH`);
      
      // This would typically use a faucet or test network funding
      // For now, simulate funding
      return {
        address,
        funded: amountEth,
        transactionHash: `0x${Math.random().toString(16).substring(2, 66)}`,
        timestamp: new Date().toISOString(),
        isTestFunding: true
      };
    } catch (error) {
      logger.error(`Test wallet funding failed: ${error.message}`);
      throw error;
    }
  }

  createTestEnvironment() {
    return {
      network: 'base-sepolia',
      rpcUrl: this.getRpcUrl('base-sepolia'),
      faucetUrl: 'https://faucet.quicknode.com/base/sepolia',
      explorerUrl: 'https://sepolia-explorer.base.org',
      testTokens: {
        OAT: this.createMockTokenContract()
      }
    };
  }
}

export default BlockchainUtils;