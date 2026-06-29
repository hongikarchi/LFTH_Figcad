# 파일 임포트 — 멀티포맷 ingest (iter-3)

> "+연동 모델" 업로드는 외부 파일을 **read-only 오버레이/언더레이**(비파괴 = 포지셔닝의 PR-primitive)로 착지시킨다.
> 파괴적 native import(3dm/dxf→wall/slab)는 별경로(부분지원). 여기 = federation 오버레이 ingest.

## 지원 매트릭스

| 포맷 | sourceType | 렌더 | 경로 | 상태 |
|---|---|---|---|---|
| **PNG/JPG** | `image` | 텍스처 평면(레벨 바닥) | `createImageBitmap`→`ReferenceLayer.addImageUnderlay` | ✅ iter-3 신규. 실척 없음 → 기본 긴 변 ~10m(배치로 조정). opacity 0.85. |
| **PDF** | `pdf` | 1페이지 래스터 텍스처 평면 | `pdf.js`(코드스플릿) 1페이지 렌더→텍스처 평면. pt→mm 실척. | ✅ iter-3 신규. 다중페이지·벡터추출=후속. |
| **DWG** | `dwg` | 2D 라인워크 언더레이 | `libredwg-web` WASM→`addUnderlay` | ✅ 기존(iter 직전). 레이어/bulge/블록/XCLIP. |
| **DXF** | `dxf` | 2D 라인워크 언더레이 | `libredwg-web`(dwg와 동일) | ✅ 기존. |
| **.3dm** | `3dm` | 3D **와이어프레임** + 메시 오버레이 | `rhino3dm` WASM — Mesh=삼각망, Brep/Curve/Extrusion/블록=**edge 와이어프레임** | ✅ iter-3 "있는 그대로". rhino3dm는 Brep 면 테셀(커널)·렌더메시 캐시 미노출(실측) → edge로 모델 그대로 표시(Rhino 와이어프레임 모드급). solid 채움은 불가 → 필요시 glTF export. |
| **glTF/GLB** | `gltf` | 3D 메시 오버레이 | GLTFLoader | ✅ 기존. |
| **IFC** | `ifc` | 3D 메시 오버레이 | `web-ifc` WASM | ✅ 기존(후순위). |
| **SKP** | — | — | **브라우저 파서 없음** | ❌ → 플러그인 경로(아래). |
| **RVT** | — | — | — | ⏳ 후순위(IFC 경유 권장). |

## 한계 (정직)

- **대형 메시/CAD OOM**: 3dm 100MB+·dwg/dxf 50MB+ = 브라우저 WASM 힙 한계(탭 ~200-300MB, interop.md). 업로드 시 >50MB 경고 가드. 대형 = 커넥터/서브셋/glTF 경로.
- **.3dm = 와이어프레임(있는 그대로)**: rhino3dm은 브라우저서 Brep 면 테셀·렌더메시 캐시 미노출(실측) → **solid 면 불가**. 대신 Brep edge·Curve·Extrusion·블록을 edge로 추출해 모델을 그대로 표시(Rhino 와이어프레임 모드급). 채워진 면이 필요하면 glTF export 또는 `FigcadPushBreps` 커넥터. 측량/분산 좌표 모델은 원점서 멀어 fit이 넓게 잡힘(denseCenter 재중심은 후속).
- **PDF/이미지 = 래스터**: 참조용(벡터 선택 불가). 이미지 실척 없음 → 배치 수동.
- **래스터는 크기 무관 안전**: 디코드 시 다운스케일(PDF 긴 변 ~2000px) — 대형 PDF/이미지도 OK.

## SketchUp(.skp) — 플러그인 export 경로 (Rhino 커넥터 패턴)

브라우저용 .skp WASM 파서가 없고(포맷 독점, SDK=C++) 실파일은 수백 MB라 in-browser 불가. **외부 export → fed-upload**가 정답(라이노 `FigcadPushBreps`와 동일 사상).

**설계 (후속 구현):**
1. SketchUp Ruby 플러그인(`.rbz`) — `Sketchup.active_model` → glTF/OBJ export.
   - SketchUp Ruby API에 native glTF export 없음 → (a) OBJ exporter(내장) + 클라 OBJLoader, 또는 (b) 메시 순회(`entities.grep(Sketchup::Face)`)→정점/면 추출→glTF 직접 작성(작은 헬퍼), 또는 (c) 무료 glTF exporter 플러그인 의존.
2. export 파일을 Figcad `?op=fed-upload`로 POST(룸 id + key) → `sourceType:'gltf'` federation source 추가. = 라이노 커넥터의 HTTP 패턴 재사용.
3. 또는 단순히: 사용자가 SketchUp서 glTF/OBJ로 export → Figcad "+연동 모델"로 드래그(수동, 지금도 glTF 됨).

즉 **지금도 SketchUp→glTF export→업로드는 동작**(수동). 플러그인 = 그 왕복 자동화(후속, 커넥터 우선순위에 편입).

## 구현 위치 (iter-3 신규/변경)
- `packages/core/src/schema.ts` — FederationSourceSchema sourceType `image`/`pdf` + underlay `opacity`.
- `apps/web/src/ui/useNavigatorFederation.ts` — accept 확장·ext→sourceType·이미지 pre-decode·대형 가드·skp 안내.
- `apps/web/src/interop/pdfClient.ts` (신규) — pdf.js 1페이지 렌더.
- `apps/web/src/engine/ReferenceLayer.ts` — `addImageUnderlay`(텍스처 평면) + 텍스처 dispose.
- `apps/web/src/engine/FederationReconciler.ts` — RASTER_TYPES + `loadRaster`/`placeRaster`(캐시·재배치).
- `apps/server/src/handlers/federation.ts` — png/jpg/pdf content-type.
