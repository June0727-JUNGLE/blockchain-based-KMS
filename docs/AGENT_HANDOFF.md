# MultiSig-KMS — AI 에이전트 온보딩 가이드

> 다른 AI 에이전트가 이 저장소를 빠르게 이해하고 작업을 이어갈 수 있도록 작성한 문서입니다.

---

## 1. 프로젝트 한 줄 요약

**MultiSig-KMS**는 기업·차량 관제 환경에서 **암호화된 기밀 로그의 복호화 권한**을 중앙 DB 마스터 키 대신 **Arbitrum L2 스마트 컨트랙트(2-of-3 멀티시그)** 로 통제하는 Hardhat 프로젝트입니다.

- **오프체인:** 원본 파일(`Encrypted_Log.dat`)은 On-Premise에만 보관 (미구현, 설계만 존재)
- **온체인:** `contracts/KMS.sol` — 화이트리스트, 승인, revoke, 감사 이벤트 (**구현 완료**)

---

## 2. 디렉토리 구조 & 역할

```text
/workspace/                          # 프로젝트 루트 (Dev Container: /workspace)
│
├── contracts/
│   └── KMS.sol                      # ★ 핵심 스마트 컨트랙트 (유일한 Solidity 소스)
│
├── test/
│   └── KMS.test.js                  # Hardhat + Chai 테스트 (20개 시나리오)
│
├── docs/
│   ├── ARCHITECTURE.md              # 하이브리드 아키텍처, 시퀀스, 보안 매핑
│   └── AGENT_HANDOFF.md             # 본 문서 (에이전트용)
│
├── .devcontainer/
│   └── devcontainer.json            # Docker Dev Container (Node 20, Hardhat 확장)
│
├── hardhat.config.js                # Solidity 0.8.20, optimizer, 네트워크 설정
├── package.json                     # npm 스크립트: compile, test
├── package-lock.json                # 의존성 잠금 (에이전트 컨텍스트에서 보통 제외)
│
├── .env.example                     # 환경 변수 템플릿 (커밋 OK)
├── .env                             # 실제 RPC URL·PRIVATE_KEY (gitignore, 레포에 없음)
├── .gitignore                       # .env, node_modules/, artifacts/, cache/ 제외
├── .cursorignore                    # AI 컨텍스트 제외: artifacts, cache, node_modules 등
│
├── README.md                        # 사람용: 설치, 실행, API 요약
│
├── node_modules/                    # npm 의존성 (gitignore, 로컬 생성)
├── artifacts/                       # Hardhat 컴파일 산출물 (gitignore)
└── cache/                           # Solidity 컴파일 캐시 (gitignore)
```

### 아직 없는 경로 (로드맵)

| 경로 | 예정 역할 | Phase |
|------|-----------|-------|
| `scripts/deploy.js` | Arbitrum Sepolia 배포 | B |
| `frontend/` | dApp UI | D |
| 오프체인 KMS 서버 코드 | `DocumentAccessed` 검증 후 복호화 | C |

---

## 3. 핵심 파일 상세

### `contracts/KMS.sol`

| 항목 | 내용 |
|------|------|
| 상속 | OpenZeppelin `AccessControl` |
| 역할 | `DEFAULT_ADMIN_ROLE` (관리자), `APPROVER_ROLE` (승인자 3명) |
| 상수 | `REQUIRED_APPROVALS = 2`, `MAX_APPROVERS = 3` |
| 상태 | `_whitelist` mapping, `_requests[requestId]` (멀티시그 요청) |

**주요 함수**

| 함수 | 호출자 | 역할 |
|------|--------|------|
| `grantPermission(address)` | Admin | 화이트리스트 등록 |
| `revokePermission(address)` | Admin | 긴급 권한 회수 |
| `requestDocumentAccess(bytes32)` | 화이트리스트 | 접근 요청 생성 |
| `approveAccess(uint256)` | Approver | 2표 모이면 `DocumentAccessed` emit |
| `isWhitelisted`, `getRequest`, `hasApproved` | view | 조회 |

