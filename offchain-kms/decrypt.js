const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(masterKey) {
  if (!masterKey) {
    throw new Error("STORAGE_MASTER_KEY is required");
  }
  return crypto.createHash("sha256").update(masterKey, "utf8").digest();
}

function encryptBuffer(plaintext, masterKey) {
  const key = deriveKey(masterKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, typeof plaintext === "string" ? "utf8" : undefined),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function decryptBuffer(data, masterKey) {
  const key = deriveKey(masterKey);
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function decryptFile(filePath, masterKey) {
  const data = fs.readFileSync(filePath);
  return decryptBuffer(data, masterKey).toString("utf8");
}

function writeEncryptedFile(filePath, plaintext, masterKey) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, encryptBuffer(plaintext, masterKey));
}

module.exports = {
  deriveKey,
  encryptBuffer,
  decryptBuffer,
  decryptFile,
  writeEncryptedFile,
};
