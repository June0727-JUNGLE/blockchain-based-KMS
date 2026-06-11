/** MultiSig-KMS dApp — localhost Hardhat node 기본값 */
const KMS_CONFIG = {
  contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  chainId: 31337,
  chainName: "Hardhat Local",
  rpcUrl: "http://127.0.0.1:8545",
  apiBaseUrl: "http://localhost:4000",
  defaultDocumentId: "Encrypted_Log.dat#vehicle-001",
  /** Hardhat node 기본 계정 (MetaMask 임포트용 안내) */
  demoAccounts: {
    admin: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    approver1: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    approver2: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    approver3: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    requester: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  },
};
