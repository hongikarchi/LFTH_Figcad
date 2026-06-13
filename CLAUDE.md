# Figcad — 웹 기반 실시간 협업 건축 BIM 모델러

LFTH 내부 도구. iPad(Safari PWA) + 데스크톱이 같은 모델을 실시간 동시 편집.
스택: TypeScript strict + Vite + pnpm workspaces / Three.js(WebGL2) / React 19(패널만) + Zustand / Yjs + y-partyserver / Cloudflare Workers + Durable Objects.

## 불변 규칙 (위반 = 리뷰 반려)

1. **지오메트리는 문서에 저장·동기화하지 않는다.** 항상 파라미터(중심선·두께·높이…)에서 순수 함수로 파생 (`packages/core/src/geometry/`).
2. **모든 문서 변경은 DocStore ops를 경유한다.** 앱 코드에서 Y.Map 직접 쓰기 금지 — undo origin·zod 검증·연쇄 삭제가 전부 ops에 있다. yjs import는 core·collab 밖에서 금지.
3. **React/DOM은 렌더 루프에 절대 들어가지 않는다.** 커서·치수칩 등 HUD는 명령형 DOM(`hud/`), React는 UI 패널만. 캔버스는 render-on-demand rAF.
4. **펜 = 도구, 터치 = 카메라.** 펜 스트로크 중 신규 터치 무시(팜 리젝션). 입력 분기는 `input/InputManager.ts` 한 파일에 격리.

## 단위·좌표 관례

- 문서: **전부 mm 정수** (ops 경계에서 `quantize`). 평면 [x, y] — x 동쪽, y 북쪽.
- 렌더: 미터, Three Y-up. 변환은 렌더 경계에서만: `world = [x*0.001, elevation*0.001, y*0.001]`.
- 벽 끝점이 정확히(mm 단위 ==) 일치해야 마이터 조인 — 근사 일치는 조인 안 됨 (lint가 경고).

## 레이아웃

```
packages/core/   순수 TS (DOM/Three 의존 제로) — schema(zod)·store(Y.Doc 래퍼+ops)·geometry(파생)·snap·ai(에이전트 도구+applyOpLog)·lint
apps/web/        engine(Three)·input·tools(상태머신)·collab(YProvider+presence)·hud·ui(React)·state(zustand)
apps/server/     Cloudflare Worker — Doc DO(y-partyserver 룸), AgentRunner DO(AI, 미국 고정), 정적 에셋
```

## 명령

```bash
corepack pnpm -F @figcad/core test -- --run   # core 단위 테스트 (vitest)
corepack pnpm -r exec tsc --noEmit            # 전체 타입체크
corepack pnpm -F @figcad/web build            # 프로덕션 빌드 (server deploy 전 필수 — dist를 에셋으로 올림)
node apps/server/dev-node.mjs                 # 로컬 서버 8787 (일상용, Node)
node apps/server/dev.mjs                      # miniflare 서버 (프로덕션 패리티 — AI 라우트는 이 경로만)
corepack pnpm -F @figcad/web dev              # vite 5173 (__figcad 데브 훅 포함)
cd apps/server && corepack pnpm exec wrangler deploy   # 배포 → https://figcad.archivibe.workers.dev
node apps/web/scripts/browser-e2e.mjs         # 멀티플레이어 E2E (vite+서버 필요)
node apps/web/scripts/lint-panel-smoke.mjs [포트]
node apps/web/scripts/ai-panel-smoke.mjs [포트|URL]
```

## 함정 (반복 비용 큰 것만)

- **wrangler.jsonc compat 플래그 2개 필수**: `no_websocket_standard_binary_type` (없으면 partyserver WS 침묵 파손), `nodejs_compat` (@anthropic-ai/sdk).
- **AI 라우트는 AgentRunner DO(locationHint wnam) 경유 필수** — 워커 직접 fetch는 아시아에서 홍콩 egress → Anthropic 403 지역 차단.
- **Cloudflare secret 업로드는 bash로**: PowerShell 파이프는 값 끝에 `\r`을 붙인다. `printf '%s' "$(tr -d '\r\n' < 파일)" | wrangler secret put NAME`.
- Anthropic strict tool use 금지 (도구 16종 = grammar too large 400) — executeOp 런타임 검증으로 충분.
- 협업 의미론: 필드 단위 LWW, 삭제가 편집을 이김, undo는 자기 변경만(LOCAL_ORIGIN). 새 ops는 단일 `transact` = undo 1스텝.

## 진행 상황

플랜·로드맵: `C:\Users\user\.claude\plans\figma-lazy-milner.md` (M0~M5 완료, 다음 M6 git식 버전 관리).
