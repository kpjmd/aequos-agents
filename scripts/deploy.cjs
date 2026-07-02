const hre = require("hardhat");

async function main() {
  console.log("\n🚀 Deploying AequOsAgentToken to Base Sepolia...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  // Deploy contract
  console.log("Deploying contract...");
  const AequOsAgentToken = await hre.ethers.getContractFactory("AequOsAgentToken");
  const token = await AequOsAgentToken.deploy();

  await token.waitForDeployment();
  const address = await token.getAddress();

  console.log("✓ Contract deployed to:", address);
  console.log("✓ Transaction hash:", token.deploymentTransaction().hash);

  // Wait for confirmations
  console.log("\nWaiting for 6 block confirmations...");
  await token.deploymentTransaction().wait(6);
  console.log("✓ Confirmed!\n");

  // Verify contract on Basescan
  console.log("Verifying contract on Basescan...");
  try {
    await hre.run("verify:verify", {
      address: address,
      constructorArguments: []
    });
    console.log("✓ Contract verified on Basescan\n");
  } catch (error) {
    if (error.message.includes("already verified")) {
      console.log("✓ Contract already verified\n");
    } else {
      console.error("Verification failed:", error.message);
      console.log("You can verify manually later with:");
      console.log(`npx hardhat verify --network base-sepolia ${address}\n`);
    }
  }

  // Display summary
  console.log("═══════════════════════════════════════════════════════");
  console.log("📋 DEPLOYMENT SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  console.log("Contract Address:", address);
  console.log("Network: Base Sepolia (Chain ID: 84532)");
  console.log("Token Name: AequOs Agent Token");
  console.log("Token Symbol: OAT");
  console.log("Initial Supply: 100,000 OAT");
  console.log("Max Supply: 1,000,000 OAT");
  console.log("═══════════════════════════════════════════════════════");
  console.log("\n📝 NEXT STEPS:");
  console.log("1. Add to Railway environment variables:");
  console.log(`   TOKEN_CONTRACT_ADDRESS=${address}`);
  console.log("\n2. Extract agent wallet addresses from Railway logs");
  console.log("\n3. Fund agent wallets with testnet ETH:");
  console.log("   https://faucet.quicknode.com/base/sepolia");
  console.log("\n4. Authorize agents as minters:");
  console.log("   npm run authorize:agents");
  console.log("\n5. Update Railway:");
  console.log("   MOCK_BLOCKCHAIN_RESPONSES=false");
  console.log("\n🔗 View on Basescan:");
  console.log(`https://sepolia.basescan.org/address/${address}`);
  console.log("\n✅ Deployment complete!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
