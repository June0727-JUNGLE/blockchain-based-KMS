# MultiSig-KMS — 구현 계획 (현재 → 목표)

> **작성 목적:** 시연용 MVP에서 **기능하는 프로그램**으로 전환하기 위해, 지금부터 수행할 작업을 단계별로 정리한 문서입니다.  
> **관련 문서:** [ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENT_HANDOFF.md](./AGENT_HANDOFF.md)

---

## 1. 현재 상태 vs 목표

### 현재 (시연용 MVP)

| 항목 | 상태 |
|------|------|
| `KMS.sol` | 2-of-3 multisig, whitelist, revoke ✅ |
| 단위 테스트 | 20 시나리오 ✅ |
| `deploy.js` / `test_kms.js` | localhost 배포·플로우 검증 ✅ |
| dApp | `user.html` / `admin.html` 분리, documentId 수동 입력 |
| 스토리지 | ❌ 없음 |
| 오프체인 KMS | ❌ 없음 |
| 일반/보안 문서 분기 | ❌ 전부 multisig 한 경로 |
| 지갑 자동 라우팅 | ❌ 페이지 수동 선택 |

### 목표 (기능하는 프로그램)

```text
app.html (단일 진입)
  MetaMask 연결
    ├─ Admin / Approver  → 관제 모드 (이벤트 모니터링 + 결재)
    └─ 화이트리스트 직원 → 직원 모드 (스토리지 문서 목록)

직원: 문서 열기
  ├─ 일반 문서 → logDocumentAccess tx (기록만) → 즉시 열람
  └─ 보안 문서 → requestDocumentAccess → 2-of-3 결재 → 승인 후 열람

관제: 온체인 이벤트 실시간 수집 (블록·시각·Tx·Gas)
```

---

## 2. 최종 디렉터리 구조 (목표)

```text
/workspace/
├── contracts/
│   └── KMS.sol                    # logDocumentAccess 추가
├── test/
│   └── KMS.test.js                # 일반 문서 테스트 추가
├── scripts/
│   ├── deploy.js
│   ├── seed-storage.js            # ★ 신규
│   └── test_kms.js
├── storage/                       # ★ 신규 (gitignore 대상)
│   ├── manifest.json
│   ├── plain/                     # 일반 문서
│   └── encrypted/                 # 보안 문서 (.enc)
├── offchain-kms/                  # ★ 신규
│   ├── server.js
│   ├── verify.js
│   └── decrypt.js
├── frontend/
│   ├── app.html                   # ★ 신규 (단일 앱)
│   ├── index.html                 # app.html 로 redirect
│   ├── shared/
│   │   ├── config.js
│   │   ├── kms-core.js
│   │   ├── kms-abi.json
│   │   ├── router.js              # ★ 신규
│   │   ├── employee-view.js       # ★ 신규
│   │   └── control-view.js        # ★ 신규
│   ├── user.html                  # deprecated → redirect
│   └── admin.html                 # deprecated → redirect
└── docs/
    ├── ARCHITECTURE.md            # 일반/보안 시퀀스 보강
    ├── AGENT_HANDOFF.md           # 구조 갱신
    └── IMPLEMENTATION_PLAN.md     # 본 문서
```

---

## 3. 구현 순서 (반드시 이 순서 권장)

```text
Phase 1  컨트랙트 확장
   ↓
Phase 2  스토리지 + 오프체인 KMS
   ↓
Phase 3  프론트 통합 (app.html)
   ↓
Phase 4  통합 시연·문서 정리
   ↓
Phase 5  (선택) Sepolia·운영 강화
```

> ⚠️ **프론트(Phase 3)를 컨트랙트(Phase 1)보다 먼저 하면** 일반 문서 플로우가 mock이 되어 이중 작업이 발생합니다.

---

## Phase 1 — 컨트랙트 확장

**목표:** 일반 문서(기록만)와 보안 문서(multisig)를 온체인에서 구분.

### 작업 목록

- [ ] **1-1.** `KMS.sol`에 `logDocumentAccess(bytes32 documentId)` 추가
  - 화이트리스트 검사 (`NotWhitelisted`)
  - `requestId` / 결재 흐름 **없음**
  - 이벤트 `DocumentAccessLogged(address indexed accessor, bytes32 indexed documentId)` emit
- [ ] **1-2.** `requestDocumentAccess`는 **보안 문서 전용**으로 유지 (기존 로직 그대로)
- [ ] **1-3.** `test/KMS.test.js`에 테스트 추가
  - [ ] 화이트리스트 직원 → `logDocumentAccess` → `DocumentAccessLogged` emit
  - [ ] 비화이트리스트 → revert
  - [ ] revoke 후 → revert
- [ ] **1-4.** `npm test` 전체 통과 확인
- [ ] **1-5.** `npx hardhat compile` 후 `frontend/shared/kms-abi.json` 재생성

