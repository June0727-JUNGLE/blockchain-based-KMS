const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { writeEncryptedFile } = require("../offchain-kms/decrypt");

require("dotenv").config();

const STORAGE_ROOT = path.join(__dirname, "../storage");
const MASTER_KEY =
  process.env.STORAGE_MASTER_KEY || "dev-storage-master-key-change-in-production";

const SAMPLE_DOCUMENTS = [
  {
    id: "doc-001",
    title: "2024년 사내 공지",
    tier: "normal",
    label: "notice-2024",
    path: "plain/notice-2024.txt",
    content: [
      "2024년 사내 공지",
      "",
      "1. 연말 휴무: 12월 30일 ~ 1월 1일",
      "2. 보안 교육: 전 직원 12월 15일 필수 이수",
      "3. 문의: security@company.local",
    ].join("\n"),
  },
  {
    id: "doc-002",
    title: "인사 규정 요약",
    tier: "normal",
    label: "hr-policy-summary",
    path: "plain/hr-policy-summary.txt",
    content: [
      "인사 규정 요약 (2024)",
      "",
      "- 근무시간: 주 40시간",
      "- 재택근무: 팀장 승인 후 주 2회",
      "- 기밀 문서 접근은 별도 온체인 승인 절차를 따릅니다.",
    ].join("\n"),
  },
  {
    id: "doc-003",
    title: "Encrypted_Log.dat#vehicle-001",
    tier: "secure",
    label: "Encrypted_Log.dat#vehicle-001",
    path: "encrypted/vehicle-001.log.enc",
    content: [
      "[VEHICLE-001 TELEMETRY LOG]",
      "timestamp=2024-06-01T08:12:00Z event=IGNITION_ON",
      "timestamp=2024-06-01T08:45:22Z event=GPS lat=37.5665 lon=126.9780",
      "timestamp=2024-06-01T09:01:11Z event=DOOR_OPEN driver=EMP-1042",
      "timestamp=2024-06-01T09:02:03Z event=DOOR_CLOSE",
      "--- END OF LOG ---",
    ].join("\n"),
  },
  {
    id: "doc-004",
    title: "Encrypted_Log.dat#vehicle-002",
    tier: "secure",
    label: "Encrypted_Log.dat#vehicle-002",
    path: "encrypted/vehicle-002.log.enc",
    content: [
      "[VEHICLE-002 TELEMETRY LOG]",
      "timestamp=2024-06-02T14:30:00Z event=MAINTENANCE_ALERT code=E42",
      "timestamp=2024-06-02T14:31:05Z event=SPEED limit_exceeded value=92",
      "timestamp=2024-06-02T14:35:18Z event=GPS lat=37.4979 lon=127.0276",
      "--- END OF LOG ---",
    ].join("\n"),
  },
];

function seedStorage() {
  fs.mkdirSync(path.join(STORAGE_ROOT, "plain"), { recursive: true });
  fs.mkdirSync(path.join(STORAGE_ROOT, "encrypted"), { recursive: true });

  const manifestDocuments = SAMPLE_DOCUMENTS.map((doc) => {
    const documentId = ethers.id(doc.label);
    const filePath = path.join(STORAGE_ROOT, doc.path);

    if (doc.tier === "normal") {
      fs.writeFileSync(filePath, doc.content, "utf8");
    } else {
      writeEncryptedFile(filePath, doc.content, MASTER_KEY);
    }

    return {
      id: doc.id,
      title: doc.title,
      tier: doc.tier,
      documentId,
      path: doc.path,
    };
  });

  const manifest = { documents: manifestDocuments };
  fs.writeFileSync(
    path.join(STORAGE_ROOT, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  console.log("✅ storage seeded");
  console.log(`   root: ${STORAGE_ROOT}`);
  console.log(`   documents: ${manifestDocuments.length}`);
  for (const doc of manifestDocuments) {
    console.log(`   - [${doc.tier}] ${doc.title} → ${doc.documentId}`);
  }
}

seedStorage();
