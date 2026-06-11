const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config();

const { decryptFile } = require("./decrypt");
const { verifyNormalAccess, verifySecureAccess } = require("./verify");

const PORT = Number(process.env.KMS_SERVER_PORT || 4000);
const STORAGE_ROOT = path.join(__dirname, "../storage");
const MANIFEST_PATH = path.join(STORAGE_ROOT, "manifest.json");
const RPC_URL = process.env.KMS_RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS =
  process.env.KMS_CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const MASTER_KEY =
  process.env.STORAGE_MASTER_KEY || "dev-storage-master-key-change-in-production";

const app = express();
app.use(cors());
app.use(express.json());

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      "storage/manifest.json not found. Run: npm run seed:storage"
    );
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function findDocument(manifest, documentId) {
  const normalized = documentId.toLowerCase();
  return manifest.documents.find(
    (doc) => doc.documentId.toLowerCase() === normalized
  );
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, contract: CONTRACT_ADDRESS, rpc: RPC_URL });
});

app.get("/api/documents", (_req, res) => {
  try {
    const manifest = loadManifest();
    const documents = manifest.documents.map(({ id, title, tier, documentId }) => ({
      id,
      title,
      tier,
      documentId,
    }));
    res.json({ documents });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/open", async (req, res) => {
  const { documentId, requester, txHash } = req.body || {};

  if (!documentId || !requester || !txHash) {
    return res.status(400).json({
      error: "documentId, requester, and txHash are required",
    });
  }

  try {
    const manifest = loadManifest();
    const doc = findDocument(manifest, documentId);
    if (!doc) {
      return res.status(404).json({ error: "document not found" });
    }

    const filePath = path.join(STORAGE_ROOT, doc.path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "document file missing on disk" });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const verifyArgs = {
      provider,
      contractAddress: CONTRACT_ADDRESS,
      txHash,
      documentId,
      requester,
    };

    if (doc.tier === "normal") {
      const verification = await verifyNormalAccess(verifyArgs);
      if (!verification.ok) {
        return res.status(403).json({ error: verification.reason });
      }

      const content = fs.readFileSync(filePath, "utf8");
      return res.json({
        tier: "normal",
        title: doc.title,
        content,
      });
    }

    if (doc.tier === "secure") {
      const verification = await verifySecureAccess(verifyArgs);
      if (!verification.ok) {
        return res.status(403).json({ error: verification.reason });
      }

      const content = decryptFile(filePath, MASTER_KEY);
      return res.json({
        tier: "secure",
        title: doc.title,
        content,
        requestId: verification.requestId,
      });
    }

    return res.status(400).json({ error: `unknown tier: ${doc.tier}` });
  } catch (error) {
    console.error("[/api/open]", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`KMS off-chain server listening on http://localhost:${PORT}`);
  console.log(`  contract: ${CONTRACT_ADDRESS}`);
  console.log(`  rpc: ${RPC_URL}`);
  if (!process.env.STORAGE_MASTER_KEY) {
    console.warn("  ⚠️  STORAGE_MASTER_KEY not set — using dev default key");
  }
});