**이벤트:** `PermissionGranted`, `PermissionRevoked`, `AccessRequested`, `AccessApproved`, `DocumentAccessed`

**중요:** 컨트랙트는 **키·파일을 전달하지 않음**. `DocumentAccessed`는 오프체인 KMS가 복호화해도 된다는 **온체인 허가서**이다.

### `test/KMS.test.js`

- `npx hardhat test` 또는 `npm test`
- constructor, grant, request, 2-of-3 approve, revoke, 역할·revert 시나리오 커버
- 수정 `KMS.sol` 후 반드시 테스트 재실행

### `hardhat.config.js`

- Solidity `0.8.20`, optimizer `runs: 200`
- `networks.localhost` — 로컬 노드
- `networks.arbitrumSepolia` — `process.env.ARBITRUM_SEPOLIA_URL`, `process.env.PRIVATE_KEY`

### `.env.example` → `.env`

```env
ARBITRUM_SEPOLIA_URL=...
PRIVATE_KEY=...
```

**절대 `.env`를 커밋하지 말 것** (`.gitignore`에 등록됨).

---

## 4. 기술 스택

| 레이어 | 도구 |
|--------|------|
| 언어 | Solidity ^0.8.20 |
| 프레임워크 | Hardhat 2.x |
| 라이브러리 | @openzeppelin/contracts 5.x |
| 테스트 | @nomicfoundation/hardhat-toolbox, Chai, ethers (Hardhat 내장) |
| 설정 | dotenv |
| 타깃 체인 | Arbitrum Sepolia (설정만, 배포 미완) |
| 개발 환경 | Dev Container (Node 20 bullseye) |

---

## 5. 자주 쓰는 명령

```bash
npm install
npm run compile          # 또는 npx hardhat compile
npm test                 # 20 passing 기대
```

배포(Phase B 이후):

```bash
npx hardhat run scripts/deploy.js --network arbitrumSepolia
```

---

## 6. Git / 원격

- **원격:** `https://github.com/June0727-JUNGLE/blockchain-based-KMS.git`
- **브랜치:** `main`
- Dev Container 내 `git push`는 GitHub 인증 없으면 실패할 수 있음 → 호스트 터미널에서 푸시

**주요 커밋 흐름**

1. `40ef358` — Hardhat + KMS.sol
2. `8a49dc2` — 테스트
3. `2756660` — README, .env.example, docs

---

## 7. 설계 제약 & 알려진 갭 (에이전트가 건드릴 때 참고)

| 항목 | 설명 |
|------|------|
| Admin SPoF | 단일 admin이 grant/revoke 전권 |
| pending + revoke | revoke 후에도 **이미 생성된 pending 요청**은 2승인으로 완료 가능 (Phase C에서 `cancelRequest` 검토) |
| `InvalidApproverCount` | 선언만 있고 미사용 |
| 오프체인 KMS | 코드 없음 — `docs/ARCHITECTURE.md` 시퀀스만 정의 |
| L2 실증 | Sepolia 배포·가스 측정 없음 |

---

## 8. 작업 시 권장 우선순위

1. **Phase B:** `scripts/deploy.js`, Sepolia 배포, README에 주소·가스 기록
2. **Phase C:** `cancelRequest`, 오프체인 이벤트 리스너 스펙/스크립트
3. **Phase D:** 최소 dApp

---

## 9. 관련 문서 읽기 순서

1. `docs/AGENT_HANDOFF.md` (본 문서) — 구조·역할
2. `docs/ARCHITECTURE.md` — 하이브리드·시퀀스·보안
3. `contracts/KMS.sol` — 구현 상세
4. `test/KMS.test.js` — 기대 동작
5. `README.md` — 사용자-facing 요약

---

## 10. AI 컨텍스트 수집 시

`.cursorignore`로 다음은 제외됨: `artifacts/`, `cache/`, `node_modules/`, `package-lock.json`, `.git/`

핵심 소스는 **`contracts/`**, **`test/`**, **`docs/`**, **`hardhat.config.js`** 만 읽어도 대부분의 작업 가능.
