const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");

function loadAbi() {
  const abiPath = path.join(__dirname, "../frontend/shared/kms-abi.json");
  return JSON.parse(fs.readFileSync(abiPath, "utf8"));
}

function normalizeAddress(address) {
  return ethers.getAddress(address);
}

function normalizeDocumentId(documentId) {
  if (typeof documentId !== "string" || !documentId.startsWith("0x")) {
    throw new Error("documentId must be a 0x-prefixed hex string");
  }
  return documentId.toLowerCase();
}

function parseContractLogs(receipt, iface) {
  return receipt.logs
    .map((log) => {
      try {
        return iface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function verifyNormalAccess({ provider, contractAddress, txHash, documentId, requester }) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) {
    return { ok: false, reason: "transaction not found or reverted" };
  }

  const iface = new ethers.Interface(loadAbi());
  const expectedDocId = normalizeDocumentId(documentId);
  const expectedRequester = normalizeAddress(requester);

  const logged = parseContractLogs(receipt, iface).find(
    (entry) =>
      entry.name === "DocumentAccessLogged" &&
      normalizeAddress(entry.args.accessor) === expectedRequester &&
      entry.args.documentId.toLowerCase() === expectedDocId
  );

  if (!logged) {
    return { ok: false, reason: "DocumentAccessLogged event not found in receipt" };
  }

  return { ok: true, event: logged };
}

async function verifySecureAccess({ provider, contractAddress, txHash, documentId, requester }) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) {
    return { ok: false, reason: "transaction not found or reverted" };
  }

  const abi = loadAbi();
  const iface = new ethers.Interface(abi);
  const contract = new ethers.Contract(contractAddress, abi, provider);

  const expectedDocId = normalizeDocumentId(documentId);
  const expectedRequester = normalizeAddress(requester);

  const accessed = parseContractLogs(receipt, iface).find(
    (entry) =>
      entry.name === "DocumentAccessed" &&
      normalizeAddress(entry.args.requester) === expectedRequester &&
      entry.args.documentId.toLowerCase() === expectedDocId
  );

  if (!accessed) {
    return { ok: false, reason: "DocumentAccessed event not found in receipt" };
  }

  const requestId = accessed.args.requestId;
  const req = await contract.getRequest(requestId);

  if (!req.exists) {
    return { ok: false, reason: "request does not exist on-chain" };
  }
  if (!req.executed) {
    return { ok: false, reason: "request not executed" };
  }
  if (normalizeAddress(req.requester) !== expectedRequester) {
    return { ok: false, reason: "requester mismatch" };
  }
  if (req.documentId.toLowerCase() !== expectedDocId) {
    return { ok: false, reason: "documentId mismatch" };
  }

  return { ok: true, event: accessed, requestId: requestId.toString() };
}

module.exports = {
  verifyNormalAccess,
  verifySecureAccess,
};
