# Figcad

웹 기반 실시간 협업 건축 BIM 모델러. 정체성 3축 = **웹**(브라우저, 설치 없음) · **실시간**(여러 사람 + Rhino·CAD·Revit 모델·도면을 한 화면에서 동시에) · **AI**(손그림→모델). Figma처럼 브라우저에서 여러 사람이 같은 모델을 동시 편집하고, 여러 툴의 모델·도면을 실시간으로 모아 같이 보는 멀티툴 협업 허브.

핵심 워크플로우: iPad(Safari PWA + Apple Pencil)에서 3D 모델링 ↔ 데스크톱 브라우저에서 동시 편집, 실시간 양방향 반영.

## 구조

- `packages/core` — 문서 스키마, 편집 ops, 지오메트리 파생(순수 TS, vitest)
- `apps/web` — Vite + React + Three.js 클라이언트
- `apps/server` — Railway/Node 백엔드(정적 에셋 + Yjs WS 룸 + API). Cloudflare Worker 경로는 롤백용으로 유지

## 개발

```sh
corepack pnpm install
corepack pnpm dev        # Vite dev server (API/WS는 apps/server dev-node 8787)
corepack pnpm build      # web dist + Railway node-server bundle
corepack pnpm test       # core + server + interop
corepack pnpm deploy     # Railway 안내만 출력
corepack pnpm deploy:cf  # Cloudflare rollback 배포
```

## 설계 불변 규칙

1. 지오메트리는 문서에 저장·동기화하지 않는다 — 항상 파라미터에서 순수 함수로 파생.
2. 모든 문서 변경은 `core/ops`를 경유한다 — 앱 코드에서 Y.Map 직접 쓰기 금지.
3. React/DOM은 렌더 루프에 들어가지 않는다 — HUD는 명령형 DOM, 패널만 React.
4. 펜 = 도구, 터치 = 카메라.
