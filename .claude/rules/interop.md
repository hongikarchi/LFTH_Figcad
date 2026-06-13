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
- 대형 .3dm(수백 MB)은 브라우저 WASM 메모리 캡(탭 ~200-300MB) 초과 → 통짜 import 불가. subset 또는 connector 경로.

## 배제 확정
DWG(ODA 유료)·.skp(WASM 불가+경쟁조항)·.rvt 네이티브 쓰기 불가 → IFC 경유.
