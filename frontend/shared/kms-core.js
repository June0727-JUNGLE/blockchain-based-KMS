/** @typedef {import('ethers').Contract} EthersContract */

const KMSCore = {
  provider: null,
  signer: null,
  connectedAddress: null,
  abi: null,
  _readProvider: null,
  _walletLock: Promise.resolve(),
  _auditContract: null,
  _auditHandlers: new Set(),
  _auditListenerRefs: [],

  AUDIT_EVENTS: [
    "AccessRequested",
    "AccessApproved",
    "DocumentAccessed",
    "DocumentAccessLogged",
    "PermissionGranted",
    "PermissionRevoked",
  ],

  async withWalletLock(fn) {
    const run = this._walletLock.then(() => fn());
    this._walletLock = run.catch(() => {});
    return run;
  },

  async loadAbi() {
    if (this.abi) return this.abi;
    const res = await fetch("./shared/kms-abi.json");
    if (!res.ok) throw new Error("ABI 로드 실패 — HTTP 서버로 frontend 폴더를 제공하세요.");
    this.abi = await res.json();
    return this.abi;
  },

  getEthereum() {
    const eth = window.ethereum;
    if (!eth) return null;
    if (Array.isArray(eth.providers) && eth.providers.length > 0) {
      return eth.providers.find((p) => p.isMetaMask) || eth.providers[0];
    }
    return eth;
  },

  normalizeAddress(address) {
    try {
      return ethers.getAddress(address);
    } catch {
      throw new Error(`잘못된 지갑 주소: ${address}`);
    }
  },

  async listAuthorizedAccounts() {
    const ethereum = this.getEthereum();
    const accounts = await ethereum.request({ method: "eth_accounts" });
    return (accounts || []).map((a) => this.normalizeAddress(a));
  },

  async requestAuthorizedAccounts() {
    const ethereum = this.getEthereum();
    const accounts = await ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts?.length) {
      throw new Error("MetaMask에서 계정을 선택하고 연결을 승인하세요.");
    }
    return accounts.map((a) => this.normalizeAddress(a));
  },

  pickActiveAddress(authorized, preferred) {
    const linked = authorized.map((a) => a.toLowerCase());
    const eth = this.getEthereum();

    if (preferred) {
      const want = this.normalizeAddress(preferred).toLowerCase();
      if (linked.includes(want)) {
        return this.normalizeAddress(preferred);
      }
    }

    if (eth?.selectedAddress) {
      const selected = this.normalizeAddress(eth.selectedAddress);
      if (linked.includes(selected.toLowerCase())) {
        return selected;
      }
      const hint = this.demoAccountHint(selected);
      throw new Error(
        `${hint}이(가) localhost에 연결되어 있지 않습니다. ` +
          "MetaMask 연결 팝업에서 해당 계정을 ✓ 체크하거나, [연결 해제] 후 다시 연결하세요."
      );
    }

    if (authorized.length === 1) {
      return authorized[0];
    }

    return authorized[0];
  },

  demoAccountHint(address) {
    if (typeof KMSRouter !== "undefined") {
      const label = KMSRouter.demoAccountLabel(address);
      if (label) return label;
    }
    return `계정 ${this.shortAddr(address)}`;
  },

  async ensureAccountPermitted(targetAddress, authorized) {
    const ethereum = this.getEthereum();
    const want = this.normalizeAddress(targetAddress).toLowerCase();
    const linked = authorized.map((a) => a.toLowerCase());
    if (linked.includes(want)) {
      return authorized;
    }

    try {
      await ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch (err) {
      if (err?.code === 4001) {
        throw new Error("MetaMask에서 계정 연결을 거부했습니다.");
      }
    }

    const refreshed = await this.listAuthorizedAccounts();
    if (!refreshed.some((a) => a.toLowerCase() === want)) {
      throw new Error(
        `${this.demoAccountHint(targetAddress)}이(가) 연결 목록에 없습니다. ` +
          "MetaMask 팝업에서 해당 계정을 ✓ 선택한 뒤 [연결]하세요."
      );
    }
    return refreshed;
  },

  async resolveConnectAddress(preferred, { forceRequest = false } = {}) {
    const ethereum = this.getEthereum();
    const target =
      preferred ||
      (ethereum?.selectedAddress ? this.normalizeAddress(ethereum.selectedAddress) : null);

    let authorized;
    if (forceRequest) {
      authorized = await this.requestAuthorizedAccounts();
    } else {
      authorized = await this.listAuthorizedAccounts();
      if (!authorized.length) {
        authorized = await this.requestAuthorizedAccounts();
      }
    }

    if (target) {
      authorized = await this.ensureAccountPermitted(target, authorized);
    }

    return { address: this.pickActiveAddress(authorized, preferred || target), authorized };
  },

  getReadProvider() {
    if (!this._readProvider) {
      this._readProvider = new ethers.JsonRpcProvider(KMS_CONFIG.rpcUrl);
    }
    return this._readProvider;
  },

  async verifyChainDeployment() {
    try {
      const code = await this.getReadProvider().getCode(KMS_CONFIG.contractAddress);
      if (!code || code === "0x") {
        throw new Error(
          `KMS 컨트랙트(${KMS_CONFIG.contractAddress})가 체인에 없습니다. npm run demo:reset 을 실행하세요.`
        );
      }
      return;
    } catch (err) {
      if (String(err.message || "").includes("KMS 컨트랙트")) throw err;
    }

    try {
      const res = await fetch(`${KMS_CONFIG.apiBaseUrl}/api/health`);
      const body = await res.json();
      if (res.ok && body.ok) {
        throw new Error(
          "Hardhat node는 KMS 서버에 연결되어 있으나, 브라우저에서 RPC(8545)를 읽지 못했습니다. " +
            "MetaMask 네트워크가 Hardhat Local(31337), RPC http://127.0.0.1:8545 인지 확인하세요."
        );
      }
    } catch (err) {
      if (String(err.message || "").includes("MetaMask") || String(err.message || "").includes("KMS")) {
        throw err;
      }
    }

    throw new Error(
      "Hardhat node(8545) 또는 KMS 서버(4000)에 연결할 수 없습니다. npm run demo:reset 을 실행하세요."
    );
  },

  async ensureMetaMaskChain(ethereum) {
    const chainIdHex = await ethereum.request({ method: "eth_chainId" });
    const chainId = Number.parseInt(chainIdHex, 16);
    if (chainId !== KMS_CONFIG.chainId) {
      await this.switchToHardhatLocal();
      await new Promise((r) => setTimeout(r, 400));
      const nextHex = await ethereum.request({ method: "eth_chainId" });
      if (Number.parseInt(nextHex, 16) !== KMS_CONFIG.chainId) {
        throw new Error(
          "MetaMask 네트워크가 Hardhat Local(Chain ID 31337)이 아닙니다. MetaMask에서 해당 네트워크를 선택하세요."
        );
      }
    }
  },
  async getSignerForAddress(browserProvider, address, authorizedAccounts) {
    let accounts = authorizedAccounts?.length
      ? authorizedAccounts
      : await this.requestAuthorizedAccounts();

    const want = address.toLowerCase();
    let idx = accounts.findIndex((a) => a.toLowerCase() === want);
    if (idx < 0) {
      accounts = await this.requestAuthorizedAccounts();
      idx = accounts.findIndex((a) => a.toLowerCase() === want);
    }
    if (idx < 0) {
      throw new Error(
        `${this.demoAccountHint(address)}이(가) MetaMask 연결 목록에 없습니다. ` +
          "연결 팝업에서 해당 계정을 ✓ 선택하거나, [연결 해제] 후 다시 시도하세요."
      );
    }
    return browserProvider.getSigner(idx);
  },

  disconnectWallet() {
    this._detachAuditListeners();
    this.provider = null;
    this._readProvider = null;
    this.signer = null;
    this.connectedAddress = null;
  },

  async revokeSiteAccess() {
    const ethereum = this.getEthereum();
    if (!ethereum?.request) return;
    try {
      await ethereum.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      /* 일부 환경에서 미지원 */
    }
  },

  async connectWallet(preferredAddress) {
    return this.withWalletLock(async () => {
      await this.loadAbi();
      const ethereum = this.getEthereum();
      if (!ethereum) {
        throw new Error("MetaMask가 설치되어 있지 않습니다.");
      }

      await this.ensureMetaMaskChain(ethereum);

      const { address, authorized } = await this.resolveConnectAddress(preferredAddress, {
        forceRequest: true,
      });

      await this.verifyChainDeployment();

      const browserProvider = new ethers.BrowserProvider(ethereum);
      const signer = await this.getSignerForAddress(browserProvider, address, authorized);
      const resolved = await signer.getAddress();
      if (resolved.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
          `지갑 주소 불일치: 요청 ${address}, 실제 ${resolved}. 연결 해제 후 다시 시도하세요.`
        );
      }

      this.provider = this.getReadProvider();
      this.signer = signer;
      this.connectedAddress = resolved;
      this._reattachAuditListeners();
      return { provider: this.provider, signer, address: resolved };
    });
  },

  async assertSignerMatches(expectedAddress) {
    if (!this.signer || !expectedAddress) {
      throw new Error("지갑이 연결되지 않았습니다.");
    }
    const live = await this.signer.getAddress();
    const want = this.normalizeAddress(expectedAddress);
    if (live.toLowerCase() !== want.toLowerCase()) {
      throw new Error(
        `서명 계정 불일치: 앱 ${this.shortAddr(want)}, MetaMask ${this.shortAddr(live)}. ` +
          "상단 [현재 MetaMask 계정으로 다시 연결]을 누르세요."
      );
    }
    return live;
  },

  async switchToHardhatLocal() {
    const ethereum = this.getEthereum();
    const chainIdHex = "0x" + KMS_CONFIG.chainId.toString(16);
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (err) {
      if (err.code === 4001) {
        throw new Error("MetaMask에서 네트워크 전환을 거부했습니다. Hardhat Local(31337)으로 수동 전환하세요.");
      }
      if (err.code === 4902) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: KMS_CONFIG.chainName,
              rpcUrls: [KMS_CONFIG.rpcUrl],
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            },
          ],
        });
      } else {
        throw err;
      }
    }
  },

  getReadContract() {
    if (!this.provider) throw new Error("지갑이 연결되지 않았습니다.");
    return new ethers.Contract(KMS_CONFIG.contractAddress, this.abi, this.provider);
  },

  getWriteContract() {
    if (!this.signer) throw new Error("지갑이 연결되지 않았습니다.");
    return new ethers.Contract(KMS_CONFIG.contractAddress, this.abi, this.signer);
  },

  _getAuditContract() {
    if (!this.provider) return null;
    if (!this._auditContract) {
      this._auditContract = new ethers.Contract(
        KMS_CONFIG.contractAddress,
        this.abi,
        this.provider
      );
    }
    return this._auditContract;
  },

  subscribeAudit(handler) {
    this._auditHandlers.add(handler);
    this._attachAuditListeners();
    return () => {
      this._auditHandlers.delete(handler);
      if (this._auditHandlers.size === 0) {
        this._detachAuditListeners();
      }
    };
  },

  _attachAuditListeners() {
    if (this._auditListenerRefs.length || this._auditHandlers.size === 0) return;
    const contract = this._getAuditContract();
    if (!contract) return;

    for (const name of this.AUDIT_EVENTS) {
      const listener = async (...payload) => {
        const eventPayload = payload[payload.length - 1];
        const log = eventPayload?.log;
        if (!log) return;
        let parsed;
        try {
          parsed = contract.interface.parseLog(log);
        } catch {
          return;
        }
        const entry = {
          name,
          args: parsed.args,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          dedupeKey: `${log.transactionHash}-${log.index}`,
        };
        for (const handler of this._auditHandlers) {
          try {
            await handler(entry);
          } catch {
            /* view unmounted */
          }
        }
      };
      contract.on(name, listener);
      this._auditListenerRefs.push({ name, listener });
    }
  },

  _detachAuditListeners() {
    if (!this._auditContract) {
      this._auditListenerRefs = [];
      return;
    }
    for (const { name, listener } of this._auditListenerRefs) {
      this._auditContract.off(name, listener);
    }
    this._auditListenerRefs = [];
    this._auditContract = null;
  },

  _reattachAuditListeners() {
    if (this._auditHandlers.size === 0) return;
    this._detachAuditListeners();
    this._attachAuditListeners();
  },

  documentIdFromInput(text) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("문서 식별자를 입력하세요.");
    if (trimmed.startsWith("0x") && trimmed.length === 66) {
      return trimmed;
    }
    return ethers.id(trimmed);
  },

  shortAddr(addr) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  },

  formatTimestamp(unixSec) {
    return new Date(Number(unixSec) * 1000).toLocaleString("ko-KR", {
      hour12: false,
    });
  },

  async receiptMeta(provider, txHash) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return { gasUsed: "?", blockNumber: "?" };
    const block = await provider.getBlock(receipt.blockNumber);
    return {
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
      timestamp: block ? block.timestamp : null,
    };
  },

  parseEventFromReceipt(receipt, contract, eventName) {
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed && parsed.name === eventName) return parsed;
      } catch {
        /* unrelated log */
      }
    }
    return null;
  },

  requestStatusLabel(req) {
    if (!req.exists) return { text: "알 수 없음", cls: "unknown" };
    if (req.executed) return { text: "승인 완료", cls: "done" };
    if (req.approvalCount >= 1) {
      return { text: `결재 진행 중 (${req.approvalCount}/2)`, cls: "progress" };
    }
    return { text: "대기 중", cls: "pending" };
  },

  storageKey(prefix, address) {
    return `kms-${prefix}-${address.toLowerCase()}`;
  },

  listAccessAttempts() {
    try {
      const raw = localStorage.getItem("kms-access-attempts");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  registerAccessAttempt(address) {
    const normalized = this.normalizeAddress(address);
    const list = this.listAccessAttempts();
    if (list.some((item) => item.address.toLowerCase() === normalized.toLowerCase())) {
      return;
    }
    list.push({ address: normalized, at: Date.now() });
    localStorage.setItem("kms-access-attempts", JSON.stringify(list));
  },

  dismissAccessAttempt(address) {
    const want = address.toLowerCase();
    const list = this.listAccessAttempts().filter(
      (item) => item.address.toLowerCase() !== want
    );
    localStorage.setItem("kms-access-attempts", JSON.stringify(list));
  },

  loadRequestIds(address) {
    try {
      const raw = localStorage.getItem(this.storageKey("requests", address));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveRequestId(address, requestId) {
    const ids = this.loadRequestIds(address);
    const id = String(requestId);
    if (!ids.includes(id)) {
      ids.push(id);
      localStorage.setItem(this.storageKey("requests", address), JSON.stringify(ids));
    }
  },

  async fetchDocuments() {
    const res = await fetch(`${KMS_CONFIG.apiBaseUrl}/api/documents`);
    if (!res.ok) {
      throw new Error(`문서 목록 조회 실패 (${res.status}) — kms:server 실행 여부 확인`);
    }
    const data = await res.json();
    return data.documents || [];
  },

  async openDocument(documentId, requester, txHash) {
    const res = await fetch(`${KMS_CONFIG.apiBaseUrl}/api/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId, requester, txHash }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || `문서 열기 실패 (${res.status})`);
    }
    return body;
  },

  async ensureWhitelisted(address) {
    const ok = await this.getReadContract().isWhitelisted(address);
    if (!ok) {
      throw new Error(
        "화이트리스트 미등록 계정입니다. npm run demo:reset 실행 후 #4(Requester)로 다시 연결하세요."
      );
    }
  },

  async getChainNonce(address) {
    return this.getReadProvider().getTransactionCount(address, "pending");
  },

  parseContractError(err) {
    if (!this.abi) return null;
    const candidates = [
      err?.data,
      err?.error?.data,
      err?.info?.error?.data,
      typeof err?.info === "string" ? err.info : null,
    ];
    const iface = new ethers.Interface(this.abi);
    for (const data of candidates) {
      if (!data || typeof data !== "string" || !data.startsWith("0x")) continue;
      try {
        const parsed = iface.parseError(data);
        if (!parsed) continue;
        switch (parsed.name) {
          case "AlreadyWhitelisted":
            return new Error("이미 화이트리스트에 등록된 계정입니다.");
          case "NotWhitelistedForRevoke":
            return new Error("화이트리스트에 없는 계정은 revoke할 수 없습니다.");
          case "NotWhitelisted":
            return new Error("화이트리스트 미등록 계정입니다.");
          case "AccessControlUnauthorizedAccount":
            return new Error("Admin(#0) 또는 Approver 권한이 필요합니다.");
          case "ZeroAddress":
            return new Error("유효하지 않은 지갑 주소(0x0)입니다.");
          default:
            return new Error(`컨트랙트 오류: ${parsed.name}`);
        }
      } catch {
        /* try next */
      }
    }
    return null;
  },

  enrichContractError(err) {
    const parsed = this.parseContractError(err);
    if (parsed) return parsed;

    const msg = String(err?.reason || err?.shortMessage || err?.message || "");
    const nested = err?.error?.message || err?.info?.error?.message || "";
    const combined = `${msg} ${nested}`;

    if (/NotWhitelisted|not whitelisted/i.test(combined) && !/NotWhitelistedForRevoke/i.test(combined)) {
      return new Error(
        "화이트리스트 미등록 — npm run demo:reset 후 #4(Requester)로 재연결하세요."
      );
    }
    if (/AlreadyWhitelisted/i.test(combined)) {
      return new Error("이미 화이트리스트에 등록된 계정입니다.");
    }
    if (/NotWhitelistedForRevoke/i.test(combined)) {
      return new Error("화이트리스트에 없는 계정은 revoke할 수 없습니다.");
    }
    if (/AccessControl|missing role/i.test(combined)) {
      return new Error("Admin(#0) 계정으로만 grant/revoke할 수 있습니다.");
    }
    if (/internal json-rpc|nonce too (low|high)|NONCE_EXPIRED|-32603/i.test(combined)) {
      return new Error(
        "MetaMask nonce 불일치 — demo:reset으로 체인이 초기화되면 자주 발생합니다. " +
          "MetaMask → 설정 → Developer tools → 「Delete activity and nonce data」 후 다시 시도하세요."
      );
    }
    return err;
  },

  async sendPrivilegedWrite({ signerAddress, role, simulate, send }) {
    await this.assertSignerMatches(signerAddress);
    const read = this.getReadContract();

    if (role === "admin") {
      const adminRole = await read.DEFAULT_ADMIN_ROLE();
      if (!(await read.hasRole(adminRole, signerAddress))) {
        throw new Error("Admin(#0) 계정으로만 실행할 수 있습니다.");
      }
    } else if (role === "approver") {
      const approverRole = await read.APPROVER_ROLE();
      if (!(await read.hasRole(approverRole, signerAddress))) {
        throw new Error("Approver 계정으로만 실행할 수 있습니다.");
      }
    }

    try {
      if (simulate) await simulate(read, signerAddress);
    } catch (err) {
      throw this.enrichContractError(err);
    }

    try {
      const nonce = await this.getChainNonce(signerAddress);
      const tx = await send(nonce);
      return await tx.wait();
    } catch (err) {
      throw this.enrichContractError(err);
    }
  },

  async sendContractWrite({ signerAddress, simulate, send }) {
    await this.assertSignerMatches(signerAddress);
    await this.ensureWhitelisted(signerAddress);

    const read = this.getReadContract();
    try {
      await simulate(read, signerAddress);
    } catch (err) {
      throw this.enrichContractError(err);
    }

    try {
      const nonce = await this.getChainNonce(signerAddress);
      const tx = await send(nonce);
      return await tx.wait();
    } catch (err) {
      throw this.enrichContractError(err);
    }
  },

  async findDocumentAccessedTx(contract, requestId, requester) {
    const filter = contract.filters.DocumentAccessed(requestId, requester);
    const logs = await contract.queryFilter(filter, 0, "latest");
    if (logs.length === 0) {
      throw new Error("DocumentAccessed 이벤트를 찾을 수 없습니다.");
    }
    return logs[logs.length - 1].transactionHash;
  },

  userError(err) {
    if (!err) return "알 수 없는 오류";

    const nested = err.error || err.info?.error || err.data?.originalError;
    if (nested && nested !== err) {
      const inner = this.userError(nested);
      if (inner && inner !== "알 수 없는 오류") return inner;
    }

    if (err.code === 4001 || err.code === "ACTION_REJECTED") {
      return "MetaMask에서 요청을 거부했습니다.";
    }
    if (err.code === 4902) {
      return "Hardhat Local 네트워크(31337)를 MetaMask에 추가해 주세요.";
    }

    const msg = String(err.reason || err.shortMessage || err.message || "");

    if (msg.includes("invalid account") || msg.includes("no such account")) {
      return "선택한 계정이 MetaMask에 연결되지 않았습니다. [연결 해제] → 계정 선택 → [MetaMask 연결] 순서로 다시 시도하세요.";
    }
    if (msg.includes("coalesce")) {
      const rpcMsg =
        err.error?.message ||
        err.info?.error?.message ||
        err.payload?.error?.message ||
        err.data?.message;
      if (rpcMsg) return this.userError({ message: rpcMsg, code: err.code });
      return (
        "MetaMask 연결 실패 — ① Hardhat node 실행(npm run demo:reset) " +
        "② MetaMask 네트워크 Chain ID 31337 " +
        "③ Coinbase Wallet 등 다른 지갑 확장 프로그램이 켜져 있으면 MetaMask만 사용"
      );
    }
    if (/internal json-rpc|nonce too (low|high)|NONCE_EXPIRED|-32603/i.test(msg)) {
      return (
        "MetaMask nonce 불일치 — demo:reset 후 체인이 초기화되면 발생합니다. " +
        "MetaMask → 설정 → Developer tools → 「Delete activity and nonce data」 실행 후 다시 시도하세요."
      );
    }
    if (/NotWhitelisted|not whitelisted/i.test(msg)) {
      return "화이트리스트 미등록 — npm run demo:reset 후 #4(Requester)로 재연결하세요.";
    }

    return msg || "알 수 없는 오류";
  },
};
