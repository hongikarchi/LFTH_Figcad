---
paths:
  - "apps/web/**"
description: 렌더루프·입력·도구 상태머신 규칙
---

# web (engine·input·tools·hud·ui) 규칙

## 불변 (규칙 3·4)
- **React/DOM은 렌더 루프 금지.** 커서·치수칩·라벨·핀 등 HUD = 명령형 DOM(`hud/`). React = UI 패널만. 캔버스 = render-on-demand rAF (제스처/트윈/원격변경 시만).
- **펜=도구, 터치=카메라.** 펜 스트로크 중 신규 터치 무시(팜 리젝션). 입력 분기 = `input/InputManager.ts` 한 파일 격리.

## 도구 (tools/)
- Tool 상태머신 = ToolController 디스패치. `activate?()` = 도구 진입 훅(카메라 정렬 등 — `enter()`는 RMB 확정이라 다름).
- 픽킹: 얇은 선(치수·그리드)·주석은 리본/쿼드 **픽 프록시** 메시. 프록시는 투명(opacity 낮게)+applyGhosting 제외 — 보이는 건 라벨/에지뿐.
- 박스 선택 = 스크린(px) 공간 판정(`worldToScreen`). 좌→우 window(완전포함), 우→좌 crossing(교차).
- 다중 선택 = `selection: Id[]` (length===1이 단일과 동일). SceneManager `selected: Set<Id>`.

## 캔버스 CSS (iPad)
`touch-action:none`, `gesturestart` preventDefault, `-webkit-touch-callout:none`, safe-area.

## 성능 예산
draw call ≤100, 힙 ≤150MB, Lambert 머티리얼(Phong은 iPad 3배), 프레임 루프 내 객체 할당 금지(Vector3 풀링), 적응 DPR.

## 텍스트 입력
캔버스 타이핑 불가 → 명령형 떠있는 DOM `<input>`(promptText 패턴): up에서 띄움(포커스강탈 회피), stopPropagation.

## SceneManager 갱신
- 변경당 O(n²) 전체스캔 금지 → DeriveIndex 증분.
- 비요소 채널(코멘트·라벨) 변경 = 빈-change 빠른경로(요소 재파생 스킵, 핀/라벨만).
- 라벨 = `updateLabels`(직렬화 키 diff로 텍스처 재생성만, 위치 매 갱신).
