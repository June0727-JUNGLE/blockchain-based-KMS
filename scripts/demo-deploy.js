const hre = require("hardhat");

async function main() {
  const [admin, a1, a2, a3, requester] = await hre.ethers.getSigners();

  console.log("\n[시연용 배포] KMS.sol — grant만 수행 (revoke/테스트 tx 없음)\n");

  const KMS = await hre.ethers.getContractFactory("KMS");
  const kms = await KMS.deploy(admin.address, [a1.address, a2.address, a3.address]);
  await kms.waitForDeployment();
  const address = await kms.getAddress();

  await kms.connect(admin).grantPermission(requester.address);

  console.log(`✅ KMS contract: ${address}`);
  console.log(`✅ grantPermission: ${requester.address}`);
  console.log(`   isWhitelisted: ${await kms.isWhitelisted(requester.address)}`);
  console.log("\n   frontend/shared/config.js 의 contractAddress 와 일치하는지 확인하세요.");
  console.log("   (첫 배포 주소: 0x5FbDB2315678afecb367f032d93F642f64180aa3)\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
