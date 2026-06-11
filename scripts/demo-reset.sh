#!/usr/bin/env bash
# 시연/영상 촬영 전 환경 초기화 — 한 번에 실행
set -euo pipefail
cd "$(dirname "$0")/.."

CONTRACT_ADDR="0x5FbDB2315678afecb367f032d93F642f64180aa3"
REQUESTER="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
LOG_DIR="/tmp/kms-demo"
mkdir -p "$LOG_DIR"

echo "=============================================="
echo " MultiSig-KMS 시연 환경 리셋"
echo "=============================================="

echo ""
echo "[1/5] 기존 프로세스 종료..."
pkill -f "hardhat node" 2>/dev/null || true
pkill -f "offchain-kms/server.js" 2>/dev/null || true
pkill -f "serve frontend" 2>/dev/null || true
sleep 1

if ss -tlnp 2>/dev/null | grep -q ':8545 '; then
  echo "❌ 8545 포트가 아직 사용 중입니다. 수동으로 종료 후 다시 실행하세요."
  ss -tlnp | grep 8545
  exit 1
fi

echo ""
echo "[2/5] Hardhat node 시작..."
# npx는 첫 실행 시 30초 이상 걸릴 수 있어 hardhat 바이너리 직접 실행
./node_modules/.bin/hardhat node > accounts.txt 2>&1 &
NODE_PID=$!
echo "  PID: $NODE_PID (로그: accounts.txt)"

NODE_OK=0
for i in $(seq 1 60); do
  if ss -tlnp 2>/dev/null | grep -q ':8545 '; then
    if curl -sf -m 2 -X POST http://127.0.0.1:8545 \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
      | grep -q '"result"'; then
      NODE_OK=1
      echo "  ✅ RPC 준비됨 (${i}초)"
      break
    fi
  fi
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "❌ Hardhat node 프로세스가 종료되었습니다. accounts.txt 마지막 줄 확인:"
    tail -5 accounts.txt 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
if [ "$NODE_OK" -eq 0 ]; then
  echo "❌ Hardhat node가 60초 안에 응답하지 않습니다."
  echo "   accounts.txt 확인: tail -20 accounts.txt"
  tail -10 accounts.txt 2>/dev/null || true
  exit 1
fi

echo ""
echo "[3/5] KMS 컨트랙트 배포 (시연용 — revoke/테스트 tx 없음)..."
npx hardhat run scripts/demo-deploy.js --network localhost 2>&1 | tee "$LOG_DIR/deploy.log" | tail -6

echo ""
echo ""
echo "[4/5] 스토리지 시드 + KMS 서버 시작..."
npm run seed:storage
KMS_CONTRACT_ADDRESS="$CONTRACT_ADDR" node offchain-kms/server.js > "$LOG_DIR/kms-server.log" 2>&1 &
KMS_PID=$!

KMS_OK=0
for i in $(seq 1 15); do
  if curl -s http://127.0.0.1:4000/api/health | grep -q '"ok":true'; then
    KMS_OK=1
    break
  fi
  sleep 1
done
if [ "$KMS_OK" -eq 1 ]; then
  echo "  ✅ KMS 서버 :4000 (PID $KMS_PID)"
else
  echo "❌ KMS 서버 시작 실패 — $LOG_DIR/kms-server.log 확인"
  exit 1
fi

echo ""
echo ""
echo "[5/5] 프론트엔드 (이미 serve 중이면 생략 가능)..."
if ss -tlnp 2>/dev/null | grep -q ':3000 '; then
  echo "  ⚠️  :3000 이미 사용 중 — 기존 serve 유지"
else
  npx serve frontend -p 3000 > "$LOG_DIR/frontend.log" 2>&1 &
  FRONT_PID=$!
  sleep 1
  echo "  ✅ frontend :3000 (PID $FRONT_PID)"
fi

echo ""
echo "=============================================="
echo " ✅ 시연 환경 준비 완료"
echo "=============================================="
echo ""
echo "  브라우저:  http://localhost:3000/app.html"
echo "  컨트랙트:  $CONTRACT_ADDR"
echo "  KMS API:   http://localhost:4000/api/documents"
echo ""
echo "  MetaMask: Chain ID 31337, RPC http://127.0.0.1:8545"
echo "  ⚠️  demo:reset 후 문서 열기 실패 시:"
echo "      MetaMask → 설정 → Developer tools → 「Delete activity and nonce data」"
echo "  시연 순서:"
echo "    1) #0 Admin  — 감사 로그·접근 제어 (grant는 배포 시 완료)"
echo "    2) #4 직원   — 일반/보안 문서"
echo "    3) #1,#2     — 결재"
echo ""
echo "  계정 전환: 앱에서 [연결 해제] → MetaMask 계정 변경 → [연결]"
echo ""
echo "  종료: pkill -f 'hardhat node'; pkill -f offchain-kms/server"
echo "=============================================="
