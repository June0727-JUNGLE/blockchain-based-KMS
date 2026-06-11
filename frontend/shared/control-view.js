/** 관제 모드 — 감사 모니터 · 결재 · 접근 제어 */
const ControlView = {
  root: null,
  address: null,
  role: null,
  readContract: null,
  writeContract: null,
  isApprover: false,
  mounted: false,
  auditEntries: [],
  seenLogKeys: new Set(),
  activeTab: "audit",
  _unsubscribeAudit: null,
  _pendingPoll: null,
  _accessPoll: null,

  mount(rootEl, address, role) {
    this.unmount();
    this.root = rootEl;
    this.address = address;
    this.role = role;
    this.mounted = true;
    this.isApprover = role === KMSRouter.ROLES.APPROVER;
    this.readContract = KMSCore.getReadContract();
    this.writeContract = KMSCore.getWriteContract();

    const showApproval = this.isApprover;
    const showAccess = role === KMSRouter.ROLES.ADMIN;

    this.root.innerHTML = `
      <div class="control-wrap">
        <nav class="ctrl-tabs">
          <button type="button" class="ctrl-tab active" data-tab="audit">감사 모니터</button>
          ${showApproval ? '<button type="button" class="ctrl-tab" data-tab="approval">결재</button>' : ""}
          ${showAccess ? '<button type="button" class="ctrl-tab" data-tab="access">접근 제어</button>' : ""}
        </nav>
        <div id="ctrlPanelAudit" class="ctrl-panel">
          <div class="ctrl-panel-head">
            <h2>🔒 온체인 감사 로그 <span class="live-dot">LIVE</span></h2>
            <span id="ctrlAuditCount">0건</span>
          </div>
          <p class="ctrl-hint">블록 · 시각 · Tx Hash · Gas — 체인에 기록된 전체 이력</p>
          <textarea id="ctrlAuditLog" class="ctrl-audit-log" readonly spellcheck="false" placeholder="감사 로그 불러오는 중…"></textarea>
        </div>
        ${
          showApproval
            ? `<div id="ctrlPanelApproval" class="ctrl-panel" hidden>
          <h2>대기 중인 결재 큐</h2>
          <div class="ctrl-table-wrap">
            <table class="ctrl-table">
              <thead><tr>
                <th>ID</th><th>요청자</th><th>documentId</th><th>승인</th><th>액션</th>
              </tr></thead>
              <tbody id="ctrlPendingBody"><tr><td colspan="5" class="ctrl-empty">조회 중…</td></tr></tbody>
            </table>
          </div>
          <div class="ctrl-manual">
            <label>수동 결재 (requestId)</label>
            <div class="ctrl-manual-row">
              <input id="ctrlManualId" type="number" min="0" placeholder="0" />
              <button type="button" id="ctrlManualApprove" class="ctrl-btn-approve">approveAccess</button>
            </div>
            <p id="ctrlApproveErr" class="ctrl-err"></p>
          </div>
        </div>`
            : ""
        }
        ${
          showAccess
            ? `<div id="ctrlPanelAccess" class="ctrl-panel" hidden>
          <h2>화이트리스트 접근 제어</h2>
          <p class="ctrl-hint">권한 없는 계정이 앱에 연결하면 아래 「접속 시도」 목록에 표시됩니다. 승인=grantPermission · 거절=목록에서 제거</p>
          <h3 style="font-size:0.82rem;color:var(--ctrl-accent2);margin:0.75rem 0 0.4rem;">접속 시도 (승인 대기)</h3>
          <div class="ctrl-table-wrap">
            <table class="ctrl-table">
              <thead><tr>
                <th>계정</th><th>접속 시각</th><th>상태</th><th>액션</th>
              </tr></thead>
              <tbody id="ctrlAccessPendingBody"><tr><td colspan="4" class="ctrl-empty">조회 중…</td></tr></tbody>
            </table>
          </div>
          <h3 style="font-size:0.82rem;color:var(--ctrl-accent);margin:1rem 0 0.4rem;">등록된 직원 (화이트리스트)</h3>
          <div class="ctrl-table-wrap">
            <table class="ctrl-table">
              <thead><tr>
                <th>계정</th><th>상태</th><th>액션</th>
              </tr></thead>
              <tbody id="ctrlAccessListedBody"><tr><td colspan="3" class="ctrl-empty">조회 중…</td></tr></tbody>
            </table>
          </div>
          <div class="ctrl-manual" style="margin-top:1rem;">
            <label>수동 주소 입력</label>
            <input id="ctrlTargetAddr" type="text" placeholder="0x… (비워두면 선택한 행 주소 사용)" />
            <div class="ctrl-manual-row" style="margin-top:0.5rem;">
              <button type="button" id="ctrlGrant" class="ctrl-btn-grant">grantPermission</button>
              <button type="button" id="ctrlRevoke" class="ctrl-btn-revoke">revokePermission</button>
            </div>
          </div>
          <p id="ctrlAccessErr" class="ctrl-err"></p>
        </div>`
            : ""
        }
      </div>`;

    this.root.querySelectorAll(".ctrl-tab").forEach((btn) => {
      btn.addEventListener("click", () => this.switchTab(btn.dataset.tab));
    });

    if (showApproval) {
      this.root.querySelector("#ctrlManualApprove").addEventListener("click", () => {
        const id = this.root.querySelector("#ctrlManualId").value;
        if (id === "") {
          this.root.querySelector("#ctrlApproveErr").textContent = "requestId를 입력하세요.";
          return;
        }
        this.approveRequest(id);
      });
    }

    if (showAccess) {
      this.root.querySelector("#ctrlGrant").addEventListener("click", () => this.grantAccess());
      this.root.querySelector("#ctrlRevoke").addEventListener("click", () => this.revokeAccess());
      this.refreshAccessPanel();
      this._accessPoll = setInterval(() => this.refreshAccessPanel(), 4000);
    }

    this._unsubscribeAudit = KMSCore.subscribeAudit((entry) => this.onLiveAudit(entry));

    this.bootstrapAudit().catch((err) => {
      if (!this.mounted) return;
      const ta = this.root?.querySelector("#ctrlAuditLog");
      if (ta) ta.value = `감사 로그 로드 실패: ${KMSCore.userError(err)}\n`;
      this.toast(KMSCore.userError(err));
    });

    if (showApproval) {
      this.refreshPending();
      this._pendingPoll = setInterval(() => this.refreshPending(), 4000);
    }
  },

  unmount() {
    this.mounted = false;
    if (this._pendingPoll) {
      clearInterval(this._pendingPoll);
      this._pendingPoll = null;
    }
    if (this._accessPoll) {
      clearInterval(this._accessPoll);
      this._accessPoll = null;
    }
    if (this._unsubscribeAudit) {
      this._unsubscribeAudit();
      this._unsubscribeAudit = null;
    }
    this.auditEntries = [];
    this.seenLogKeys.clear();
    if (this.root) this.root.innerHTML = "";
    this.root = null;
  },

  toast(msg) {
    if (typeof AppShell !== "undefined") AppShell.toast(msg);
  },

  switchTab(tab) {
    if (!this.mounted || !this.root) return;
    this.activeTab = tab;
    this.root.querySelectorAll(".ctrl-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    this.root.querySelector("#ctrlPanelAudit").hidden = tab !== "audit";
    const approval = this.root.querySelector("#ctrlPanelApproval");
    const access = this.root.querySelector("#ctrlPanelAccess");
    if (approval) approval.hidden = tab !== "approval";
    if (access) access.hidden = tab !== "access";
  },

  sortAuditEntries() {
    this.auditEntries.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return a.logIndex - b.logIndex;
    });
  },

  renderAuditLog() {
    if (!this.mounted || !this.root) return;
    const ta = this.root.querySelector("#ctrlAuditLog");
    if (!ta) return;
    this.sortAuditEntries();
    ta.value = this.auditEntries.map((e) => e.line).join("\n") + (this.auditEntries.length ? "\n" : "");
    ta.scrollTop = ta.scrollHeight;
    const countEl = this.root.querySelector("#ctrlAuditCount");
    if (countEl) countEl.textContent = `${this.auditEntries.length}건`;
  },

  async addAuditEntry({ name, args, txHash, blockNumber, logIndex, dedupeKey }) {
    if (!this.mounted) return;
    if (this.seenLogKeys.has(dedupeKey)) return;
    this.seenLogKeys.add(dedupeKey);
    const line = await this.formatAuditLine(name, args, txHash, blockNumber);
    if (!this.mounted) return;
    this.auditEntries.push({
      blockNumber: Number(blockNumber),
      logIndex: Number(logIndex ?? 0),
      line,
      dedupeKey,
    });
    this.renderAuditLog();
  },

  onLiveAudit(entry) {
    if (!this.mounted) return;
    this.addAuditEntry(entry);
    if (this.isApprover) this.refreshPending();
    if (
      entry.name === "PermissionGranted" ||
      entry.name === "PermissionRevoked"
    ) {
      this.refreshAccessPanel();
    }
  },

  formatAttemptTime(ts) {
    return new Date(ts).toLocaleString("ko-KR", { hour12: false });
  },

  setTargetAddress(address) {
    const input = this.root?.querySelector("#ctrlTargetAddr");
    if (input) input.value = address;
  },

  async refreshAccessPanel() {
    if (!this.mounted || !this.root) return;
    const pendingBody = this.root.querySelector("#ctrlAccessPendingBody");
    const listedBody = this.root.querySelector("#ctrlAccessListedBody");
    if (!pendingBody || !listedBody) return;

    const contract = this.readContract;
    const attempts = KMSCore.listAccessAttempts();
    const pendingRows = [];
    const listedRows = [];
    const listedAddrs = new Set();

    for (const item of attempts) {
      const addr = item.address;
      const whitelisted = await contract.isWhitelisted(addr);
      const label = KMSCore.demoAccountHint(addr);
      if (whitelisted) {
        listedAddrs.add(addr.toLowerCase());
        listedRows.push(`
          <tr>
            <td><span class="mono">${label}</span><br /><span class="mono" style="opacity:0.7;font-size:0.7rem;">${KMSCore.shortAddr(addr)}</span></td>
            <td><span class="ctrl-status-on">등록됨</span></td>
            <td>
              <button type="button" class="ctrl-btn-revoke ctrl-access-revoke" data-addr="${addr}">회수</button>
            </td>
          </tr>`);
        continue;
      }
      pendingRows.push(`
        <tr>
          <td><span class="mono">${label}</span><br /><span class="mono" style="opacity:0.7;font-size:0.7rem;">${KMSCore.shortAddr(addr)}</span></td>
          <td>${this.formatAttemptTime(item.at)}</td>
          <td><span class="ctrl-status-off">미등록</span></td>
          <td>
            <button type="button" class="ctrl-btn-grant ctrl-access-grant" data-addr="${addr}">승인</button>
            <button type="button" class="ctrl-btn-dismiss ctrl-access-dismiss" data-addr="${addr}">거절</button>
          </td>
        </tr>`);
    }

    const scanAddrs = [KMS_CONFIG.demoAccounts.requester];

    for (const addr of scanAddrs) {
      if (listedAddrs.has(addr.toLowerCase())) continue;
      if (attempts.some((item) => item.address.toLowerCase() === addr.toLowerCase())) continue;
      const whitelisted = await contract.isWhitelisted(addr);
      if (!whitelisted) continue;
      const label = KMSCore.demoAccountHint(addr);
      listedRows.push(`
        <tr>
          <td><span class="mono">${label || KMSCore.shortAddr(addr)}</span><br /><span class="mono" style="opacity:0.7;font-size:0.7rem;">${KMSCore.shortAddr(addr)}</span></td>
          <td><span class="ctrl-status-on">등록됨</span></td>
          <td>
            <button type="button" class="ctrl-btn-revoke ctrl-access-revoke" data-addr="${addr}">회수</button>
          </td>
        </tr>`);
    }

    if (!this.mounted) return;

    pendingBody.innerHTML = pendingRows.length
      ? pendingRows.join("")
      : '<tr><td colspan="4" class="ctrl-empty">접속 시도 중인 계정이 없습니다. (#4 등으로 연결해 보세요)</td></tr>';

    listedBody.innerHTML = listedRows.length
      ? listedRows.join("")
      : '<tr><td colspan="3" class="ctrl-empty">화이트리스트에 등록된 직원이 없습니다.</td></tr>';

    pendingBody.querySelectorAll(".ctrl-access-grant").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setTargetAddress(btn.dataset.addr);
        this.grantAccess(btn.dataset.addr);
      });
    });
    pendingBody.querySelectorAll(".ctrl-access-dismiss").forEach((btn) => {
      btn.addEventListener("click", () => {
        KMSCore.dismissAccessAttempt(btn.dataset.addr);
        this.toast("접속 시도 목록에서 제거했습니다.");
        this.refreshAccessPanel();
      });
    });
    listedBody.querySelectorAll(".ctrl-access-revoke").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setTargetAddress(btn.dataset.addr);
        this.revokeAccess(btn.dataset.addr);
      });
    });
  },

  async formatAuditLine(name, args, txHash, blockNumber) {
    const meta = await KMSCore.receiptMeta(KMSCore.provider, txHash);
    const time = meta.timestamp ? KMSCore.formatTimestamp(meta.timestamp) : "—";
    const argStr = Object.keys(args)
      .filter((k) => isNaN(Number(k)))
      .map((k) => {
        const v = args[k];
        return `${k}=${typeof v === "bigint" ? v.toString() : v}`;
      })
      .join(" ");
    return (
      `[${time}] Block #${blockNumber ?? meta.blockNumber} | Gas: ${meta.gasUsed} | Tx: ${txHash}\n` +
      `  ▶ ${name} { ${argStr} }`
    );
  },

  async bootstrapAudit() {
    const contract = this.readContract;
    const provider = KMSCore.provider;
    const ta = this.root.querySelector("#ctrlAuditLog");
    if (ta) ta.value = "감사 로그 불러오는 중…\n";

    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 5000);

    const collected = [];
    for (const name of KMSCore.AUDIT_EVENTS) {
      const logs = await contract.queryFilter(contract.filters[name](), fromBlock, latest);
      for (const log of logs) {
        collected.push({ name, log });
      }
    }

    collected.sort((a, b) => {
      const blockA = Number(a.log.blockNumber);
      const blockB = Number(b.log.blockNumber);
      if (blockA !== blockB) return blockA - blockB;
      return Number(a.log.index) - Number(b.log.index);
    });

    for (const { name, log } of collected) {
      if (!this.mounted) return;
      const parsed = contract.interface.parseLog(log);
      await this.addAuditEntry({
        name,
        args: parsed.args,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.index,
        dedupeKey: `${log.transactionHash}-${log.index}`,
      });
    }
  },

  async refreshPending() {
    if (!this.mounted || !this.root) return;
    const tbody = this.root.querySelector("#ctrlPendingBody");
    if (!tbody) return;

    const contract = this.readContract;
    const nextId = await contract.nextRequestId();
    const rows = [];

    for (let i = 0; i < Number(nextId); i++) {
      const req = await contract.getRequest(i);
      if (!req.exists || req.executed) continue;
      rows.push(`
        <tr>
          <td><strong>#${i}</strong></td>
          <td class="mono">${KMSCore.shortAddr(req.requester)}</td>
          <td class="mono">${String(req.documentId).slice(0, 14)}…</td>
          <td>${req.approvalCount} / 2</td>
          <td><button type="button" class="ctrl-btn-approve ctrl-approve-row" data-id="${i}">서명</button></td>
        </tr>`);
    }

    if (!this.mounted) return;
    tbody.innerHTML = rows.length
      ? rows.join("")
      : '<tr><td colspan="5" class="ctrl-empty">대기 중인 요청이 없습니다.</td></tr>';

    tbody.querySelectorAll(".ctrl-approve-row").forEach((btn) => {
      btn.addEventListener("click", () => this.approveRequest(btn.dataset.id));
    });
  },

  async approveRequest(requestId) {
    const errEl = this.root?.querySelector("#ctrlApproveErr");
    if (errEl) errEl.textContent = "";
    try {
      const write = this.writeContract;
      await KMSCore.sendPrivilegedWrite({
        signerAddress: this.address,
        role: "approver",
        simulate: (read, from) =>
          read.approveAccess.staticCall(requestId, { from }),
        send: (nonce) => write.approveAccess(requestId, { gasLimit: 200000n, nonce }),
      });
      this.toast(`Request #${requestId} 결재 완료`);
      await this.refreshPending();
    } catch (err) {
      const msg = KMSCore.userError(err);
      if (errEl) errEl.textContent = msg;
      this.toast(msg);
    }
  },

  resolveTargetAddress(explicit) {
    const raw = (explicit || this.root.querySelector("#ctrlTargetAddr").value || "").trim();
    if (!raw) throw new Error("대상 지갑 주소를 입력하거나 목록에서 선택하세요.");
    return KMSCore.normalizeAddress(raw);
  },

  async grantAccess(explicitTarget) {
    const errEl = this.root.querySelector("#ctrlAccessErr");
    errEl.textContent = "";
    try {
      const target = this.resolveTargetAddress(explicitTarget);
      const whitelisted = await this.readContract.isWhitelisted(target);
      if (whitelisted) {
        throw new Error("이미 화이트리스트에 등록된 계정입니다.");
      }
      const write = this.writeContract;
      await KMSCore.sendPrivilegedWrite({
        signerAddress: this.address,
        role: "admin",
        simulate: (read, from) => read.grantPermission.staticCall(target, { from }),
        send: (nonce) => write.grantPermission(target, { gasLimit: 150000n, nonce }),
      });
      KMSCore.dismissAccessAttempt(target);
      this.toast(`${KMSCore.demoAccountHint(target)} grantPermission 완료`);
      await this.refreshAccessPanel();
    } catch (err) {
      errEl.textContent = KMSCore.userError(err);
      this.toast(KMSCore.userError(err));
    }
  },

  async revokeAccess(explicitTarget) {
    const errEl = this.root.querySelector("#ctrlAccessErr");
    errEl.textContent = "";
    try {
      const target = this.resolveTargetAddress(explicitTarget);
      const whitelisted = await this.readContract.isWhitelisted(target);
      if (!whitelisted) {
        throw new Error("화이트리스트에 없는 계정입니다. revoke할 수 없습니다.");
      }
      const write = this.writeContract;
      await KMSCore.sendPrivilegedWrite({
        signerAddress: this.address,
        role: "admin",
        simulate: (read, from) => read.revokePermission.staticCall(target, { from }),
        send: (nonce) => write.revokePermission(target, { gasLimit: 150000n, nonce }),
      });
      this.toast(`${KMSCore.demoAccountHint(target)} revokePermission 완료`);
      await this.refreshAccessPanel();
    } catch (err) {
      errEl.textContent = KMSCore.userError(err);
      this.toast(KMSCore.userError(err));
    }
  },
};
