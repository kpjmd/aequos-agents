const hre = require("hardhat");

async function main() {
  console.log("\n🔐 Authorizing AequOs Agents as Token Minters...\n");

  // Get token contract address from environment
  const tokenAddress = process.env.TOKEN_CONTRACT_ADDRESS;
  if (!tokenAddress) {
    throw new Error("TOKEN_CONTRACT_ADDRESS not set in environment");
  }

  console.log("Token Contract:", tokenAddress);

  // Get agent addresses from environment
  const agentAddresses = [
    { name: "Triage Agent", address: process.env.TRIAGE_AGENT_ADDRESS },
    { name: "Pain Whisperer", address: process.env.PAIN_WHISPERER_ADDRESS },
    { name: "Movement Detective", address: process.env.MOVEMENT_DETECTIVE_ADDRESS },
    { name: "Strength Sage", address: process.env.STRENGTH_SAGE_ADDRESS },
    { name: "Mind Mender", address: process.env.MIND_MENDER_ADDRESS }
  ].filter(agent => agent.address);

  if (agentAddresses.length === 0) {
    throw new Error("No agent addresses found. Set TRIAGE_AGENT_ADDRESS, PAIN_WHISPERER_ADDRESS, etc.");
  }

  console.log(`Found ${agentAddresses.length} agent addresses\n`);

  // Get contract instance
  const token = await hre.ethers.getContractAt("AequOsAgentToken", tokenAddress);

  // Authorize each agent
  for (const agent of agentAddresses) {
    console.log(`Authorizing ${agent.name}...`);
    console.log(`  Address: ${agent.address}`);

    // Check if already authorized
    const isAuthorized = await token.authorizedMinters(agent.address);
    if (isAuthorized) {
      console.log(`  ✓ Already authorized\n`);
      continue;
    }

    // Authorize the agent
    const tx = await token.authorizeMinter(agent.address);
    console.log(`  Transaction: ${tx.hash}`);

    await tx.wait();
    console.log(`  ✓ Authorized!\n`);
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("✅ All agents authorized successfully!");
  console.log("═══════════════════════════════════════════════════════");
  console.log("\nAuthorized Minters:");
  for (const agent of agentAddresses) {
    const isAuthorized = await token.authorizedMinters(agent.address);
    console.log(`${isAuthorized ? '✓' : '✗'} ${agent.name}: ${agent.address}`);
  }
  console.log("\n📝 NEXT STEPS:");
  console.log("1. Update Railway environment:");
  console.log("   MOCK_BLOCKCHAIN_RESPONSES=false");
  console.log("\n2. Railway will auto-redeploy");
  console.log("\n3. Test real blockchain minting:");
  console.log("   Trigger a triage or consultation via API");
  console.log("\n4. Verify on Basescan:");
  console.log(`   https://sepolia.basescan.org/token/${tokenAddress}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