### 완료 기준

- 기존 20개 + 신규 테스트 모두 green
- localhost 재배포 후 `logDocumentAccess` 호출 가능

---

## Phase 2 — 스토리지 + 오프체인 KMS

**목표:** 문서 목록·열기의 실제 데이터 소스와 온체인 검증 레이어.

### 2-1. 스토리지

- [ ] **2-1-1.** `storage/` 디렉터리 생성
- [ ] **2-1-2.** `scripts/seed-storage.js` 작성
  - 샘플 **일반 문서** 1~2개 → `storage/plain/`
  - 샘플 **보안 문서** 1~2개 → AES 암호화 → `storage/encrypted/`
  - `documentId = ethers.id(label)` 계산
- [ ] **2-1-3.** `storage/manifest.json` 생성

```json
{
  "documents": [
    {
      "id": "doc-001",
      "title": "2024년 사내 공지",
      "tier": "normal",
      "documentId": "0x...",
      "path": "plain/notice-2024.txt"
    },
    {
      "id": "doc-002",
      "title": "Encrypted_Log.dat#vehicle-001",
      "tier": "secure",
      "documentId": "0x...",
      "path": "encrypted/vehicle-001.log.enc"
    }
  ]
}
```

- [ ] **2-1-4.** `.gitignore`에 `storage/encrypted/`, `.env` 키 등 민감 경로 확인

### 2-2. 오프체인 KMS 서버

- [ ] **2-2-1.** `offchain-kms/server.js` — Express 기본 서버 (port 4000)
- [ ] **2-2-2.** `GET /api/documents` — manifest 기반 목록 (title, tier, documentId)
- [ ] **2-2-3.** `POST /api/open` — body: `{ documentId, requester, txHash }`

| tier | 온체인 검증 | 응답 |
|------|-------------|------|
| `normal` | tx receipt에 `DocumentAccessLogged(requester, documentId)` | plain 파일 내용 |
| `secure` | `DocumentAccessed` + `getRequest(requestId).executed` + requester 일치 | 복호화 내용 |

- [ ] **2-2-4.** `offchain-kms/verify.js` — receipt·이벤트·view 함수 재검증
- [ ] **2-2-5.** `offchain-kms/decrypt.js` — 보안 문서 AES 복호화
- [ ] **2-2-6.** `.env.example`에 `STORAGE_MASTER_KEY`, `KMS_RPC_URL`, `KMS_CONTRACT_ADDRESS` 추가

### 2-3. package.json 스크립트

- [ ] **2-3-1.** `"seed:storage": "node scripts/seed-storage.js"`
- [ ] **2-3-2.** `"kms:server": "node offchain-kms/server.js"`

### 완료 기준

- curl/Postman으로 `/api/documents` 목록 조회 가능
- normal: `logDocumentAccess` tx 후 `/api/open` → 내용 반환
- secure: `DocumentAccessed` 없으면 403, 있으면 복호화 반환

---

## Phase 3 — 프론트 통합 (`app.html`)

**목표:** 지갑 연결 → 역할 자동 분기 → 문서 목록 UX.

### 3-1. 라우팅

- [ ] **3-1-1.** `frontend/shared/router.js` 작성

```text
연결 address
  ├─ hasRole(DEFAULT_ADMIN_ROLE)  → 관제 모드
  ├─ hasRole(APPROVER_ROLE)       → 관제 모드 (+ 결재 탭)
  ├─ isWhitelisted()              → 직원 모드
  └─ 그 외                        → 권한 없음 화면
```

### 3-2. 직원 모드 (`employee-view.js`)

- [ ] **3-2-1.** `GET /api/documents` → 카드 목록 (일반/보안 뱃지)
- [ ] **3-2-2.** 문서 클릭 — **normal**
  1. `logDocumentAccess(documentId)` MetaMask tx
  2. `POST /api/open` → 내용 모달/패널 표시
- [ ] **3-2-3.** 문서 클릭 — **secure**
  1. `requestDocumentAccess(documentId)` → requestId 표시
  2. 상태 폴링 (대기 / 1-2 / 승인 완료)
  3. 승인 완료 후 `POST /api/open` → 복호화 내용 표시
- [ ] **3-2-4.** 스타일: 화이트/블루 오피스 테마

### 3-3. 관제 모드 (`control-view.js`)

- [ ] **3-3-1.** **탭 1 — 감사 모니터** (Admin·Approver 공통)
  - `AccessRequested`, `AccessApproved`, `DocumentAccessed`
  - `DocumentAccessLogged`, `PermissionGranted`, `PermissionRevoked`
  - 블록 번호 · 시각 · Tx Hash · Gas append-only 누적
- [ ] **3-3-2.** **탭 2 — 결재** (Approver만)
  - pending 큐 + `approveAccess` 버튼
- [ ] **3-3-3.** **탭 3 — 접근 제어** (Admin만, 선택)
  - `grantPermission` / `revokePermission`
