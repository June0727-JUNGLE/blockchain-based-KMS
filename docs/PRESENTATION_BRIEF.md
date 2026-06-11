# MultiSig-KMS 발표 슬라이드 제작용 브리프

> 아래 전체 내용을 다른 생성형 AI(Gamma, Canva AI, ChatGPT, Claude 등)에 **그대로 복사·붙여넣기**하여 발표 슬라이드를 만들어 달라고 요청하세요.

---

## AI에게 주는 지시문 (맨 위에 함께 붙여넣기)

```
다음 프로젝트 설명을 바탕으로 대학교 블록체인 실습 과목 최종 발표용 PPT 슬라이드를 만들어 주세요.

【형식 요구사항】
- 슬라이드 수: 12~15장 (발표 7~10분 기준)
- 언어: 한국어
- 톤: 학술 발표 + 기술 시연, 과장 없이 명확하게
- 대상: 블록체인 기초는 아는 교수·동료 (스마트 컨트랙트, MetaMask 용어 사용 가능)
- 디자인: 전문적·깔끔, 다크/라이트 혼용 가능. 관제 화면은 다크, 직원 화면은 밝은 톤으로 구분하면 좋음
- 각 슬라이드에: 제목, 핵심 bullet 3~5개, 필요 시 다이어그램/표 설명 문구 포함
- 마지막 슬라이드: 시연 시나리오 + Q&A
- 다이어그램이 필요한 슬라이드는 mermaid 또는 ASCII로 구조를 제시해 주세요

【반드시 포함할 핵심 메시지】
1. "파일은 오프체인, 권한은 온체인" 하이브리드 설계
2. 보안 문서는 2-of-3 멀티시그, 일반 문서는 접근 기록만
3. 실제 동작하는 dApp 시연 (MetaMask + app.html)
4. 탈취 지갑 즉시 차단(revoke) 시나리오
```

---

## 1. 프로젝트 개요

**프로젝트명:** MultiSig-KMS (블록체인 기반 분산 키 관리 시스템)

**과목:** 가천대학교 블록체인 시스템 설계 및 실습

**한 줄 소개:**  
기업·차량 등의 **암호화된 기밀 데이터**에 대한 **복호화 권한**을 중앙 서버 단일 키가 아닌, **블록체인 2-of-3 멀티시그**로 통제하는 하이브리드 KMS 시스템.

**해결하려는 문제:**

- 기존 KMS: 마스터 키·권한 DB가 한곳에 몰려 **단일 실패 지점(SPoF)** 존재
- 내부자가 접근 로그를 DB에서 조작할 수 있음
- 지갑·계정 탈취 시 즉시 권한 회수가 어려움
- 모든 문서에 동일한 승인 절차를 적용하면 운영 비용·UX가 나쁨

**우리의 접근:**

- **데이터(암호화 파일)** → 기업 On-Premise 서버에만 보관 (체인·IPFS 미업로드)
- **권한(누가 복호화할 수 있는가)** → 스마트 컨트랙트 `KMS.sol`이 온체인에서 관리
- **일반 문서 vs 보안 문서**를 tier로 분리해 차등 통제

---

## 2. 시스템 아키텍처 (하이브리드 분리)

```text
┌─────────────────────┐         ┌──────────────────────┐
│  오프체인 (On-Prem)  │         │  온체인 (Arbitrum L2) │
│                     │         │                      │
│  plain/ 일반 문서    │         │  KMS.sol             │
│  encrypted/ 보안문서│◄─검증───│  · 화이트리스트       │
│  (AES-256-GCM)      │         │  · 2-of-3 멀티시그    │
│                     │         │  · revoke 킬스위치    │
│  offchain-kms 서버   │         │  · 불변 감사 이벤트   │
│  (Express, :4000)   │         │                      │
└─────────────────────┘         └──────────────────────┘
         ▲                                  ▲
         │                                  │
    직원 dApp (app.html)              MetaMask 지갑
```

**설계 원칙:** 블록체인은 파일과 마스터 키를 **절대 저장하지 않음**. `documentId`(bytes32)는 오프체인 자산을 가리키는 **해시 식별자**일 뿐.

---

## 3. 역할 구조

| 역할 | 온체인 표현 | 권한 | 시연 계정 (Hardhat) |
|------|-------------|------|---------------------|
| 슈퍼 관리자 | `DEFAULT_ADMIN_ROLE` | 화이트리스트 등록/회수 | Account #0 |
| 결재권자 ×3 | `APPROVER_ROLE` | `approveAccess` (2명 이상 시 확정) | Account #1, #2, #3 |
| 직원(요청자) | 화이트리스트 주소 | 문서 접근 요청 | Account #4 |

