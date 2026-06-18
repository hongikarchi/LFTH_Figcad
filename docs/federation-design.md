# Federated 뷰어 설계 (F6) — publish-then-assemble

> 벤치마크 `hub-benchmark-review.md` §2 **F6**(confidence high, ⭐ "정체성 그 자체")의 설계 문서.
> Phase 0(읽기전용 레퍼런스 채널)은 **구현됨**(`apps/web/src/engine/ReferenceLayer.ts`, 개발 플래그 뒤). 전체 federation = **v1.5**.

## 1. 왜 (정체성)
Speckle federation 패턴 = 서로 다른 툴(Revit·Rhino·CAD)에서 저작된 모델을 **거대 파일 교환 없이** 한 3D 뷰어에 합침. 워크플로 = **publish-then-assemble**: 각 분야가 자기 네이티브 툴에서 프로젝트로 업로드 → 사이드바서 모델 추가 → "View All in 3D"로 함께 봄. 허브는 **재저작이 아니라 published 모델을 aggregate**.

LFTH 적용: 구조는 Rhino·설비는 Revit·의장은 Figcad에서 만든 걸 **Figcad 한 화면에 겹쳐** "여기 부딪힘" 조율. Figcad의 실시간 협업 + 양방향 커넥터 위에 얹는 자연스러운 정체성 핵심.

## 2. 불변 경계 (가장 중요 — 4대 규칙 정합)
외부 모델은 **읽기전용 레퍼런스 지오메트리**로 들어온다. Figcad **네이티브** 요소(파생)와는 **별도 카테고리**:

| | 네이티브 요소 | 외부 레퍼런스 |
|---|---|---|
| 표현 | 파라미터에서 **순수 파생**(불변①) | 외부 메시 그대로(읽기) |
| 저장 | Y.Doc(파라미터만, 지오 미저장) | **지오 미저장** — 클라가 소스서 페치 |
| 변경 | DocStore ops(불변②) | 편집 불가(읽기전용) |
| 렌더 | SceneManager.entries(derive) | **별도 채널**(ReferenceLayer, derive 우회) |
| 선택/픽 | pickable | 비픽(v0) / 정보표시만(v1.5) |

→ 불변① 무위반: 불변①은 *네이티브* 요소가 파생이어야 함을 말함. 외부 레퍼런스는 **명시적으로 다른 표현**(벤치마크 F6 가드: "외부 모델은 읽기 메시로만, 파생 아님 = 별도 표현"). 메시는 클라 로컬 뷰 상태(HUD·presence와 동급) — 문서가 아님.

## 3. Phase 0 — 읽기전용 레퍼런스 채널 (구현됨)
`apps/web/src/engine/ReferenceLayer.ts` — 격리된 자기 매니저:
- 독립 `THREE.Group`을 `engine.scene`에 추가. SceneManager **무수정**(렌더 2경로 한 매니저 혼입 회피).
- `add(name, ReferenceMesh[])` — 외부 메시(positions[+normals], 월드 미터)를 read-only 머티리얼(반투명, 구분색)로 담음. `userData.figcadReference=true`.
- `setVisible`/`setAllVisible`/`remove`/`clear`/`list` (지오/머티리얼 해제 = `clear`/`remove` 내부 `disposeGroup` 헬퍼; 공개 `dispose` 메서드 없음).
- **store·ops·Y.Doc 무관** → `store.listElements()`에 안 들어옴(스모크가 증명). render-on-demand(`engine.requestRender()`).
- **개발 플래그 뒤**(`import.meta.env.DEV` + `__figcad.referenceLayer`) — 기본 UI 밖, 미완이어도 배포앱 무영향.

v0는 채널의 **아키텍처 언블록**만 증명한다(외부 메시가 derive·store 밖에서 씬에 살 수 있음). 데이터 소스·UI·동기화는 v1.5.

## 4. v1.5 — 전체 federation

