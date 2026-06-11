/** 지갑 주소 → 역할 분기 */
const KMSRouter = {
  ROLES: {
    ADMIN: "admin",
    APPROVER: "approver",
    EMPLOYEE: "employee",
    NONE: "none",
  },

  async resolveRole(address, contract) {
    const adminRole = await contract.DEFAULT_ADMIN_ROLE();
    const approverRole = await contract.APPROVER_ROLE();

    if (await contract.hasRole(adminRole, address)) {
      return this.ROLES.ADMIN;
    }
    if (await contract.hasRole(approverRole, address)) {
      return this.ROLES.APPROVER;
    }
    if (await contract.isWhitelisted(address)) {
      return this.ROLES.EMPLOYEE;
    }
    return this.ROLES.NONE;
  },

  isControlMode(role) {
    return role === this.ROLES.ADMIN || role === this.ROLES.APPROVER;
  },

  demoAccountLabel(address) {
    const addr = address.toLowerCase();
    const map = {
      [KMS_CONFIG.demoAccounts.admin.toLowerCase()]: "Hardhat #0 Admin",
      [KMS_CONFIG.demoAccounts.approver1.toLowerCase()]: "Hardhat #1 Approver",
      [KMS_CONFIG.demoAccounts.approver2.toLowerCase()]: "Hardhat #2 Approver",
      [KMS_CONFIG.demoAccounts.approver3.toLowerCase()]: "Hardhat #3 Approver",
      [KMS_CONFIG.demoAccounts.requester.toLowerCase()]: "Hardhat #4 Requester",
    };
    return map[addr] || null;
  },

  roleMeta(role) {
    switch (role) {
      case this.ROLES.ADMIN:
        return { label: "관제 모드 · Admin", cls: "role-admin", icon: "🛡️" };
      case this.ROLES.APPROVER:
        return { label: "관제 모드 · Approver", cls: "role-approver", icon: "⚖️" };
      case this.ROLES.EMPLOYEE:
        return { label: "직원 모드", cls: "role-employee", icon: "🖥️" };
      default:
        return { label: "권한 없음", cls: "role-none", icon: "🚫" };
    }
  },
};
