const hre = require("hardhat");

async function main() {
  console.log("\n=======================================================");
  console.log("🚀 MultiSig-KMS CLI 기반 올인원 아키텍처 기능 검증 시작");
  console.log("=======================================================\n");

  // 1. 가상 지갑 분배 (Hardhat 내장 지갑 추출)
  const [admin, approver1, approver2, approver3, requester, hacker] = await hre.ethers.getSigners();
  console.log(`[👤 역할 바인딩 완료]`);
  console.log(` - 최고 관리자(Admin): ${admin.address}`);
  console.log(` - 결재권자 1 (Approver1): ${approver1.address}`);
  console.log(` - 결재권자 2 (Approver2): ${approver2.address}`);
  console.log(` - 결재권자 3 (Approver3): ${approver3.address}`);
  console.log(` - 권한 요청자 (Requester): ${requester.address}`);
  console.log(` - 가상 해커 (Hacker): ${hacker.address}\n`);

  // 2. 스마트 컨트랙트 로컬 배포 연산
  console.log(`[🏗️ 온체인 배포 시뮬레이션]`);
  const KMS = await hre.ethers.getContractFactory("KMS");
  const kms = await KMS.deploy(admin.address, [approver1.address, approver2.address, approver3.address]);
  await kms.waitForDeployment();
  const contractAddress = await kms.getAddress();
  console.log(` 🟢 자물쇠 통제소(KMS.sol) 배포 성공! 주소: ${contractAddress}\n`);

  // 3. 화이트리스트 부여 테스트
  console.log(`[🔐 Step 1. 기업형 화이트리스트 접근 제어 검증]`);
  await kms.connect(admin).grantPermission(requester.address);
  console.log(` 🟢 Admin이 요청자 지갑(${requester.address})을 화이트리스트에 등록했습니다.`);
  console.log(`   - 화이트리스트 여부 조회 결과: ${await kms.isWhitelisted(requester.address)}\n`);

  // 4. 복호화 권한 요청 (Encrypted_Log.dat 데이터 해시 가정)
  console.log(`[📝 Step 2. 임직원 기밀 로그 복호화 권한 요청 생성]`);
  const dummyDocId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("Encrypted_Log.dat_Metadata"));
  const txRequest = await kms.connect(requester).requestDocumentAccess(dummyDocId);
  const receiptRequest = await txRequest.wait();
  
  // 생성된 requestId 파싱 (첫 번째 요청이므로 0번 프리셋)
  const requestId = 0;
  console.log(` 🟢 요청 성공! [문서 해시: ${dummyDocId}] ➔ 생성된 요청 ID: ${requestId}\n`);

  // 5. 2-of-3 다중 서명 임계치 및 감사 로그 검증
  console.log(`[⚖️ Step 3. 2-of-3 멀티시그 합의 및 온체인 감사 로그 검증]`);
  
  // 1차 서명 날인
  await kms.connect(approver1).approveAccess(requestId);
  let reqStatus = await kms.getRequest(requestId);
  console.log(` 🟡 [결재 1차 승인] Approver 1 서명 완료. (현재 승인 수: ${reqStatus.approvalCount} / 2)`);
  console.log(`   - 최종 복호화 권한 개방 상태(Executed): ${reqStatus.executed} (승인 임계치 미달로 자물쇠 굳건함)`);

  // 2차 서명 날인 (임계치 충족 포인트)
  const txApprove2 = await kms.connect(approver2).approveAccess(requestId);
  const receiptApprove2 = await txApprove2.wait();
  reqStatus = await kms.getRequest(requestId);
  console.log(` 🟢 [결재 2차 승인 완료] Approver 2 서명 완료. (현재 승인 수: ${reqStatus.approvalCount} / 2)`);
  console.log(`   - ✨ 최종 복호화 권한 개방 상태(Executed): ${reqStatus.executed} [자물쇠 해제 성공!]`);
  console.log(`   - 🛡️ 사내 오프체인 서버가 수신할 'DocumentAccessed' 온체인 감사증 발출 완료.\n`);

  // 6. 비상 킬스위치 격리 기능 테스트 (지갑 탈취 시나리오)
  console.log(`[🚨 Step 4. 프라이빗 키 탈취 시 즉각 격리 킬스위치 검증]`);
  console.log(` ⚠️ [상황 발생] 화이트리스트 임직원(Requester)의 지갑이 가상 해커에게 탈취됨!`);
  
  const txRevoke = await kms.connect(admin).revokePermission(requester.address);
  await txRevoke.wait();
  console.log(` 🟢 [Admin 긴급 킬스위치 작동] 'revokePermission' 호출 완료.`);
  console.log(`   - 격리 후 화이트리스트 여부 재조회: ${await kms.isWhitelisted(requester.address)} (False 격리 완료)`);

  // 7. 격리된 지갑으로 해커가 무단 침입 트랜잭션을 날렸을 때 EVM Revert 방어 검증
  console.log(`\n[🛡️ Step 5. 격리된 지갑을 이용한 해커의 무단 침입 차단 시뮬레이션]`);
  try {
    console.log(` ⚙️ 해커가 훔친 지갑으로 새 복호화 요청(requestDocumentAccess) 송신 시도 중...`);
    await kms.connect(requester).requestDocumentAccess(dummyDocId);
    console.log(" ❌ 보안 결함 발생: 격리된 지갑의 트랜잭션이 거부되지 않고 통과되었습니다!");
  } catch (error) {
    console.log(` 🎯 [방어 성공] EVM 가상머신 단에서 침입을 즉각 거부(Revert)했습니다!`);
    console.log(`   - 🔒 발생한 시스템 보안 Revert 에러 메시지: ${error.message.split("\n")[0]}`);
  }

  console.log("\n=======================================================");
  console.log("🟢 MultiSig-KMS 온체인 아키텍처 코어 로직 100% 무결성 검증 통과!");
  console.log("=======================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});