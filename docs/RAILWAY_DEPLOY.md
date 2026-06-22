# Railway 배포 — Figcad Node 백엔드 (Cloudflare 대체)

> M15 이주. Node 서버(`apps/server/src/node-server.ts` → 번들 `node-dist/server.mjs`)가 WS 동기화 +
> HTTP 라우트(?op=apply/pull/origin·fed·version·/api/agent) + 정적 dist를 **1서비스**로 서빙.
> CF DO duration 과금 회피 = 정액 Hobby. core/geometry/interop/UI **무변경**(전송+저장만 이주).

## 1. Railway 서비스 설정 (대시보드)
- **New Project → Deploy from GitHub repo** (또는 `railway init` + `railway up` CLI).
- **Root Directory** = 레포 루트(기본). pnpm 워크스페이스 필요 → `apps/server` 아님.
- 빌더 = NIXPACKS(자동 — 루트 `nixpacks.toml`·`railway.json` 인식).
- **Region = US** (서부/동부 무관, **미국**이어야 Anthropic 지역차단 회피 — CF wnam DO 대체).

## 2. 영속 볼륨 (⚠️ 필수 — 없으면 재배포 시 데이터 소실)
- 서비스 → **Volumes → New Volume**, Mount path = **`/data`**.
- 룸 Y.Doc(`.bin`) + federation/version blob 전부 여기 저장. 미설정 = 매 배포·재시작 시 전 룸·커밋 소실.

## 3. 환경변수 (Variables)
| 변수 | 값 | 용도 |
|---|---|---|
| `DATA_DIR` | `/data` | 볼륨 경로 (룸 .bin + blob). **필수** |
| `ANTHROPIC_API_KEY` | (키) | AI 모드. 없으면 AI만 비활성(나머지 정상) |
| `ROOM_KEY` | (선택) | 설정 시 전 룸 `?key=` 게이트 |
| `PORT` | (Railway 자동주입) | 건드리지 말 것 |

- `VITE_BACKEND_URL` = **설정 안 함**(단일서비스 = same-origin, 클라가 `location.origin` 사용).
  web/API를 다른 호스트로 나눌 때만 빌드타임에 설정.

## 4. 빌드·기동 (자동 — nixpacks.toml)
```
install: corepack enable && corepack pnpm install --frozen-lockfile
build:   pnpm -F @figcad/web build  (dist)  +  pnpm -F @figcad/server build:node  (번들)
start:   node apps/server/node-dist/server.mjs
```
헬스체크 = `/`(index.html 200).

## 5. 배포 후 검증
- `https://<service>.up.railway.app/` 200 + 앱 부팅.
- 2탭 동시편집(멀티플레이어) · federation 업로드→오버레이 · AI(키 설정 시) · 버전 커밋.
- 재배포 후 룸/커밋 유지(볼륨 영속).
- **DO duration 이메일 0** (CF 과금 끝).

## 6. 클라 도메인 (커넥터·iPad)
- `figcad-push.cs` 등 커넥터 BASE = Railway URL로.
- 기존 CF 워커는 **검증 끝까지 살려둠**(롤백 가능). 컷오버 = 사용자 판단.

## 로컬에서 프로덕션 모드 테스트
```bash
corepack pnpm -F @figcad/web build
corepack pnpm -F @figcad/server build:node
DATA_DIR=apps/server/.data PORT=8787 node apps/server/node-dist/server.mjs
# → http://localhost:8787 (dist+WS+API 단일서비스, Railway와 동일 경로)
```
