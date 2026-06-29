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
| **SKP** | `gltf`(변환후) | 3D 솔리드 메시 오버레이 | **SketchUp SDK 변환기**(skp→glb, `tools/skp2gltf`) → glTF 업로드 | ✅ iter-3 로컬 변환 경로. 브라우저 파서는 없으나 SDK가 면 테셀→솔리드. 실파일(218·264MB) 검증. |
| **RVT** | — | — | — | ⏳ 후순위(IFC 경유 권장). |

## 한계 (정직)

- **대형 메시/CAD OOM**: 3dm 100MB+·dwg/dxf 50MB+ = 브라우저 WASM 힙 한계(탭 ~200-300MB, interop.md). 업로드 시 >50MB 경고 가드. 대형 = 커넥터/서브셋/glTF 경로.
- **.3dm = 와이어프레임(있는 그대로)**: rhino3dm은 브라우저서 Brep 면 테셀·렌더메시 캐시 미노출(실측) → **solid 면 불가**. 대신 Brep edge·Curve·Extrusion·블록을 edge로 추출해 모델을 그대로 표시(Rhino 와이어프레임 모드급). 채워진 면이 필요하면 glTF export 또는 `FigcadPushBreps` 커넥터. 측량/분산 좌표 모델은 원점서 멀어 fit이 넓게 잡힘(denseCenter 재중심은 후속).
- **PDF/이미지 = 래스터**: 참조용(벡터 선택 불가). 이미지 실척 없음 → 배치 수동.
- **래스터는 크기 무관 안전**: 디코드 시 다운스케일(PDF 긴 변 ~2000px) — 대형 PDF/이미지도 OK.

## SketchUp(.skp) — SDK 변환기 경로 (구현됨, `tools/skp2gltf`)

브라우저용 .skp WASM 파서는 없다(포맷 독점). 그러나 **공식 SketchUp C SDK**(`SketchUpAPI.dll`) +
CPython 바인딩(`sketchup.cpXXX.pyd`)이 .skp를 읽고 면을 **테셀레이션**한다(rhino3dm과 달리 솔리드 메시 산출).
→ `tools/skp2gltf/skp2glb.py`(Python 3.11/3.13)로 **skp→glb 변환** → Figcad "+연동 모델"에 glTF 업로드 →
솔리드 read-only 오버레이. 라이노 커넥터와 동일한 "외부툴→glTF→Figcad" 사상의 구체 구현.

- **검증**: 견본주택 입면 스터디 218MB(1.45M tri→49.8MB glb·16.7s)·264MB(1.69M tri→57.9MB glb) → Figcad import ready, 솔리드 렌더 확인.
- **로컬 변환 전용**: SDK가 Windows 네이티브 DLL → 브라우저/Railway(Linux) 직접 실행 불가. 사용자가 로컬서 변환 후 업로드.
- 한계: 머티리얼 미보존(단색 오버레이)·대형 max_tris 절단(기본 2M). 설정/사용법 = `tools/skp2gltf/README.md`.
- 후속: 머티리얼 보존 · 서버측 자동변환(SDK Linux) · 업로드 시 UI 변환 안내.

## 구현 위치 (iter-3 신규/변경)
- `packages/core/src/schema.ts` — FederationSourceSchema sourceType `image`/`pdf` + underlay `opacity`.
- `apps/web/src/ui/useNavigatorFederation.ts` — accept 확장·ext→sourceType·이미지 pre-decode·대형 가드·skp 안내.
- `apps/web/src/interop/pdfClient.ts` (신규) — pdf.js 1페이지 렌더.
- `apps/web/src/engine/ReferenceLayer.ts` — `addImageUnderlay`(텍스처 평면) + 텍스처 dispose.
- `apps/web/src/engine/FederationReconciler.ts` — RASTER_TYPES + `loadRaster`/`placeRaster`(캐시·재배치).
- `apps/server/src/handlers/federation.ts` — png/jpg/pdf content-type.
