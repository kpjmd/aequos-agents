const hre = require("hardhat");

async function main() {
  console.log("\n💰 Checking AequOs Agent Token Balances...\n");

  const tokenAddress = process.env.TOKEN_CONTRACT_ADDRESS;
  if (!tokenAddress) {
    throw new Error("TOKEN_CONTRACT_ADDRESS not set");
  }

  const agents = [
    { name: "Triage Agent", address: process.env.TRIAGE_AGENT_ADDRESS },
    { name: "Pain Whisperer", address: process.env.PAIN_WHISPERER_ADDRESS },
    { name: "Movement Detective", address: process.env.MOVEMENT_DETECTIVE_ADDRESS },
    { name: "Strength Sage", address: process.env.STRENGTH_SAGE_ADDRESS },
    { name: "Mind Mender", address: process.env.MIND_MENDER_ADDRESS }
  ].filter(agent => agent.address);

  const token = await hre.ethers.getContractAt("AequOsAgentToken", tokenAddress);

  console.log("Token Contract:", tokenAddress);
  console.log("Network: Base Sepolia\n");

  console.log("═══════════════════════════════════════════════════════");
  console.log("Agent Balances:");
  console.log("═══════════════════════════════════════════════════════");

  let totalAgentBalance = 0n;

  for (const agent of agents) {
    const balance = await token.balanceOf(agent.address);
    const balanceReadable = hre.ethers.formatEther(balance);
    const isAuthorized = await token.authorizedMinters(agent.address);

    console.log(`\n${agent.name}`);
    console.log(`  Address: ${agent.address}`);
    console.log(`  Balance: ${balanceReadable} OAT`);
    console.log(`  Authorized: ${isAuthorized ? '✓ Yes' : '✗ No'}`);

    totalAgentBalance += balance;
  }

  console.log("\n═══════════════════════════════════════════════════════");

  const totalSupply = await token.totalSupply();
  const totalSupplyReadable = hre.ethers.formatEther(totalSupply);
  const totalAgentBalanceReadable = hre.ethers.formatEther(totalAgentBalance);

  console.log(`Total Supply: ${totalSupplyReadable} OAT`);
  console.log(`Total Agent Balance: ${totalAgentBalanceReadable} OAT`);
  console.log(`Max Supply: 1,000,000 OAT`);
  console.log(`Remaining: ${hre.ethers.formatEther(await token.MAX_SUPPLY() - totalSupply)} OAT`);
  console.log("═══════════════════════════════════════════════════════\n");

  console.log(`🔗 View on Basescan: https://sepolia.basescan.org/token/${tokenAddress}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
