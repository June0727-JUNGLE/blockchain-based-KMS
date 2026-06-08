const hre = require("hardhat");

const DOCUMENT_ID = hre.ethers.id("Encrypted_Log.dat#vehicle-001");

function parseEvent(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed;
      }
    } catch {
      // unrelated log from another contract
    }
  }
  return null;
}

function logTx(label, receipt) {
  console.log(`  ${label}`);
  console.log(`    tx: ${receipt.hash}`);
  console.log(`    block: ${receipt.blockNumber}`);
  console.log(`    gas used: ${receipt.gasUsed.toString()}`);
}

async function main() {
  const { name: networkName } = hre.network;

  console.log("\n=======================================================");
  console.log("KMS.sol — localhost 배포 및 트랜잭션 검증");
  console.log("=======================================================\n");

  if (networkName !== "localhost") {
    console.warn(
      `⚠️  현재 네트워크: "${networkName}". localhost 검증용 스크립트입니다.`
    );
    console.warn("    실행 예: npx hardhat run scripts/deploy.js --network localhost\n");
  }

  const provider = hre.ethers.provider;
  let blockNumber;

  try {
    blockNumber = await provider.getBlockNumber();
  } catch (error) {
    console.error("❌ RPC 연결 실패. 먼저 별도 터미널에서 노드를 실행하세요:");
    console.error("   npx hardhat node");
    console.error(`   (${error.message})\n`);
    process.exitCode = 1;
    return;
  }

  const { chainId } = await provider.getNetwork();
  console.log(`[네트워크] ${networkName} (chainId: ${chainId}, block: ${blockNumber})`);

  const [admin, approver1, approver2, approver3, requester] =
    await hre.ethers.getSigners();

  console.log("\n[역할 주소]");
  console.log(`  Admin     : ${admin.address}`);
  console.log(`  Approver 1: ${approver1.address}`);
  console.log(`  Approver 2: ${approver2.address}`);
  console.log(`  Approver 3: ${approver3.address}`);
  console.log(`  Requester : ${requester.address}`);

  console.log("\n[1/5] KMS.sol 배포");
  const KMS = await hre.ethers.getContractFactory("KMS");
  const deployTx = await KMS.deploy(admin.address, [
    approver1.address,
    approver2.address,
    approver3.address,
  ]);
  const deployReceipt = await deployTx.deploymentTransaction().wait();
  const kms = await deployTx.waitForDeployment();
  const contractAddress = await kms.getAddress();

  logTx("deploy", deployReceipt);
  console.log(`    contract: ${contractAddress}`);

  console.log("\n[2/5] grantPermission (화이트리스트 등록)");
  const grantTx = await kms.connect(admin).grantPermission(requester.address);
  const grantReceipt = await grantTx.wait();
  logTx("grantPermission", grantReceipt);
  console.log(`    isWhitelisted: ${await kms.isWhitelisted(requester.address)}`);

  console.log("\n[3/5] requestDocumentAccess (복호화 권한 요청)");
  const requestTx = await kms
    .connect(requester)
    .requestDocumentAccess(DOCUMENT_ID);
  const requestReceipt = await requestTx.wait();
  logTx("requestDocumentAccess", requestReceipt);

  const accessRequested = parseEvent(requestReceipt, kms, "AccessRequested");
  if (!accessRequested) {
    throw new Error("AccessRequested 이벤트를 receipt에서 찾을 수 없습니다.");
  }
  const requestId = accessRequested.args.requestId;
  console.log(`    requestId: ${requestId}`);
  console.log(`    documentId: ${accessRequested.args.documentId}`);

  console.log("\n[4/5] approveAccess × 2 (2-of-3 멀티시그 승인)");
  const approve1Tx = await kms.connect(approver1).approveAccess(requestId);
  const approve1Receipt = await approve1Tx.wait();
  logTx("approveAccess (1/2)", approve1Receipt);

  let req = await kms.getRequest(requestId);
  console.log(`    approvalCount: ${req.approvalCount}, executed: ${req.executed}`);

  const approve2Tx = await kms.connect(approver2).approveAccess(requestId);
  const approve2Receipt = await approve2Tx.wait();
  logTx("approveAccess (2/2)", approve2Receipt);

  req = await kms.getRequest(requestId);
  console.log(`    approvalCount: ${req.approvalCount}, executed: ${req.executed}`);

  const documentAccessed = parseEvent(approve2Receipt, kms, "DocumentAccessed");
  if (!documentAccessed) {
    throw new Error("DocumentAccessed 이벤트를 receipt에서 찾을 수 없습니다.");
  }
  console.log(`    DocumentAccessed emitted (requestId: ${documentAccessed.args.requestId})`);

  console.log("\n[5/5] revokePermission (킬스위치) + 차단 확인");
  const revokeTx = await kms.connect(admin).revokePermission(requester.address);
  const revokeReceipt = await revokeTx.wait();
  logTx("revokePermission", revokeReceipt);
  console.log(`    isWhitelisted: ${await kms.isWhitelisted(requester.address)}`);

  try {
    await kms.connect(requester).requestDocumentAccess(DOCUMENT_ID);
    throw new Error("revoke 후 requestDocumentAccess가 revert되지 않았습니다.");
  } catch (error) {
    const reverted = error.message.includes("NotWhitelisted");
    if (!reverted) {
      throw error;
    }
    console.log("    blocked requestDocumentAccess after revoke: OK (NotWhitelisted)");
  }

  const finalBlock = await provider.getBlockNumber();
  console.log("\n=======================================================");
  console.log("✅ localhost 배포 및 핵심 트랜잭션 검증 완료");
  console.log(`   KMS contract: ${contractAddress}`);
  console.log(`   blocks processed: ${blockNumber} → ${finalBlock}`);
  console.log("=======================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