**dApp (`app.html`) 특징:** MetaMask 연결 시 주소만으로 **역할 자동 분기**

- Admin / Approver → **관제 모드** (다크 테마, 감사 로그·결재)
- 화이트리스트 직원 → **직원 모드** (밝은 테마, 문서 목록·열기)

---

## 4. 문서 tier별 플로우 (핵심 차별점)

### 일반 문서 (tier: normal)

예: `2024년 사내 공지`, `인사 규정 요약`

1. 직원이 문서 클릭
2. 온체인 `logDocumentAccess(documentId)` — **감사 기록만**, 결재 없음
3. 오프체인 KMS 서버가 tx receipt에서 `DocumentAccessLogged` 이벤트 검증
4. **즉시** plain 텍스트 반환·열람

### 보안 문서 (tier: secure)

예: `Encrypted_Log.dat#vehicle-001` (차량 텔레메트리 로그)

1. 직원이 문서 클릭 → `requestDocumentAccess(documentId)` → `requestId` 발급
2. 결재권자 3명 중 **2명**이 `approveAccess(requestId)` 서명
3. 2표 도달 시 `DocumentAccessed` 이벤트 emit (온체인 접근 확정)
4. 오프체인 KMS가 이벤트·`getRequest().executed` 재검증 후 AES 복호화 내용 반환
5. 승인 없이 API 호출 시 **403 Forbidden**

---

## 5. 스마트 컨트랙트 핵심 (`KMS.sol`)

| 함수 | 설명 |
|------|------|
| `grantPermission(address)` | 직원 화이트리스트 등록 (Admin) |
| `revokePermission(address)` | 긴급 권한 회수·킬스위치 (Admin) |
| `logDocumentAccess(bytes32)` | 일반 문서 접근 기록 (직원) |
| `requestDocumentAccess(bytes32)` | 보안 문서 접근 요청 (직원) |
| `approveAccess(uint256)` | 결재 1표 (Approver, 2표 시 자동 확정) |

**주요 감사 이벤트 (불변·append-only):**  
`PermissionGranted`, `PermissionRevoked`, `DocumentAccessLogged`, `AccessRequested`, `AccessApproved`, `DocumentAccessed`

**단위 테스트:** 24개 시나리오 통과 (`npm test`)

---

## 6. 오프체인 KMS 서버

- **기술:** Node.js + Express (port 4000)
- `GET /api/documents` — manifest 기반 문서 목록
- `POST /api/open` — `{ documentId, requester, txHash }` + 온체인 검증 후 내용 반환
- `verify.js` — receipt·이벤트·view 함수 재검증
- `decrypt.js` — 보안 문서 AES-256-GCM 복호화
- **스토리지:** `storage/plain/`, `storage/encrypted/`, `manifest.json`

---

## 7. 보안 시나리오

### 정상 흐름

Admin이 직원 등록 → 직원 요청 → Approver 2명 승인 → 복호화 허가 → 오프체인 복호화

### 비상 흐름 (지갑 탈취)

1. Admin이 `revokePermission(탈취 지갑)` 호출
2. 탈취 지갑의 이후 요청은 온체인 `NotWhitelisted` revert
3. 오프체인 API도 403 반환

### 위협 대응 매핑

| 위협 | 대응 |
|------|------|
| 중앙 DB 마스터 키 단일 탈취 | 2-of-3 분산 승인 |
| 비인가 지갑 | 화이트리스트 + revert |
| 탈취 지갑 | revoke 킬스위치 |
| 내부 로그 조작 | 온체인 이벤트 불변 기록 |

**한계 (솔직히 언급):** Admin 키 탈취, revoke 전 pending 요청 완료 가능, Sepolia 실배포는 확장 과제

---

## 8. 기술 스택

| 영역 | 기술 |
|------|------|
| 스마트 컨트랙트 | Solidity 0.8.20, OpenZeppelin AccessControl |
| 개발·테스트 | Hardhat 2.x, 24 unit tests |
| L2 (목표 네트워크) | Arbitrum (로컬 시연: Hardhat node, chainId 31337) |
| 오프체인 서버 | Node.js, Express, ethers.js |
| 프론트엔드 | Vanilla JS, MetaMask, app.html 단일 SPA |
| 암호화 | AES-256-GCM (오프체인) |

---

## 9. 라이브 시연 시나리오 (5분, 영상·발표용)