### 4a. Federated source 레지스트리 (동기화 채널)
협업 허브 = 모두가 **같은** federation을 봐야 함 → 비요소 Y.Map 채널 `federation`(코멘트·views와 동일 패턴, `ops-store.md`):
```
FederationSource { id, name, sourceType: '3dm'|'ifc'|'figcad-room'|'3dtiles', ref, visible, addedBy, ts }
```
- `ref` = URL(업로드 .3dm/.ifc) 또는 figcad room id(다른 Figcad 프로젝트) 또는 3D-Tiles tileset URL. **지오메트리 자체는 채널에 안 담음**(불변①) — 각 클라가 ref에서 페치해 ReferenceLayer에 로드.
- 채널 변경 = ops 경유(불변②). **snapshot 4경로 관통**(snapshot/snapshotOf/fromSnapshot/importSnapshot) + schemaVersion 증가 + migrate 빈맵(`ops-store.md` 교훈).
- LWW 엔트리별. 가시성 토글 = per-source(per-user 로컬 override는 별도 고려).

### 4b. 데이터 추출 (소스별)
- **.3dm**: rhino3dm로 raw 메시 추출. 명시적 Mesh 객체 = 직접. **Brep/Extrusion = tessellation 필요**(rhino3dm-wasm `Brep.GetMeshes`/render mesh — 비자명, 이게 v1.5 핵심 난이도). 436MB 실파일의 72% Brep(`VALIDATION_260416.md`)이 여기 걸림.
- **.ifc**: web-ifc 지오메트리 스트림(IfcGeometry → 메시). 이미 `ifcImport` WASM 로더 보유.
- **figcad-room**: 다른 Figcad 프로젝트 스냅샷 페치 → deriveCache로 메시 산출(네이티브 derive 재사용) → 레퍼런스로 (읽기).
- **3d-tiles**: 4c 참조.

### 4c. 대용량 = 3D-Tiles HLOD 스트리밍 (F9, 페어 작업)
436MB급 federated 모델은 통짜 로드 불가(wasm32 4GB 천장, `interop.md`). 답 = **3D Tiles HLOD**(OGC, glTF 타일):
- 계층 트리 + 타일별 geometric error → screen-space-error LOD 선택. **보이는 것만 필요 해상도로** 로드.
- geographic CRS 프레이밍은 **제외**(HLOD/SSE 메커니즘만). Speckle식 배칭(≤500k vtx/배치)으로 draw call 격감.
- ReferenceLayer가 타일 소비자: 카메라 이동 시 SSE로 타일 add/remove(여전히 derive·store 밖, render-on-demand 유지).

### 4d. 픽킹·UI
- v1.5: 레퍼런스 메시 픽 가능(읽기전용 — 소스명·레이어 정보 표시, 편집 불가). SelectTool pickables와 분리(별도 raycast 패스 또는 userData 가드).
- 사이드바(Navigator 확장): federation 소스 리스트 + per-source 가시성 토글 + "전체 3D 보기".
- publish-then-assemble 플로우: 분야별 publish(.3dm/.ifc 업로드 또는 Figcad fork) → 프로젝트 federation에 add → aggregate 뷰.

## 5. 단계 요약
| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 0 | 격리 읽기전용 레퍼런스 채널(ReferenceLayer, dev 플래그) | ✅ 구현 |
| v1.5-a | `federation` 동기화 채널(레지스트리, snapshot 4경로) | ⬜ |
| v1.5-b | 소스별 추출(.3dm Brep tessellation·.ifc·figcad-room) | ⬜ |
| v1.5-c | 3D-Tiles HLOD 스트리밍(F9 페어) | ⬜ |
| v1.5-d | 픽킹·사이드바 UI·publish-then-assemble 플로우 | ⬜ |

## 6. 결정 필요(v1.5 착수 전, 사용자)
- 가시성 토글 = 글로벌(동기화) vs per-user 로컬? (협업이라 글로벌 기본 + 로컬 override 검토)
- 첫 소스 타입 우선순위: figcad-room(가장 쉬움, derive 재사용) → .ifc → .3dm Brep(가장 어려움) → 3D-Tiles?
- 업로드 저장: R2(M6 blob 인프라 재사용) vs 외부 URL 참조만?
