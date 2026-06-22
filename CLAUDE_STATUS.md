# Claude Status

Claude owns this file.

## Current Task

**M15 — Cloudflare → Railway 이주 ✅ 배포완료·전부 검증.** 라이브 = **https://lfthfigcad-production.up.railway.app** (Railway 프로젝트 LFTH_Figcad, bluems99@gmail.com).

## Railway 배포 (2026-06-22) — 검증 전부 green
- **빌더 = Dockerfile**(node:22-slim + corepack pnpm@11.6.0). nixpacks 4연속 실패(nodejs_22 undefined·corepack not found·.NET 오판·pnpm↔Node ERR_VM_DYNAMIC_IMPORT) → Dockerfile로 결정적 빌드.
- 검증: 빌드 SUCCESS · root 200 · asset text/javascript · ?op=origin/fed-upload 라우트 · **WSS 실시간(syncStep1)** · **영속(origin이 redeploy 후 생존 = /data 볼륨+SIGTERM flush)** · numReplicas=1.
- 볼륨 `lfth_figcad-volume` @ `/data` + env `DATA_DIR=/data`.
- **남은 사용자 작업**: (1) **AI 키** — `railway variables --set ANTHROPIC_API_KEY=...`(시크릿, 내가 키 없음). (2) **리전 US 확인**(AI 지역차단 — 키 넣기 전 대시보드서 region=US 확인, 아니면 Anthropic 403). (3) 커넥터 BASE=이 URL. (4) CF 워커 롤백용 유지.

## M15 완료 (2026-06-22)
CF DO duration 무료한도 초과(지속 WS=룸 24h 과금) → Railway 정액 이주. **core/geometry/interop/UI 0변경**(전송+저장+배포만).
- **P1 BlobStore 추상화**: R2→`BlobStore` 인터페이스(R2BlobStore+DiskBlobStore), federation/version 파라미터화. 비-fork(CF 유지). 프리픽스 가드.
- **P2 Node 서버** `apps/server/src/node-server.ts`: dev-node WS 동기화(클라 provider 호환) + ?op=apply/pull/origin·fed·version·/api/agent 배선(순수 핸들러 재사용) + 룸 mutex + DiskBlobStore + esbuild self-contained 번들(`build:node`).
- **P3 클라 backend URL** `config/backend.ts`: 5곳 → backendOrigin 단일소스. 단일서비스 same-origin.
- **P4 로컬 검증**: 멀티플레이어(browser-e2e PASS)·Railway-mode 부팅(ui:4 connected)·origin·fed 왕복·version 커밋+log·AI 배선·영속(.bin+blob). **Windows 경로 버그 수정**(DIST 절대화).
- **P5 Railway 설정**: nixpacks.toml·railway.json·docs/RAILWAY_DEPLOY.md.

## 검증 게이트 (전부 green)
core 353·interop 41(+3)·server 13(+3)·tsc 0·web build·node 번들. 멀티플레이어/origin/fed/version/AI배선/영속 로컬 작동.

## 다음 (사용자)
- **Railway 배포**: `docs/RAILWAY_DEPLOY.md` 따라 — Root Dir=레포루트·볼륨 `/data`·env(DATA_DIR=/data·ANTHROPIC_API_KEY·ROOM_KEY)·**US 리전**. 실제 `railway up`=사용자 계정 CLI 인증.
- **오버레이 fix(M14.1)** 포함됨(web 코드) → Railway 빌드 시 적용. 이전 미배포분(M12/M13/M13.5/M13.6/M14.1) 전부 이 빌드에 포함.
- 배포 후: 커넥터 BASE=Railway URL. CF 워커는 검증 끝까지 살려둠(롤백).

## 운영
- 로컬 prod-mode(Railway 패리티): `web build` + `server build:node` + `DATA_DIR=apps/server/.data PORT=8787 node apps/server/node-dist/server.mjs` (8787 단일서비스).
- 데일리 dev = dev-node.mjs(8787 WS만) + vite(5173). node-server = 풀스택.
