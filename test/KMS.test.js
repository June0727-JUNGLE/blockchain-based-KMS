const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KMS", function () {
  const DOCUMENT_ID = ethers.id("Encrypted_Log.dat#vehicle-001");

  let kms;
  let admin;
  let approver1;
  let approver2;
  let approver3;
  let requester;
  let outsider;

  beforeEach(async function () {
    [admin, approver1, approver2, approver3, requester, outsider] =
      await ethers.getSigners();

    const KMS = await ethers.getContractFactory("KMS");
    kms = await KMS.deploy(admin.address, [
      approver1.address,
      approver2.address,
      approver3.address,
    ]);
    await kms.waitForDeployment();
  });

  describe("constructor", function () {
    it("reverts when admin is zero address", async function () {
      const KMS = await ethers.getContractFactory("KMS");
      await expect(
        KMS.deploy(ethers.ZeroAddress, [
          approver1.address,
          approver2.address,
          approver3.address,
        ])
      ).to.be.revertedWithCustomError(KMS, "ZeroAddress");
    });

    it("reverts when approvers are duplicated", async function () {
      const KMS = await ethers.getContractFactory("KMS");
      await expect(
        KMS.deploy(admin.address, [
          approver1.address,
          approver1.address,
          approver2.address,
        ])
      ).to.be.revertedWithCustomError(KMS, "DuplicateApprover");
    });

    it("assigns admin and three approver roles", async function () {
      expect(await kms.hasRole(await kms.DEFAULT_ADMIN_ROLE(), admin.address)).to
        .be.true;
      expect(await kms.hasRole(await kms.APPROVER_ROLE(), approver1.address)).to
        .be.true;
      expect(await kms.hasRole(await kms.APPROVER_ROLE(), approver2.address)).to
        .be.true;
      expect(await kms.hasRole(await kms.APPROVER_ROLE(), approver3.address)).to
        .be.true;
    });
  });

  describe("grantPermission", function () {
    it("allows admin to whitelist an account", async function () {
      await expect(kms.connect(admin).grantPermission(requester.address))
        .to.emit(kms, "PermissionGranted")
        .withArgs(requester.address, admin.address);

      expect(await kms.isWhitelisted(requester.address)).to.be.true;
    });

    it("reverts when granting zero address", async function () {
      await expect(
        kms.connect(admin).grantPermission(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(kms, "ZeroAddress");
    });

    it("reverts when account is already whitelisted", async function () {
      await kms.connect(admin).grantPermission(requester.address);
      await expect(
        kms.connect(admin).grantPermission(requester.address)
      ).to.be.revertedWithCustomError(kms, "AlreadyWhitelisted");
    });

    it("reverts when caller is not admin", async function () {
      await expect(
        kms.connect(outsider).grantPermission(requester.address)
      ).to.be.revertedWithCustomError(kms, "AccessControlUnauthorizedAccount");
    });
  });

  describe("requestDocumentAccess", function () {
    beforeEach(async function () {
      await kms.connect(admin).grantPermission(requester.address);
    });

    it("creates a request and emits AccessRequested", async function () {
      await expect(
        kms.connect(requester).requestDocumentAccess(DOCUMENT_ID)
      )
        .to.emit(kms, "AccessRequested")
        .withArgs(0, requester.address, DOCUMENT_ID);

      const req = await kms.getRequest(0);
      expect(req.requester).to.equal(requester.address);
      expect(req.documentId).to.equal(DOCUMENT_ID);
      expect(req.approvalCount).to.equal(0);
      expect(req.executed).to.be.false;
      expect(req.exists).to.be.true;
      expect(await kms.nextRequestId()).to.equal(1);
    });

    it("reverts when requester is not whitelisted", async function () {
      await expect(
        kms.connect(outsider).requestDocumentAccess(DOCUMENT_ID)
      )
        .to.be.revertedWithCustomError(kms, "NotWhitelisted")
        .withArgs(outsider.address);
    });
  });

  describe("approveAccess (2-of-3 multisig)", function () {
    beforeEach(async function () {
      await kms.connect(admin).grantPermission(requester.address);
      await kms.connect(requester).requestDocumentAccess(DOCUMENT_ID);
    });

    it("does not finalize access after only one approval", async function () {
      await expect(kms.connect(approver1).approveAccess(0))
        .to.emit(kms, "AccessApproved")
        .withArgs(0, approver1.address, 1);

      const req = await kms.getRequest(0);
      expect(req.approvalCount).to.equal(1);
      expect(req.executed).to.be.false;
      expect(await kms.hasApproved(0, approver1.address)).to.be.true;
    });

    it("finalizes access after two approvals and emits DocumentAccessed", async function () {
      await kms.connect(approver1).approveAccess(0);

      await expect(kms.connect(approver2).approveAccess(0))
        .to.emit(kms, "AccessApproved")
        .withArgs(0, approver2.address, 2)
        .and.to.emit(kms, "DocumentAccessed")
        .withArgs(0, requester.address, DOCUMENT_ID);

      const req = await kms.getRequest(0);
      expect(req.executed).to.be.true;
    });

    it("allows any two of three approvers to satisfy threshold", async function () {
      await kms.connect(approver1).approveAccess(0);
      await kms.connect(approver3).approveAccess(0);

      const req = await kms.getRequest(0);
      expect(req.executed).to.be.true;
    });

    it("reverts when the same approver approves twice", async function () {
      await kms.connect(approver1).approveAccess(0);
      await expect(kms.connect(approver1).approveAccess(0))
        .to.be.revertedWithCustomError(kms, "AlreadyApproved")
        .withArgs(0, approver1.address);
    });

    it("reverts after request is already executed", async function () {
      await kms.connect(approver1).approveAccess(0);
      await kms.connect(approver2).approveAccess(0);

      await expect(kms.connect(approver3).approveAccess(0))
        .to.be.revertedWithCustomError(kms, "RequestAlreadyExecuted")
        .withArgs(0);
    });

    it("reverts when caller is not an approver", async function () {
      await expect(kms.connect(outsider).approveAccess(0))
        .to.be.revertedWithCustomError(kms, "AccessControlUnauthorizedAccount");
    });

    it("reverts for unknown request id", async function () {
      await expect(kms.connect(approver1).approveAccess(99))
        .to.be.revertedWithCustomError(kms, "RequestNotFound")
        .withArgs(99);
    });
  });

  describe("revokePermission", function () {
    beforeEach(async function () {
      await kms.connect(admin).grantPermission(requester.address);
    });

    it("removes whitelist access and emits PermissionRevoked", async function () {
      await expect(kms.connect(admin).revokePermission(requester.address))
        .to.emit(kms, "PermissionRevoked")
        .withArgs(requester.address, admin.address);

      expect(await kms.isWhitelisted(requester.address)).to.be.false;
    });

    it("blocks new access requests after revocation", async function () {
      await kms.connect(admin).revokePermission(requester.address);
      await expect(
        kms.connect(requester).requestDocumentAccess(DOCUMENT_ID)
      )
        .to.be.revertedWithCustomError(kms, "NotWhitelisted")
        .withArgs(requester.address);
    });

    it("reverts when revoking an account not on whitelist", async function () {
      await expect(
        kms.connect(admin).revokePermission(outsider.address)
      ).to.be.revertedWithCustomError(kms, "NotWhitelistedForRevoke");
    });

    it("reverts when caller is not admin", async function () {
      await expect(
        kms.connect(outsider).revokePermission(requester.address)
      ).to.be.revertedWithCustomError(kms, "AccessControlUnauthorizedAccount");
    });
  });
});