- [ ] **3-3-4.** 스타일: 다크 모드 관제센터 테마

### 3-4. 진입점 정리

- [ ] **3-4-1.** `frontend/app.html` — 단일 SPA (탭/뷰 전환, 빌드 도구 없이)
- [ ] **3-4-2.** `frontend/index.html` → `app.html` redirect
- [ ] **3-4-3.** `user.html` / `admin.html` → `app.html` redirect (백업용 유지 가능)

### 완료 기준

- Account #4 연결 → 직원 모드 자동 진입, 문서 목록 표시
- Account #0 → 관제 모드 (모니터링)
- Account #1·#2 → 관제 모드 + 결재 가능
- **한 URL**에서 역할만 바뀜

---

## Phase 4 — 통합 시연·문서

### 작업 목록

- [ ] **4-1.** `scripts/deploy.js` — 배포 후 `grantPermission(requester)` + 안내 메시지
- [ ] **4-2.** README.md — 시연 5분 스크립트·실행 명령 갱신
- [ ] **4-3.** `ARCHITECTURE.md` — 일반/보안 분기 시퀀스 다이어그램 추가
- [ ] **4-4.** `AGENT_HANDOFF.md` — 디렉터리·Phase 상태 갱신
- [ ] **4-5.** 전체 리허설 (아래 시나리오)

### 시연 시나리오 (5분)

| 순서 | MetaMask 계정 | 동작 | 기대 결과 |
|------|---------------|------|-----------|
| 1 | #4 Requester | `app.html` 연결 | 직원 모드 자동 진입 |
| 2 | #4 | 일반 문서 열기 | tx 1건 + **즉시 내용** |
| 3 | #4 | 보안 문서 열기 | requestId + **대기** |
| 4 | #0 Admin | 관제 모드 연결 | 2번 `DocumentAccessLogged` 표시 |
| 5 | #1, #2 Approver | 결재 | `DocumentAccessed` |
| 6 | #4 | 보안 문서 재열기 | **복호화 내용** |
| 7 | #0 | revoke #4 | 킬스위치 |
| 8 | #4 | 문서 열기 시도 | 온체인 revert + API 403 |

### 로컬 실행 (4터미널)

```bash
# T1
npx hardhat node

# T2
npx hardhat run scripts/deploy.js --network localhost

# T3
npm run seed:storage
npm run kms:server

# T4
npx serve frontend -p 3000
# → http://localhost:3000/app.html
```

---

## Phase 5 — (선택) 운영·확장

- [ ] Arbitrum Sepolia 배포 + `config.js` network switch
- [ ] revoke 후 pending 요청 — `cancelRequest` 검토
- [ ] open API 감사 DB (SQLite)
- [ ] mTLS / signed URL (운영 환경)

---

## 4. 설계 결정 (확정 권장)

| 질문 | 권장 |
|------|------|
| 일반 문서도 파일이 스토리지에 있나? | **예** — `plain/`에 두고 목록 UX 통일 |
| Approver도 관제 모드? | **예** — Admin=모니터+접근제어, Approver=모니터+결재 |
| 컨트랙트 수정 후 | **재배포** → `config.js`·ABI·deploy.js 주소 갱신 |
| 기존 user/admin.html | Phase 3 후 redirect만 두고 당분간 유지 |

---

## 5. 역할 · 계정 매핑 (Hardhat localhost)

| 역할 | Account | 주소 (기본) |
|------|---------|-------------|
| Admin | #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Approver 1 | #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Approver 2 | #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| Approver 3 | #3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| Requester | #4 | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` |

MetaMask: Chain ID **31337**, RPC `http://127.0.0.1:8545`

---

## 6. 지금 당장 시작할 일 (Next Action)

**오늘/이번 작업 세션에서 할 것:**

1. [ ] `contracts/KMS.sol` — `logDocumentAccess` + `DocumentAccessLogged` 추가
2. [ ] `test/KMS.test.js` — 일반 문서 테스트 3~4개 추가
3. [ ] `npm test` 실행 → green 확인
4. [ ] localhost 재배포 후 새 함수 수동 호출 테스트

Phase 1 완료 후 → Phase 2 (`seed-storage.js`, `offchain-kms/server.js`) 진행.

---

## 7. 진행 상태 추적

| Phase | 상태 | 완료일 |
|-------|------|--------|
| Phase 1 — 컨트랙트 | ⬜ 미착수 | |
| Phase 2 — 스토리지·오프체인 | ⬜ 미착수 | |
| Phase 3 — app.html | ⬜ 미착수 | |
| Phase 4 — 시연·문서 | ⬜ 미착수 | |
| Phase 5 — (선택) Sepolia | ⬜ 미착수 | |

> Phase 완료 시 `[x]` 체크 및 완료일 기록.

---

*마지막 갱신: 2026-06-08*
