const { ethers } = require("ethers");
const abi = require("../frontend/shared/kms-abi.json");

async function main() {
  const p = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const addr = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const c = new ethers.Contract(addr, abi, p);
  const r = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

  console.log("block", await p.getBlockNumber());
  console.log("whitelisted #4", await c.isWhitelisted(r));
  console.log("nextRequestId", (await c.nextRequestId()).toString());

  const adminRole = await c.DEFAULT_ADMIN_ROLE();
  const apprRole = await c.APPROVER_ROLE();
  const accounts = [
    ["#0", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
    ["#1", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
    ["#2", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"],
  ];
  for (const [label, a] of accounts) {
    const admin = await c.hasRole(adminRole, a);
    const appr = await c.hasRole(apprRole, a);
    console.log(label, "admin", admin, "approver", appr);
  }

  const nextId = Number(await c.nextRequestId());
  for (let i = 0; i < nextId; i++) {
    const req = await c.getRequest(i);
    if (req.exists) {
      console.log(
        `request #${i}`,
        "executed",
        req.executed,
        "approvals",
        req.approvalCount.toString(),
        "requester",
        req.requester
      );
    }
  }
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
