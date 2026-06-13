---
paths:
  - "packages/core/**"
description: core 지오메트리 파생·단위·신규 Element kind 배선 체크리스트
---

# core 지오메트리·스키마 규칙

## 불변 (규칙 1)
지오메트리는 문서에 저장·동기화하지 않는다. 항상 파라미터(중심선·두께·높이·boundary…)에서 **순수 함수**로 파생 (`packages/core/src/geometry/`). 파생 결과(positions/normals/edges/anchors/labels)는 클라이언트 로컬 캐시 — Y.Doc에 절대 안 들어감.

## 단위·좌표
- 문서: 전부 **mm 정수** (ops 경계에서 `quantize`). 평면 [x,y] — x 동쪽, y 북쪽.
- 렌더: 미터, Three Y-up. 변환은 렌더 경계에서만: `world = [x*0.001, elevation*0.001, y*0.001]`.
- 벽 끝점은 mm 단위 `==` 정확 일치해야 마이터 조인 (근사 일치 = 조인 안 됨, lint 경고).
- 파생 결정론: 같은 파라미터 → 같은 메시. deriveKey가 모든 입력(바인딩 해석 좌표 포함)을 포괄해야 메모이즈·재파생 정확.

## 신규 Element kind 배선 체크리스트 (silent if-chain — 누락 = 조용한 버그)
새 kind 추가 시 **전부** 배선. tsc+단위만 통과시키지 말고 **실제로 move/copy/rotate/lint/export로 행사해 검증** (advisor 교훈 — D1a에서 .3dm/DXF 조용한 누락 사고).

1. `schema.ts` — Element union + (타입 있으면) ElemType/TypeKind + DeriveInput union.
2. `geometry/deriveX.ts` — `deriveX()` + `deriveKey` (바인딩 시 해석 좌표를 키에 폴드).
3. `geometry/index.ts` — DeriveCache 분기.
4. `store.ts` — create / update(quantize) / move / rotate / transformCopy / deleteElements 정책 / seed.
5. `select.ts` — `elementFootprint` (+ 바인딩 있으면 `resolveDimAnchor`류 공유 헬퍼).
6. `capabilities/catalog.ts` — capability 항목 (+ `aiExposed` 의도 명시).
7. `lint.ts` — dup 검사 + `KIND_LABEL` + typeId 가드 (+ 바인딩 고아 검사).
8. `diff.ts` — `KIND_LABEL`.
9. interop 3종 — `ifcExport.ts` / `rhino3dm.ts` / `dxf.ts` (export + 필요시 import). 누락 = 조용한 데이터 손실.
10. web — Tool · InfoBox(에디터+컨텍스트) · Navigator(KIND_ORDER+typeMeta+TypeEditor) · LintPanel anchorOf · SelectTool(드래그 정책) · Toolbox · main.ts 배선 · uiStore(ToolName/TypeKind) · context.ts.

`buildDeriveIndex`는 전방참조라 대개 불변.

## 공유 헬퍼 (재발명 금지)
- 원→N각형 단면: `Section`(rect/circle) → `extrudeProfile` 단일 경로 (기둥/보/계단/지붕/난간 공유 — 커튼월 멀리언도 재사용).
- 바인딩 추종: `resolveDimAnchor(store,bind,fallback)` (select.ts) — DeriveCache·transformCopy·footprint·InfoBox 공유. 치수·코멘트·(라벨) 전부 이거로.
- 라벨 채널: `DerivedGeometry.labels?:{text,pos,style}[]` — 그리드 버블·텍스트·치수·존/라벨 텍스트 전부 SceneManager `updateLabels` 한 경로.
