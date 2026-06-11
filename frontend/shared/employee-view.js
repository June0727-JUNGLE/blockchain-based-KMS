/** 직원 모드 — 문서 목록 · 일반/보안 열기 */
const EmployeeView = {
  root: null,
  address: null,
  documents: [],
  pollTimers: new Map(),
  modalEl: null,

  mount(rootEl, address) {
    this.unmount();
    this.root = rootEl;
    this.address = address;
    this.root.innerHTML = `
      <div class="employee-wrap">
        <section class="emp-card">
          <h2>사내 문서함</h2>
          <p class="emp-hint">일반 문서는 접근 기록 후 즉시 열람 · 보안 문서는 2-of-3 결재 후 복호화됩니다.</p>
          <div id="empDocList" class="doc-grid">
            <div class="emp-empty">문서 목록을 불러오는 중…</div>
          </div>
        </section>
        <section class="emp-card">
          <h2>내 보안 문서 요청 상태</h2>
          <div id="empRequestList" class="request-list">
            <div class="emp-empty">요청 내역 없음</div>
          </div>
        </section>
      </div>
      <div id="empModal" class="emp-modal" hidden>
        <div class="emp-modal-backdrop"></div>
        <div class="emp-modal-panel">
          <div class="emp-modal-header">
            <h3 id="empModalTitle">문서 내용</h3>
            <button type="button" id="empModalClose" class="emp-btn-secondary">닫기</button>
          </div>
          <pre id="empModalBody" class="emp-modal-body"></pre>
        </div>
      </div>`;

    this.modalEl = this.root.querySelector("#empModal");
    this.root.querySelector("#empModalClose").addEventListener("click", () => this.hideModal());
    this.root.querySelector(".emp-modal-backdrop").addEventListener("click", () => this.hideModal());

    this.loadDocuments();
    this.renderRequests();
    this._requestPoll = setInterval(() => this.renderRequests(), 4000);
  },

  unmount() {
    if (this._requestPoll) {
      clearInterval(this._requestPoll);
      this._requestPoll = null;
    }
    for (const t of this.pollTimers.values()) clearInterval(t);
    this.pollTimers.clear();
    if (this.root) this.root.innerHTML = "";
  },

  toast(msg) {
    if (typeof AppShell !== "undefined") AppShell.toast(msg);
  },

  showModal(title, content) {
    this.root.querySelector("#empModalTitle").textContent = title;
    this.root.querySelector("#empModalBody").textContent = content;
    this.modalEl.hidden = false;
  },

  hideModal() {
    if (this.modalEl) this.modalEl.hidden = true;
  },

  tierBadge(tier) {
    return tier === "secure"
      ? '<span class="tier-badge secure">보안</span>'
      : '<span class="tier-badge normal">일반</span>';
  },

  async loadDocuments() {
    const listEl = this.root.querySelector("#empDocList");
    try {
      this.documents = await KMSCore.fetchDocuments();
      if (this.documents.length === 0) {
        listEl.innerHTML = '<div class="emp-empty">등록된 문서가 없습니다. npm run seed:storage 실행</div>';
        return;
      }
      listEl.innerHTML = this.documents
        .map(
          (doc) => `
        <button type="button" class="doc-card" data-id="${doc.documentId}" data-tier="${doc.tier}">
          <div class="doc-card-top">
            <strong>${doc.title}</strong>
            ${this.tierBadge(doc.tier)}
          </div>
          <span class="doc-card-id mono">${KMSCore.shortAddr(doc.documentId)}…</span>
        </button>`
        )
        .join("");

      listEl.querySelectorAll(".doc-card").forEach((btn) => {
        btn.addEventListener("click", () =>
          this.openDocument(btn.dataset.id, btn.dataset.tier, btn.querySelector("strong").textContent)
        );
      });
    } catch (err) {
      listEl.innerHTML = `<div class="emp-error">${KMSCore.userError(err)}</div>`;
    }
  },

  async findExecutedRequest(documentId) {
    const contract = KMSCore.getReadContract();
    const nextId = Number(await contract.nextRequestId());
    for (let i = nextId - 1; i >= 0; i--) {
      const req = await contract.getRequest(i);
      if (
        req.exists &&
        req.executed &&
        req.requester.toLowerCase() === this.address.toLowerCase() &&
        String(req.documentId).toLowerCase() === documentId.toLowerCase()
      ) {
        return i;
      }
    }
    return null;
  },

  async openDocument(documentId, tier, title) {
    this.toast(`${title} 열기 처리 중…`);
    try {
      if (tier === "normal") {
        const write = KMSCore.getWriteContract();
        const receipt = await KMSCore.sendContractWrite({
          signerAddress: this.address,
          simulate: (read, from) =>
            read.logDocumentAccess.staticCall(documentId, { from }),
          send: (nonce) => write.logDocumentAccess(documentId, { gasLimit: 120000n, nonce }),
        });
        const body = await KMSCore.openDocument(documentId, this.address, receipt.hash);
        this.showModal(body.title || title, body.content);
        this.toast("일반 문서 열람 완료");
        return;
      }

      const readContract = KMSCore.getReadContract();
      const existingId = await this.findExecutedRequest(documentId);
      if (existingId !== null) {
        const txHash = await KMSCore.findDocumentAccessedTx(
          readContract,
          existingId,
          this.address
        );
        const body = await KMSCore.openDocument(documentId, this.address, txHash);
        this.showModal(body.title || title, body.content);
        this.toast("보안 문서 열람 완료 (기존 승인)");
        return;
      }

      const write = KMSCore.getWriteContract();
      this.toast("보안 문서 접근 요청 전송…");
      const receipt = await KMSCore.sendContractWrite({
        signerAddress: this.address,
        simulate: (read, from) =>
          read.requestDocumentAccess.staticCall(documentId, { from }),
        send: (nonce) => write.requestDocumentAccess(documentId, { gasLimit: 200000n, nonce }),
      });
      const parsed = KMSCore.parseEventFromReceipt(receipt, write, "AccessRequested");
      if (!parsed) throw new Error("AccessRequested 이벤트 없음");

      const requestId = parsed.args.requestId.toString();
      KMSCore.saveRequestId(this.address, requestId);
      this.toast(`요청 #${requestId} — 결재 대기 중`);
      await this.renderRequests();
      this.startSecurePoll(documentId, requestId, title);
    } catch (err) {
      this.toast(KMSCore.userError(err));
    }
  },

  startSecurePoll(documentId, requestId, title) {
    if (this.pollTimers.has(requestId)) return;

    const contract = KMSCore.getReadContract();
    const timer = setInterval(async () => {
      try {
        const req = await contract.getRequest(requestId);
        if (!req.executed) return;

        clearInterval(timer);
        this.pollTimers.delete(requestId);

        const txHash = await KMSCore.findDocumentAccessedTx(contract, requestId, this.address);
        const body = await KMSCore.openDocument(documentId, this.address, txHash);
        this.showModal(body.title || title, body.content);
        this.toast("보안 문서 복호화 완료");
        await this.renderRequests();
      } catch (err) {
        clearInterval(timer);
        this.pollTimers.delete(requestId);
        this.toast(KMSCore.userError(err));
      }
    }, 3000);

    this.pollTimers.set(requestId, timer);
  },

  async renderRequests() {
    const listEl = this.root.querySelector("#empRequestList");
    const contract = KMSCore.getReadContract();
    const ids = KMSCore.loadRequestIds(this.address);

    if (ids.length === 0) {
      listEl.innerHTML = '<div class="emp-empty">보안 문서 요청 내역이 없습니다.</div>';
      return;
    }

    const items = await Promise.all(
      ids.map(async (id) => {
        const req = await contract.getRequest(id);
        const status = KMSCore.requestStatusLabel(req);
        return `
          <div class="request-row">
            <div>
              <strong>Request #${id}</strong>
              <div class="request-meta mono">${String(req.documentId).slice(0, 18)}…</div>
            </div>
            <span class="status-badge ${status.cls}">${status.text}</span>
          </div>`;
      })
    );
    listEl.innerHTML = items.join("");
  },
};
