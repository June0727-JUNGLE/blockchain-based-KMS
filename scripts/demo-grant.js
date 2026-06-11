const hre = require("hardhat");

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

async function main() {
  const [admin, , , , requester] = await hre.ethers.getSigners();
  const kms = await hre.ethers.getContractAt("KMS", CONTRACT);

  const whitelisted = await kms.isWhitelisted(requester.address);
  if (whitelisted) {
    console.log(`✅ Requester 이미 화이트리스트: ${requester.address}`);
    return;
  }

  const tx = await kms.connect(admin).grantPermission(requester.address);
  await tx.wait();
  console.log(`✅ grantPermission 완료: ${requester.address}`);
  console.log(`   isWhitelisted: ${await kms.isWhitelisted(requester.address)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
