# Figcad

웹 기반 실시간 협업 건축 BIM 모델러. Figma처럼 브라우저에서 여러 사람이 같은 건물 모델을 동시에 편집한다.

핵심 워크플로우: iPad(Safari PWA + Apple Pencil)에서 3D 모델링 ↔ 데스크톱 브라우저에서 동시 편집, 실시간 양방향 반영.

## 구조

- `packages/core` — 문서 스키마, 편집 ops, 지오메트리 파생(순수 TS, vitest)
- `apps/web` — Vite + React + Three.js 클라이언트
- `apps/server` — Cloudflare Worker (정적 에셋 + y-partyserver Durable Object 동기화 룸)

## 개발

```sh
corepack pnpm install
corepack pnpm dev        # vite dev server
corepack pnpm deploy     # wrangler deploy
```

## 설계 불변 규칙

1. 지오메트리는 문서에 저장·동기화하지 않는다 — 항상 파라미터에서 순수 함수로 파생.
2. 모든 문서 변경은 `core/ops`를 경유한다 — 앱 코드에서 Y.Map 직접 쓰기 금지.
3. React/DOM은 렌더 루프에 들어가지 않는다 — HUD는 명령형 DOM, 패널만 React.
4. 펜 = 도구, 터치 = 카메라.
