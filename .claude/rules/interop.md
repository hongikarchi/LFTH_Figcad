---
paths:
  - "packages/interop/**"
description: interop WASM 로딩·포맷별 손실·import 한계
---

# interop 규칙

## WASM 로딩
- web-ifc / rhino3dm = vite `?url` import + `locateFile`로 WASM 경로 주입.
- 포맷별 서브엔트리 코드스플릿 (`./ifc` `./rhino` `./dxf`) — iPad 핫패스에서 미로드.
- dxf-parser = CJS default import.
- 브라우저 page.evaluate에서 bare import 불가 (?url 경유).

## 포맷별 보존 (정직하게 문서화)
| 포맷 | 파라메트릭 보존 | 비고 |
|---|---|---|
| IFC (web-ifc) | ✅ 유일 — IfcWallStandardCase Axis+MaterialLayerSetUsage 1:1 | Revit import 기본 DirectShape 고지. ArchiCAD 인증 import 우수 |
| .3dm (rhino3dm) | ❌ 지오레벨 (중심선+footprint, 두께/높이/슬로프 손실) | MIT |
| DXF | ❌ 2D 지오메트리만 | 평면 라인워크·HATCH |

## import 한계 (Phase 5 검증 항목)
- 현 .3dm import = **wall/slab/grid만 매핑**, column/beam/stair/railing/roof는 스킵+count.
- 외부 임의 파일 = best-effort (open curve→wall, closed→slab).
- 실파일은 **부분 import** = 인터롭 갭. 신규 kind 추가 시 export는 반드시(체크리스트 9), import는 점진.
- **곡선(arc) 벽 export = C5에서 닫음 ✅:** `wall.sagitta`(곡선 중심선)를 IFC/.3dm/DXF가 **호 테셀 dense 폴리라인**(`arcPolyline`+`curvedWallFootprint`)으로 내보냄 — 직선 현 손실 없음, 곡률 보존. (IFC=로컬좌표 IfcPolyline axis + IfcArbitraryClosedProfileDef body, .3dm=PolylineCurve, DXF=다정점 LWPOLYLINE.) 잔여(후속): 진짜 파라메트릭 arc 엔티티(IfcArcIndex/ArcCurve/bulge) + re-import 시 sagitta 복원(현재 재import는 폴리라인→직선 벽 = import 일반 한계).
- 대형 .3dm(수백 MB)은 브라우저 WASM 메모리 캡(탭 ~200-300MB) 초과 → 통짜 import 불가. subset 또는 connector 경로.

## 배제 / 채택 (M16 갱신)
- **DWG/DXF = 채택**(이전 "ODA 유료 배제" 뒤집힘): `@mlightcad/libredwg-web` 클라 WASM로 **read-only 2D 언더레이**(빽도면) 파싱 — ODA 불필요, 무료, 실파일 검증. 메시 아닌 라인워크(`fetchDwgUnderlay`→`ReferenceLayer.addUnderlay`). 네이티브 쓰기(편집가능 요소화)는 여전히 IFC/커넥터 경유.
- **여전히 배제**: .skp(WASM 파서 없음+경쟁조항 → 플러그인 glTF export 경로)·.rvt 네이티브 쓰기 → IFC 경유.