| 순서 | MetaMask 계정 | 동작 | 기대 결과 |
|------|---------------|------|-----------|
| 1 | #4 Requester | app.html 연결 | 직원 모드 자동 진입 |
| 2 | #4 | 일반 문서 열기 | tx 1건 + 즉시 내용 |
| 3 | #4 | 보안 문서 열기 | requestId + 대기 |
| 4 | #0 Admin | 관제 모드 연결 | DocumentAccessLogged 확인 |
| 5 | #1, #2 Approver | 결재 탭 approveAccess | DocumentAccessed |
| 6 | #4 | 보안 문서 재열기 | 복호화 내용 표시 |
| 7 | #0 | revoke #4 | 킬스위치 |
| 8 | #4 | 문서 열기 시도 | 권한 없음 / revert |

**시연 전 준비:**

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

**주의:** deploy 후 Admin이 #4에게 `grantPermission` 필요 (`deploy.js`가 마지막에 revoke까지 실행)

**시연 리셋:** `pkill -f "hardhat node"` 후 노드 재시작 → deploy → grant → 처음부터 촬영

---

## 10. 권장 슬라이드 구성 (12~15장)

| # | 슬라이드 제목 | 내용 |
|---|--------------|------|
| 1 | 표지 | 프로젝트명, 과목명, 발표자 |
| 2 | 배경 및 문제 정의 | SPoF, 로그 조작, 권한 회수 어려움 |
| 3 | 프로젝트 목표 | 하이브리드 KMS, 차등 접근 통제 |
| 4 | 전체 아키텍처 | 오프체인 데이터 + 온체인 권한 다이어그램 |
| 5 | 역할 구조 | Admin / Approver / 직원 + 2-of-3 |
| 6 | 일반 vs 보안 문서 | tier 분기 비교 표 |
| 7 | 보안 문서 시퀀스 | request → approve ×2 → decrypt |
| 8 | 스마트 컨트랙트 | KMS.sol API·이벤트 |
| 9 | 오프체인 KMS | 검증·복호화·API |
| 10 | dApp 시연 UI | app.html 역할 자동 분기 스크린샷 자리 |
| 11 | 감사 로그·보안 | 불변 이벤트, revoke 시나리오 |
| 12 | 시연 데모 | 5분 시나리오 표 |
| 13 | 한계 및 향후 | Sepolia 배포, cancelRequest, HSM 등 |
| 14 | Q&A | 질문 환영 |

---

## 11. 발표 시 강조할 한 문장 (슬라이드용)

- **"블록체인에 비밀 파일을 올리지 않고, '누가 열어도 되는지'만 온체인에 남깁니다."**
- **"보안 문서는 결재 2명, 일반 문서는 기록만 — 업무에 맞게 차등 통제합니다."**
- **"모든 권한 변경·접근·결재는 수정 불가능한 온체인 감사 로그로 남습니다."**

---

## 12. 시각 자료 제안 (AI에게 요청)

- 슬라이드 4: 하이브리드 아키텍처 블록 다이어그램
- 슬라이드 7: 보안 문서 시퀀스 다이어그램 (직원→체인→결재자→KMS서버)
- 슬라이드 6: 일반/보안 비교 2열 표
- 슬라이드 11: revoke 전후 비교 플로우
- 슬라이드 10: 직원 모드(밝음) vs 관제 모드(다크) 목업 2분할

---

## 13. 보안 문서 시퀀스 (mermaid 참고)

```mermaid
sequenceDiagram
    participant Admin as Super Admin
    participant User as Whitelisted User
    participant A1 as Approver 1
    participant A2 as Approver 2
    participant Chain as KMS.sol
    participant Off as On-Premise KMS

    Admin->>Chain: grantPermission(user)
    User->>Chain: requestDocumentAccess(documentId)
    Chain-->>Chain: emit AccessRequested
    A1->>Chain: approveAccess(requestId)
    A2->>Chain: approveAccess(requestId)
    Chain-->>Chain: emit DocumentAccessed
    Off->>Chain: verify DocumentAccessed
    Off->>Off: decrypt encrypted file
```

---

## 14. Hardhat 시연 계정 (고정값)

| 역할 | Account | 주소 |
|------|---------|------|
| Admin | #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Approver 1 | #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Approver 2 | #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| Approver 3 | #3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| Requester | #4 | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` |

MetaMask: Chain ID **31337**, RPC `http://127.0.0.1:8545`  
(Hardhat 기본 니모닉 사용 시 **어느 PC에서든 동일한 계정** 생성)

---

*마지막 갱신: 2026-06-12*
