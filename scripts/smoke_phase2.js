const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const API = "http://127.0.0.1:4000";

async function j(url, opts) {
  const r = await fetch(url, opts);
  return { status: r.status, body: await r.json() };
}

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${API}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server not ready");
}

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../storage/manifest.json"), "utf8")
  );
  const normal = manifest.documents.find((d) => d.tier === "normal");
  const secure = manifest.documents.find((d) => d.tier === "secure");

  const [admin, a1, a2, a3, requester] = await hre.ethers.getSigners();
  const kms = await hre.ethers.getContractAt(
    "KMS",
    "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  );

  const server = spawn("node", ["offchain-kms/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      KMS_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    },
    stdio: "ignore",
  });

  try {
    await waitServer();
    const already = await kms.isWhitelisted(requester.address);
    if (!already) {
      await kms.connect(admin).grantPermission(requester.address);
    }

    const list = await j(`${API}/api/documents`);
    if (list.status !== 200 || list.body.documents.length < 2) throw new Error("documents list");

    const logTx = await kms.connect(requester).logDocumentAccess(normal.documentId);
    const logRc = await logTx.wait();
    const openN = await j(`${API}/api/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: normal.documentId,
        requester: requester.address,
        txHash: logRc.hash,
      }),
    });
    if (openN.status !== 200 || !openN.body.content) throw new Error("normal open");

    const blocked = await j(`${API}/api/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: secure.documentId,
        requester: requester.address,
        txHash: logRc.hash,
      }),
    });
    if (blocked.status !== 403) throw new Error("secure should 403");

    await kms.connect(requester).requestDocumentAccess(secure.documentId);
    const requestId = (await kms.nextRequestId()) - 1n;
    await kms.connect(a1).approveAccess(requestId);
    const appr = await kms.connect(a2).approveAccess(requestId);
    const apprRc = await appr.wait();

    const openS = await j(`${API}/api/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: secure.documentId,
        requester: requester.address,
        txHash: apprRc.hash,
      }),
    });
    if (openS.status !== 200 || !openS.body.content.includes("VEHICLE")) throw new Error("secure open");

    console.log("✅ smoke: documents list, normal open, secure 403, secure decrypt — all OK");
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
