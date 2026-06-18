# Figcad 허브 역량 벤치마크 — 협업·인터롭 플랫폼 조사

> **정체성 기준 재조사.** Figcad = 웹·실시간·AI 3축의 "멀티툴 실시간 협업·인터롭 허브". 단독 저작툴 아님 — 정밀 모델링·납품도면 제작은 Rhino/Revit/CAD/ArchiCAD가 하고, Figcad는 그 모델·도면을 실시간으로 모아 같이 보고·조율. **핵심 = 실시간 공유, 나머지(대조·sketch·QA)는 파생.**
> 조사일: 2026-06. 딥 리서치 하니스 **2패스**, 3-vote 적대적 검증. **1차**(§2~7, dim 1·2·3): 109 에이전트 / 26 소스 / 24 confirm → 9 finding(F1~F9). **2차**(§8, dim 4·5·6 타깃): 104 에이전트 / 22 소스 / 22 confirm → 5 finding(G1~G5). 잔존 미답 = §6.
>
> **이 문서가 교체한 것**(둘 다 삭제됨, 쓸 부분 이관): 구 `modeling-tools-review.md`는 *틀린 질문*("데스크톱 저작툴에서 어떤 기능 베낄까")으로 저작기능 쇼핑리스트를 냈고 = Figcad를 더 무거운 단독 모델러로 미는 off-identity 방향. 이 문서는 *올바른 질문*("웹/실시간/AI 인터롭 허브를 best-in-class로")으로 **협업·인터롭 플랫폼**(Speckle·Onshape·Figma·Omniverse·3D Tiles)과 벤치마크. 구 doc의 인터롭 항목(IFC Pset/Translator)은 §8 G5로, 구 `pascal-editor-review.md`의 유일한 쓸모(per-kind 레지스트리)는 §5 내부 리팩터 트랙으로 이관.
>
> **⚙️ 실행 상태(2026-06, 이 보고서 이후):** ADOPT 판정 중 일부 착수됨 — A(doc→ROADMAP SoT)=`2514766` · **B = lint-in-loop critic(H3/H4) 실행 완료** `f5112dc`(`critiqueOpLog`가 `apps/server/src/agent.ts` + core `packages/core/src/ai.ts`에 배선, MAX_CRITIC_ROUNDS=2 — §9의 "`agent.ts`가 lint 미호출"은 *조사 시점* 기준이고 이후 닫힘) · **C = F6 레퍼런스 채널 스파이크** `120b9cf`(`apps/web/src/engine/ReferenceLayer.ts` + `docs/federation-design.md`; 전체 federation은 v1.5). **BCF(G4)는 ROADMAP에서 ADOPT→v1.5 재평가**(LFTH 전원 Figcad 내 조율, 크로스툴 이슈교환 실수요 약함). **F5 역-import는 기둥+보까지 확장** `f13b771`. 이하 본문은 조사 시점 프레이밍 유지.

---

## 0. TL;DR — 판정

1. **실시간 코어는 이미 동급-또는-우위.** Figcad의 Yjs true-CRDT + 필드단위 LWW + per-user undo + offline은 Figma(중앙집중 LWW, CRDT 아님)·Speckle·Onshape와 비교해 **갭 없음, offline/탈중앙에선 앞섬**. → **신규 빌드 없음** (F1).
2. **인터롭 비대칭(넓은 Pull / 좁은 Push, 손실 왕복)은 결함이 아니라 업계 표준.** Speckle Rhino 커넥터도, NVIDIA Omniverse Rhino live-sync도 동일한 단방향/정규화 동작. → **유지·정제, "고칠 버그"로 취급 금지** (F5·F7).
3. **진짜 채택거리 3개** — 전부 인터롭/허브/스트리밍 역량이지 저작 깊이 아님 → 채택 게이트 통과, 4대 불변 위반 0:
   - **ADOPT** federated 뷰어(publish-then-assemble) — *정체성 그 자체* (F6).
   - **ADOPT(레퍼런스)** Speckle 컨버터 패턴 — 우리 커넥터 설계 검증·정렬 (F4).
   - **검증됨** 오브젝트 단위 버전 diff — M11.5 색상 diff 방향이 옳음을 입증, **완성하라** (F3).
4. **CONSIDER (v1.5)**: Onshape식 branch/merge(F2) · 3D-Tiles HLOD 스트리밍(436MB의 유일한 검증된 답, F9) · USD 4번째 레인(F7) · 파라메트릭 역-import(pascal #2, F5로 재정의).
5. **스코프 — 3패스로 나눠 답함**:
   - **1차(§2~4·7)** = dim 1(실시간)·2(인터롭/federation)·3(웹 대용량). 완료.
   - **2차(§8)** = dim 5(크로스툴 QA/clash) ✅ · 인터롭 재평가(IFC Pset/Translator) ✅ · dim 4 시맨틱 리프팅(역방향) ✅. → **BCF**(ROADMAP서 v1.5로 재평가) · CONSIDER Speckle Automate식 룰QA · brep→파라 리프팅 **v1.5 연기 정당**.
   - **3차 Part A(§9)** = dim 4 순방향 NL→ops AI ✅. → **ADOPT lint-in-loop critic**(나머지 NL→ops 스택은 이미 보유 — capability registry·dryrun·ReAct 루프). REJECT free-form 코드 레이어.
   - **⚠️ 아직도 펑크(§6)**: dim 4의 **생성/개념설계 AI**(약한 절반, 원칙만 잡힘) + dim 6 **경쟁지형(Arcol/Motif/Qonic/Forma)** = 3패스 다 생존 claim 0/medium. "커버됐다"고 읽지 말 것 — 3차 Part B(다른 렌즈) 필요.

---

## 1. 방법 / 신뢰도

- **6개 각도 fan-out**: 실시간 멀티플레이어 / Speckle 1차 그라운딩 / 포맷전략(USD·IFC·glTF) / 웹 3D 대용량 / AI 축 / 경쟁지형.
- **검증**: claim당 3-vote 적대적(2/3 refute = kill). 25 검증 → 24 confirm, 1 kill. synthesizer는 split-vote(2-1) → confidence=medium 캡 적용.
- **1차 코드 그라운딩**: Speckle 오픈소스(speckle-sharp 소스·docs) + Figcad 자체 코드(`store.ts`·`FigcadConnector.cs`·`rhino3dm.ts`)를 직접 대조 → 이미 있는 걸 갭으로 오인 방지.
- **채택 게이트**: (a) 웹/실시간/AI/인터롭 허브 강화 vs (b) 더 무거운 단독 모델러化. (b) 또는 4대 불변 위반 = reject.

**⚠️ 시간민감 caveat (보고서 수명에 영향):**
- **speckle-sharp는 2026-05-12 아카이브** → V3(`speckle-sharp-sdk` + `speckle-sharp-connectors`)로 승계. **아키텍처(Base 객체·컨버터·SDK+스키마+커넥터 번들)는 유지**되나 용어 드리프트(Kit→obsolete, 컨버터가 `IRootToSpeckleConverter`/`IRootToHostConverter`로 분리), V3가 Dynamo/Bentley를 legacy로 강등. 인용한 `objects.html`은 'Legacy' 표시이나 현 main 브랜치 소스로 재확인됨.
- **NVIDIA Omniverse Launcher + Rhino 6-7 커넥터는 2025-10-01 deprecated** (Rhino 8은 NGC로 지속). 단방향 진술은 `/latest/`에 여전.
- **F8이 가장 시간민감**: Memory64/wasm64가 **shipped**(Chrome 133 / Firefox 134, 2025-01; WebAssembly 3.0 2025-09) → opt-in 64-bit 빌드는 4GB 천장 해제. **그러나 stock rhino3dm는 여전히 wasm32** → Figcad 실제 의존성엔 4GB 벽 유효. rhino3dm이 Memory64 빌드 내면 바뀔 수 있음.

---

## 2. ADOPT

### F6 — Federated 뷰어 (publish-then-assemble) = 허브 코어 패턴 ⭐ (스파이크 ✅ M12-C `120b9cf`, 전체=v1.5)
**confidence: high** · `docs.speckle.systems/3d-viewer/federation`
- Speckle은 서로 다른 툴(Revit·Rhino·AutoCAD…)에서 저작된 모델을 **거대 파일 교환 없이** 한 3D 뷰어 씬에 합침. 워크플로우 = **publish-then-assemble**: 각 분야가 자기 네이티브 툴에서 프로젝트로 업로드 → 사이드바에서 모델 추가 → "View All in 3D"로 함께 봄. 허브는 **재저작이 아니라 툴별 published 모델을 aggregate**.
- **이게 Figcad 정체성 그 자체.** 순수 집계·뷰잉 = 단독 저작의 정반대 → 게이트 명백 통과.
- **닿는 파일**: 새 비요소 채널(federated source registry: 외부 툴 published 모델 참조 + 가시성 토글) + 뷰어 레이어. **불변 가드**: aggregate된 외부 모델은 *읽기 메시*로만 들어오고(파생 아님 = 별도 표현), Figcad 네이티브 요소는 여전히 pure-derive(inv 1). 채널은 ops 경유(inv 2).
- **메커니즘 기반**: 오브젝트 분해 전송(monolithic 파일 아님, F3·F9와 연결).

### F4 — Speckle 컨버터 패턴 = 우리 커넥터의 레퍼런스(검증·정렬)
**confidence: high** · `speckle.guide/dev/objects.html` · `github.com/specklesystems/speckle-sharp` · 대조: `connectors/rhino/FigcadConnector.cs`
- Speckle = 동적 `Base` 객체 + 커넥터별 컨버터, 정확히 양방향 2메서드: `ConvertToNative`(Speckle→네이티브) / `ConvertToSpeckle`(네이티브→Speckle). 객체모델은 **Geometry 프리미티브 vs 상위 BuiltElements**로 분리(전부 Base 파생). 호스트 충실도는 **호스트별 서브클래스**(`RevitWall : Wall : Base`)로 보존 — 단일 범용 스키마가 아님. SDK+스키마+커넥터를 한 repo에 번들.
- **Figcad는 이미 같은 패턴**: `FigcadConnector.cs`의 Pull(Figcad→Rhino, ToNative, L57-154) / Push(Rhino→Figcad via `?op=apply`, ToSpeckle, L157-232)이 컨버터 양쪽 절반, 단일 소스 매핑 `packages/interop/src/rhino3dm.ts` 공유.
- **판정**: 신규 빌드 아님 — **설계가 옳음을 1차 소스로 검증**. 차이는 충실도-보존 전략: Speckle은 지오메트리 직렬화, Figcad는 pure-derive(inv 1) — 레이어 분리는 동형, 영속만 반대, 둘 다 깨끗. 향후 호스트별 충실도 보존이 필요하면 `RevitWall : Wall` 식 서브타입 힌트를 매핑에 추가 검토.

### F3 — 오브젝트 단위 버전 diff (M11.5 방향 검증 → 완성하라)
**confidence: high** · `docs.speckle.systems/3d-viewer/compare-versions` · `speckle.guide/dev/base` · 대조: ROADMAP M11.5 item 4 (commit `9a6e655`)
- Speckle 버전관리는 **오브젝트 기반** — 모델을 개별 객체(벽/바닥/메시/파라미터셋)로 분해, 각 객체에 content-hash id, **불변**(속성 바꾸면 새 정체성). 1급 diffing 기능이 버전 간 지오메트리·파라미터·구조 차이를 비교.
- **Figcad의 색상 구조화 버전 diff**(초록=추가/빨강=삭제/호박=변경, M11.5 item 4)가 **정확히 같은 역량**. Figcad의 요소단위 Y.Map 모델은 이미 오브젝트-granular → 신규 아키텍처 불필요, **in-flight 기능을 검증·완성**하는 일.
- **불변 가드**: diff = 파생 비교(저장 안 함), deriveDrawing와 동형. ops로 만든 버전 blob(M6 git식) 위에서 계산.

---

## 3. CONSIDER (v1.5) — 무거운 베팅

### F2 — branch/merge (Onshape graph-pointer + feature-level 충돌 검출) — dim 1의 진짜 갭
**confidence: high** · `onshape.com/en/features/branch-merge-cad` · `cad.onshape.com/help/.../branching.htm`
- Onshape 브랜치 = 파일 복사가 아니라 **원본 버전을 가리키는 그래프 포인터**. 머지는 결정적 — 머지 전 **feature 수준에서 모든 지오메트리 충돌을 검출**, 충돌 feature는 적용 거부하고 빨강 하이라이트해 수동 해결.
- **Figcad는 fork(1회 스냅샷→새 룸, Phase 3 완료)만 있고 branch/merge·크로스버전 충돌검출 없음** = 클라우드 CAD 대비 구체적 dim-1 갭.
- **왜 CONSIDER(채택 아님)**: 그래프-포인터 브랜치는 Figcad M6 버전-blob/hash 모델에 매핑되고 ops/메타데이터라 불변 깨끗. **그러나** Figcad의 **CRDT LWW가 라이브 편집은 이미 자동 해결** → 결정적 feature-merge UX는 *offline-divergent 버전* 케이스에만 필요. 비용 대비 가치는 디자인 스파이크 필요(§6).

### F9 — 3D-Tiles HLOD 스트리밍 + Speckle식 배칭 = 436MB의 유일한 검증된 답
**confidence: high** · OGC `22-025r4` · `docs.speckle.systems/developers/viewer/viewer-rendering`
- **3D Tiles** = 대용량 3D(BIM/CAD 포함) 스트리밍용 OGC 오픈 표준(v1.1). 계층 트리(HLOD), 타일별 geometric error(미터)가 screen-space-error LOD 선택 구동 → 436MB 통짜 대신 **보이는 것만 필요 해상도로 로드**.
- Speckle 뷰어는 renderable 자동 배칭(최대 500k vertex/배치)으로 draw call 격감 — 객체 수만 개 AEC 씬용.
- **함께 = Figcad에 없는 대용량 웹3D 정석 기법.** 순수 뷰어/스트리밍(웹3D 축) — 저작 추가 없음. **CONSIDER**: 상당한 신규 뷰어 서브시스템이지만, 436MB급 federated 모델을 브라우저서 보게 하는 유일한 검증된 경로 → 웹+허브 축 직결.
- **주의**: 3D Tiles는 지리공간 지향(geographic CRS). BIM/CAD는 glTF 기반 타일로 탐. **HLOD/SSE 메커니즘만 채택**, 지리공간 프레이밍은 불필요.
- **불변 가드**: 타일/LOD = 파생 표현(저장 안 함). render-on-demand 유지(inv 3).

### F7 — USD를 4번째 인터롭 레인으로? (열린 판단)
**confidence: medium** · `docs.omniverse.nvidia.com/connect/.../live.html`
- Omniverse는 live-sync에 **USD(.usd)** 사용(IFC·glTF 아님). 단 Rhino 엔드포인트는 **단방향**(Rhino→Kit, 역방향 없음) → 진짜 양방향 왕복은 레퍼런스 플랫폼도 어려움(F5 강화). Figcad의 `?op=apply` 라이브쓰기는 Pull/Push 양방향이라 이 점선 Omniverse Rhino 엔드포인트보다 앞섬.
- Figcad는 현재 IFC/DXF/.3dm(핸드오프용) export. **USD 레인이 허브 가치 있나, 아니면 LFTH의 Rhino/Revit 엔드포인트엔 .3dm/IFC로 충분한가**는 미해결(§6).

### (pascal #2 재정의) 파라메트릭 역-import — F5로 스코프 축소
- 이전 pascal 리뷰는 "import 비대칭을 먼저 닫아라"(column/beam/stair/railing/roof/curtainwall/zone은 파라미터에서 export되니 역importer는 기계적)고 권고. `ifcImport.ts`·`rhino3dm.ts`가 현재 wall/slab/grid + **기둥·보**(`f13b771`) 복원. 남은 kind = 기하 베이크 case라 skip.
- **F5로 재정의**: 비대칭 자체는 업계 표준이니 *완전 무손실 왕복을 쫓지 말 것*. **깨끗한 파라메트릭 역이 있는 kind만** 역importer 추가(파라미터 재구성→`store.create*`, 지오메트리 주입 금지 — inv 1). **brep→파라메트릭(진짜 손실 케이스)은 v1.5 AI 시맨틱 리프팅**, skip-and-count 유지가 맞음. 이 작업은 결국 per-kind 레지스트리(§5)의 `def.ifc`/`def.rhino`가 소유 → import-first로 짓고 나중에 레지스트리로 접음.

---

## 4. KEEP / 이미 우위 — 빌드 안 함

### F1 — 실시간 코어: 동급-또는-우위 (재확인, 신규 0)
**confidence: medium**(Figma측 단일 1차 소스=2019 엔지니어링 블로그) · `figma.com/blog/how-figmas-multiplayer-technology-works` · 대조: `store.ts`·`ops-store.md`
- Figma는 OT도 true-CRDT도 의도적으로 안 씀 — 중앙집중 서버권위 LWW, 충돌해결은 property/object 단위 last-writer-wins = **Figcad가 이미 구현한 필드단위 LWW와 동일 granularity**. Figcad는 추가로 **true CRDT(Yjs: offline-first, 서버 비종속)** 보유 = Figma에 없는 것.
- **판정**: 코어 sync 모델에 채택 불필요. 업계 선두 웹 도구와 동급, offline/탈중앙에선 초과.

### F5 — 손실/정규화 비대칭 = 업계 표준 (정제, "고치기" 아님)
**confidence: medium** · `docs.speckle.systems/connectors/rhino/rhino`
- Speckle Rhino 커넥터는 양방향이나 **비대칭**: publish는 geometry+hatch+text+blocks인데 load는 전부 geometry/text/blocks로 정규화(hatch는 publish 가능하나 load 카테고리에 없음). **손실 load-side 정규화가 표준 인터롭 표면, 결함 아님.**
- **Figcad의 넓은-Pull/좁은-Push(wall+slab) 설계와 문서화된 import 비대칭을 검증** — 유지·정제하되 deficiency로 취급 금지. 교훈: "손실 정규화는 OK, AI brep→파라메트릭 시맨틱리프팅이 v1.5 업그레이드 경로".

### F8 — wasm32 4GB 천장 → 커넥터 경로 결정 검증
**confidence: high** · `v8.dev/blog/4gb-wasm-memory` · `github.com/mcneel/rhino3dm/issues/512`
- WebAssembly(V8/Chrome) 최대 4GB 선형 메모리 = **wasm32의 하드 아키텍처 한계**(기본 2GB, opt-in 2-4GB, 4GB가 절대 천장). 실측: rhino3dm WASM 힙을 4GB로 올려도 대형 .3dm 로드 실패(파싱이 파일 ~2.8배로 팽창, 32-bit 주소공간 소진). McNeel·리포터 모두 MEMORY64 빌드로 선회.
- **Figcad ROADMAP 'WASM 캡' 노트 확인**: 436MB 통짜 .3dm 브라우저 import는 아키텍처적으로 막힘 → **이미 택한 커넥터/subset 경로가 옳음.**
- **⚠️ 프레이밍 정정**: "**4GB-하드 / 2GB-기본-설정가능**"으로 진술할 것. "2GB 하드 천장" 버전은 명시적으로 **refuted**(1-2 vote) — 부활 금지.

---

## 5. 내부 리팩터 트랙 — pascal-editor에서 이관 (정체성 조사 아님)

> pascal-editor(`pascalorg/editor`, 싱글플레이어 소비자 홈에디터)는 협업·인터롭·허브와 무관 = 정체성 조사 대상 아님. 단 거기서 건진 **1개**는 진짜 쓸모 있는 *내부 코드구조* 항목이라 여기 보존. "필요없던" 문제가 아니라 *다른 카테고리*(시장 채택이 아닌 우리 코드 정리).

### per-kind NodeDefinition 디스패치 테이블 (XL, kind별 점진)
- **문제**: 신규 Element kind 추가 = ~10곳 손댐, 여러 곳이 컴파일러가 강제 못 하는 `el.kind === '…'` if-chain(`core-geometry.md` 체크리스트 "누락=조용한 버그"). 구체 체인: `geometry/index.ts`(13-arm derive 디스패치) · `store.ts`(move/rotate/transformCopy/validate 중복 taxonomy) · `select.ts`(elementFootprint) · `lint.ts`+`diff.ts`(중복 KIND_LABEL) · interop 4파일.
- **올바른 프레이밍("이미 있음" 함정 회피)**: Figcad `capabilities/registry.ts`는 **op id 키**(create_wall/move) 레지스트리 — 실재·양호, 체크리스트 step 6이 이미 경유. 빠진 건 **직교 축 = kind 키** 레지스트리(파생/footprint/label/relations/interop를 kind별로). Pascal `NodeDefinition`이 그 증명: 중앙 `cascadeDirty`/`collectDescendants`가 각 kind의 `def.relations`를 **데이터로** 읽음 — 정책은 중앙, 선언만 kind 폴더로.
- **붕괴되는 step**: 2+3(derive+deriveKey → `def.derive`/`def.deriveKey`, 단 cross-element 의존성 수집은 중앙 유지) · **5(footprint+move/rotate/transformCopy 4 taxonomy → 단일 `def.positional` segment/polygon/point = 가장 깨끗한 win)** · 7+8(KIND_LABEL ×2 → `def.label`) · 9(interop arm → `def.ifc`/`def.dxf`/`def.rhino`, §3 역-import와 연결) · 10(tool/panel/icon → `def.tool`).
- **중앙 유지(불변)**: step 4 store 정책(zod·quantize·undo-origin·transact=inv 2) · cascade *실행*+delete-wins(데이터는 `def.relations`, walk+transact는 중앙) · DeriveCache memo+cross-element 의존성 수집 · step 1 `Element` discriminated union(컴파일타임 TS, 런타임 등록 불가).
- **정직 가드**: 런타임 테이블은 TS exhaustiveness(`never`-check)를 잃음. Pascal은 `as unknown as` 캐스트로 지불 → Figcad strict와 충돌. 완화: union을 authoritative로 두고 **등록 시 모든 union 멤버가 def 보유함을 단언하는 단일 테스트**(per-call 캐스트 아님).
- **Pascal 플러그인-마켓플레이스 절반(`loadPlugin`/`apiVersion` 게이팅)은 REJECT** — 내부 LFTH 도구, 3rd-party 소비자 0 = 걷어낸 MCP API와 같은 YAGNI 교훈. 내부 디스패치 테이블만.
- **Effort: XL**(union 뒤에서 kind별 점진, 빅뱅 금지. `def.positional`부터 — 줄당 붕괴 최고). **Impact: High**(코드베이스 최대 반복비용 = silent-if-chain 버그류 제거, Phase 2/미래 kind 저렴화).

### pascal에서 REJECT (off-identity / 불변 충돌 — 참고)
three-bvh-csg(LOD 아래) · 머티리얼/페인트/테마 · 워크스루 · WebGPU/R3F useFrame(inv 3 위반) · 가구/지붕벤트 카탈로그 · Zundo undo(Yjs UndoManager가 inv 2로 대체) · `def.mcp`/플러그인 API(YAGNI).

---

## 6. 열린 질문 — 다음 패스 필요

> 1차 후 dim 4·5·6 전부 미답 → **2차(§8)가 dim 5·인터롭재평가·dim4 시맨틱리프팅** 닫고, **3차 Part A(§9)가 dim4 순방향 NL→ops AI** 닫음. 아래는 *3패스 후에도* 남은 것.

**✅ 닫힘**: 크로스툴 QA/clash(dim 5, §8 — BCF+Speckle Automate식) · brep→파라 시맨틱 리프팅(§8 — v1.5 연기 정당) · 스캔→BIM(§8 — Cloud2BIM) · IFC Pset/Translator(§8) · **NL→ops 에이전트 편집(§9 — ADOPT lint-in-loop critic, 나머지 스택 이미 보유)**.

**⚠️ 여전히 미답:**
1. **생성/개념설계 AI(dim 4 약한 절반)**: Forma/Snaptrude/Hypar/Finch의 NL→제너레이티브가 Figcad에 뭘 unlock하나? §9 H6가 "ops/파라미터 출력만, 메시 bake 금지" 원칙만 medium-conf로 잡음 — 구체 채택거리는 미그라운딩(마케팅 소스 무거움). NL→ops(편집)는 §9서 닫혔으나 *생성*(무에서 설계 제안)은 별개.
2. **경쟁지형(dim 6)**: Arcol·Motif·Qonic·Forma·Snaptrude 포지셔닝·협업·인터롭·약점, Figcad 4대 불변이 엣지인가 제약인가? **3패스 다 생존 claim 0** (aecmag 등 fetch하나 secondary/마케팅이라 적대적 게이트가 컷). → Part B = 다른 렌즈(검증된 fact 아닌 포지셔닝 맵 + 우리 불변 엣지 분석) 필요, 딥리서치 부적합.

**나머지 (리서치 아니라 디자인 판단):**
3. **branch/merge의 CRDT하 타당성(F2)**: 라이브 편집은 Yjs LWW가 이미 자동해결 → feature-level merge UX는 offline-divergent 버전에만. fork 대비 비용 정당한가? **디자인 스파이크.**
4. **USD 4번째 레인(F7)**: LFTH Rhino/Revit 엔드포인트엔 USD 허브 가치 있나, .3dm/IFC로 충분한가? 미답.

---

## 7. 현재 우위 정리 (sanity)

- **실시간 협업**: Yjs CRDT + presence + per-user undo(LOCAL_ORIGIN) + offline(y-indexeddb). Figma(CRDT 아님)·Speckle·Onshape 대비 동급-또는-우위 (F1).
- **양방향 라이브쓰기**: `?op=apply` Pull/Push는 Omniverse Rhino 엔드포인트(단방향)보다 왕복서 앞섬 (F7).
- **건설 도면 생성**: `deriveDrawing.ts` 평면+단면+입면+HLR+해치 = 벤치마크 협업 플랫폼 대부분에 없음.
- **파라메트릭 pure-derive(inv 1)**: 지오메트리 미저장 — Speckle(직렬화)과 정반대 영속, 더 깨끗한 변경 모델.

---

## 8. 2차 패스 (2026-06) — AI 축 + QA/clash + 인터롭 재평가

> 1차가 dim 4·5·6을 0 claim으로 펑크내서 그 축들만 타깃 재조사(104 에이전트 / 22 소스 / 108 claim → 25 검증 → 22 confirm·3 kill → 5 finding). **결과: dim 5·인터롭재평가는 1차 소스로 완전 그라운딩, dim 4는 시맨틱 리프팅 하위축만 살아남고 NL/생성AI·dim6 경쟁지형은 또 펑크(§6).**

### G1 — brep→파라메트릭 시맨틱 리프팅: v1.5 연기 **유지·정당** (DEFER)
**confidence: high** · JCDE 11(1):110 (Brep2Seq) · `github.com/zhangshuming0668/Brep2Seq` · 대조: `VALIDATION_260416.md`·`connectors/rhino/README.md`
- 학술적으로 실재: Brep2Seq(계층 Transformer 인코더-디코더)가 brep solid를 **편집가능 피처기반 시퀀스**(5 primitive + 24 detailed feature)로 디코드, feature recognition 실증. **그러나 실데이터 정확도 부족** — DeepCAD 88.13% op / 70.23% param, Fusion360 86.79% / 78.24% (합성 99%+ 대비 ~25pt 급락, feature-level은 1.65~3.35%로 붕괴). CADCL(2025)도 param ~5%만 개선.
- **Figcad VALIDATION_260416.md 실증**: 436MB 실파일의 **72%가 Brep** = 자동 추출 불가, 바로 이 미해결 리프팅을 요구. **연기는 엔지니어링 게으름이 아니라 ML 미성숙이 근거.**
- **불변 가드**: 리프팅 = 인터롭 보강(파라미터 복원→ops), 지오 미저장·렌더루프 밖. 닿는 파일: `connectors/rhino/README.md`·`VALIDATION_260416.md`.
- ⚠️ **3 kill 주의**: "brep→파라=인페저블 / 데이터-블로커 / 가장 미성숙" 단정 claim 3건은 **0-3 반증**(Point2Cyl 노이즈 실패·데이터셋 부재 framing 과도). 미성숙은 사실이나 "불가능" 단정은 기각 — 연기 사유는 "정확도 미달"이지 "원천 불가" 아님.

### G2 — 스캔→BIM 레퍼런스 Cloud2BIM (CONSIDER v1.5)
**confidence: high** · arxiv 2503.11498 (Automation in Construction 2025) · `github.com/VaclavNezerka/Cloud2BIM` (MIT) · 대조: `schema.ts`
- 대규모 포인트클라우드(스캔/포토그래메트리)→IFC를 wall/slab segmentation + opening detection + room zoning으로 자동화(합성 wall 97.6%/column 96.2%, 실데이터 >90%, ~7x 빠름). runnable 오픈소스.
- **결정적**: 출력(IfcWall/IfcSlab/IfcOpening/IfcSpace)이 **Figcad 기존 kind에 1:1 매핑**(wall·slab·opening[door/window+hostId]·zone[IfcSpace]) → **신규 스키마 불필요**. Cloud2BIM은 곡벽/기둥/보/계단 미지원 = Figcad보다 좁은 서브셋만 emit, 전부 기존 kind 흡수.
- **불변 가드**: scan→ops면 DocStore ops 경유 필수(inv 2), 지오 미저장(inv 1). 닿는 파일: `schema.ts`·interop·connectors.
- ⚠️ nuance(§6 #하단): 입력이 **point cloud**라 Figcad가 받는 **brep .3dm엔 직접 적용 안 됨**(별개 입력). 우회(brep→mesh→point-sampling) 실용성은 미해결.

### G3 — 페더레이션 자동 QA: Speckle Automate Model Checker (CONSIDER)
**confidence: high**(코어 메커니즘) / medium(IDS 번들 임포트) · `docs.speckle.systems/analytics/model-checker` · `github.com/specklesystems/speckle-automate-checker` (Apache-2.0)
- 자동 QA는 vaporware 아님 — **실재·배포·오픈소스**. 추적 모델에 **저장·재사용 룰셋**을 manual 또는 **신규 버전 auto-run**으로 실행: 존재/수치(>·<·range)/문자(contains·is like)/불리언 검사를 WHERE/CHECK 쿼리로, 또는 IDS·COBie·Speckle 번들 임포트로(IDS = buildingSMART 정보전달표준, 2024-06 승인). Automate = 신규 버전마다 트리거되는 **CI/CD형 플랫폼**. 별도 데스크톱 체커 불필요 = 허브가 QA를 unlock.
- **Figcad fit**: 기존 **버전 diff + 요소앵커 코멘트스레드 + lint 8종** 위에 룰기반 검사를 올리는 일. 닿는 파일: `apps/server`(검사 자동화)·collab(코멘트 연계)·`packages/core/lint`(8종 확장).
- **불변 가드**: QA = 읽기/검증(비변형) — 지오 미저장, 렌더루프 밖. ⚠️ IDS/COBie 번들 임포트는 beta(paid) = 미성숙. 핵심 룰QA는 GA.

### G4 — 크로스툴 이슈 왕복: BCF (~~ADOPT~~ → **v1.5 재평가**, ROADMAP) ⭐
**confidence: high** · `technical.buildingsmart.org/standards/bcf` · BIMcollab·Wikipedia 확증
- **BCF(BIM Collaboration Format)** = openBIM 표준 — 모델 자체가 아니라 **contextualized 이슈데이터만**(뷰=PNG+IFC좌표, 요소=**IFC GUID 참조**) XML로 툴 간 전송, 이미 공유된 IFC 모델 leverage. buildingSMART 소유(Tekla·Solibri 개발), BCF 2.1/3.0 REST API.
- **Figcad 요소앵커 코멘트스레드가 정확히 BCF export 대상** — 요소 GUID 참조 + 뷰캡처. 허브의 **조율 정체성 정중앙**(저작 아닌 이슈 federation).
- **한계 해소**: 파일기반(.bcfzip)은 단일파일 무결성 의존(복사본 순환 금지) → **BCF-API 서버 중앙저장**이 해결. **Figcad는 이미 서버형이라 중앙 동기화가 자연스러움** = 이 한계 영향 적음.
- **불변 가드**: 이슈데이터만(지오 미전송), 코멘트스레드는 이미 LWW collab. 닿는 파일: `apps/web/collab`(코멘트→BCF)·interop(BCF XML 직렬화).

### G5 — 파라미터→IFC Pset 매핑: 중립 패스스루 우선 (CONSIDER 가볍게, 무거운 매핑UI REJECT)
**confidence: high** · Graphisoft AC24/27/29 IFC docs · Revit IFCExporter wiki · `docs.speckle.systems/.../ifc-schema`
- 업계 2패턴: **(A) 선언적 재사용 룰셋** — ArchiCAD IFC Translator(named, import/export 비교환, PLN/PLA/TPL/XML 저장·portable, Type+Property Mapping preset 분리, predefined+커스텀 하이브리드) · Revit `ParameterMappingTable.txt`(탭구분 3열, 외부 파일, 코드 아님). **(B) 중립 패스스루** — Speckle은 IFC를 connector별 클래스 없이 통합 `DataObject`로 정규화, Pset을 `properties.Property Sets` 아래 `Pset_*` 키로 **매핑 룰셋 없이 패스스루**.
- **결정: Figcad는 (B) 중립 패스스루 우선** — 허브 정체성(저작 아님)에 부합, 무거운 매핑 UI 회피. (A)식 무손실 export 필드는 `schema.ts` wall이 이미 예약.
- **이전 modeling-tools-review가 폐기 안 한 항목 재평가 결론**: IFC Pset 매핑은 hub에 맞으나 **ArchiCAD식 무거운 Translator UI가 아니라 Speckle식 경량 패스스루로** = off-identity 저작깊이 회피. 불변 가드: 매핑 = 데이터 왕복, 지오 미저장.

### 2차 패스 종합
| finding | 판정 | 축 |
|---|---|---|
| G1 brep→파라 리프팅 | **DEFER v1.5** (정당) | AI 역방향 |
| G2 Cloud2BIM scan→BIM | CONSIDER v1.5 (레퍼런스) | AI 역방향/인터롭 |
| G3 Speckle Automate 룰QA | CONSIDER | dim5 QA |
| G4 BCF 이슈 왕복 | ~~ADOPT~~ → **v1.5 재평가**(ROADMAP) | dim5 QA/조율 |
| G5 param→IFC Pset | CONSIDER(중립 패스스루)·무거운UI REJECT | 인터롭 |

**미답 잔존(§6)**: dim4 NL→ops/에이전트 편집·생성AI + dim6 경쟁지형 = 2패스 다 생존 claim 0 → 3차 패스.

---

## 9. 3차 패스 Part A (2026-06) — dim4 순방향 AI (NL→ops 에이전트)

> dim4 순방향(NL→ops 에이전트 편집 + 생성AI)만 타깃, Text2BIM 코드 그라운딩 + Figcad AI 스택 위 배선(101 에이전트 / 19 소스 / 87 claim → 25 검증 → 21 confirm·4 kill → 7 finding). 렌즈 = 아키텍처 패턴, 마케팅 아님.
>
> **결론 한 줄**: NL→ops 스택 대부분 **이미 있음**. 진짜 갭 = **자기수정/critic 루프** 하나. 실행 가능한 ADOPT 1개 = **lint-in-loop critic**(조사 시점 갭: `agent.ts` 루프에 `lint` 미호출 / `lint.ts:133` `lint(store)→LintFinding[]` 순수함수 실재). **→ 이후 M12-B `f5112dc`로 실행 완료**(`critiqueOpLog`, this-turn-touched만 lint, MAX_CRITIC_ROUNDS=2).

### H1 — 이미 보유 (갭 아님): 도구 추상화 + NL→API(지오 bake 아님)
**confidence: high** · Text2BIM(arxiv 2408.08054 + repo) · 대조: `capabilities/catalog.ts`·`agent.ts`
- NL→BIM 문헌의 두 핵심 조각을 Figcad가 이미 가짐: (a) 문서 API 위 **도구 추상화 레이어** — Text2BIM의 26개 캡슐화 tool 함수 ≈ Figcad **capability registry**(create_wall/move op-id 키, zod 검증, `run()`이 DocStore primitive만 호출). (b) **NL→API 호출**(raw 지오메트리 bake 아님) 출력 경로 — dryrun→승인→applyOpLog가 검증된 ops만 산출.
- nuance: Text2BIM은 엔지니어링 로직이 일부 tool 안에, Figcad는 op run이 thin pass-through이고 기하 추론(마이터 조인 등)은 파라메트릭 `geometry/` 레이어(불변 ①). 추상화 역할 같음, 위치 다름. **"있는 걸 갭으로 오인 금지"의 핵심 결과.**

### H2 — GAP #1: 멀티에이전트 역할 분담 (CONSIDER, 단 필요시만)
**confidence: high** · 대조: `agent.ts:178-247`
- Text2BIM = 4개 전문 에이전트(Instruction Enhancer/Architect/Programmer/Reviewer = 계획→생성→리뷰 분할). Figcad `/api/agent` = **단일 SYSTEM_PROMPT·단일 모델·단일 MAX_ITERATIONS=12 ReAct 루프**(계획·실행 한 프롬프트 공유), 분할 없음.
- **판정 CONSIDER(채택 아님)**: 실제 아키텍처 차이지만 경량. **단일 패스 품질이 부족함이 입증될 때만** 정당. AgentRunner DO 위에 배선, 4역할 다 executeOp로 op-log 종료 → 불변 위반 0. Text2BIM 분할은 free-form Vectorworks API 복잡도 때문 — Figcad엔 그 복잡도 없음(열린질문).

### H3 — GAP #2 + 권고 fix: lint-in-loop critic (ADOPT → ✅ shipped M12-B `f5112dc`) ⭐
**confidence: high** · Text2BIM checker→BCF→Reviewer 루프 · 대조: `lint.ts:31-56,133` + `agent.ts`(lint 미호출, 이 세션 검증)
- Text2BIM은 생성→검증→수정 루프를 닫음: IFC export → 룰기반 체커가 BCF 이슈 방출 → Reviewer가 해석·재프롬프트 → 에러 0까지 반복. **Figcad는 해당 조각 다 가짐** — `lint.ts`가 순수 결정적 룰체커(`LintFinding[]{code,severity,message,elementIds,fix}`, ~8-10 코드: overlap-wall·unjoined-endpoint·orphan-* 등) + dryrun이 생성/미리보기 공급 — **조사 시점엔 `agent.ts`가 루프 안에서 `lint()` 미호출 → M12-B(`f5112dc`)에서 `critiqueOpLog`(this-turn-touched 요소만 lint)로 닫음.**
- 현재 agent.ts는 **구문 절반만**: executeOp/zod 에러를 `tool_result(is_error:true)`로 모델에 환류. **도메인 룰 절반(겹침·미접합·고아)은 빠짐.**
- **ADOPT(최고가치)**: tool 루프 후 `lint(dryStore)` 실행 → findings를 관찰로 환류 → applyOpLog 커밋 **전에** 반복. 불변 준수: lint=읽기전용 순수, 루프가 승인 게이트 **앞**, fix는 delete 기반 ops(lint의 fix가 이미 delete-only). **`LintFinding`(code+elementIds) = BCF(이슈+요소GUID)의 직접 아날로그** → §8 G4와 연결.

### H4 — critic 배선 원칙 (결정적): 외부 결정적 검증자로만, LLM 판사 금지
**confidence: high** · CRITIC(ICLR 2024, 2305.11738) · Kamoi TACL 2024(2406.01297) · Huang ICLR
- **LLM 자기수정은 신뢰 가능한 *외부* 피드백(도구/검증자)이 있을 때만 작동** — 모델 자체 프롬프트 자기판단으론 신뢰 불가, 출력 악화 가능. Kamoi: "prompted LLM 피드백으로 성공한 자기수정 선행연구 없음(예외적 적합 태스크 제외)... 신뢰 가능한 외부 피드백 쓰는 태스크에서 잘 작동."
- **∴ Figcad critic은 이미 소유한 결정적 외부 신호로** — lint(8-10코드) + executeOp/zod + dryrun DocStore. **LLM 판사 추가 금지.** Figcad는 구문층(executeOp 에러→tool_result)엔 이미 이 패턴 구현, 도메인층(lint)이 빠진 외부 피드백 채널. = H3 fix의 실증 근거 + LLM Reviewer 추가에 대한 반대 근거.

### H5 — REJECT: op 위 코드생성(free-form Python) 레이어
**confidence: high** · 대조: `agent.ts:161-163`
- Text2BIM은 의도적으로 JSON discrete 함수호출 대신 imperative 코드생성 선택(알고리즘 로직으로 tool 조합 가능). **이건 Figcad 설계의 정반대**: capability registry = JSON discrete-op 모델(op-id당 inputSchema 1개, 호출당 executeOp), Anthropic strict tool use 의도적 OFF(16도구=grammar 400), 런타임 검증 대체.
- Figcad엔 discrete-op이 load-bearing(불변 ② = 모든 변경 DocStore ops 경유, undo/zod/연쇄삭제 전부 ops). 코드 레이어는 이 경계 우회 → **REJECT**(게이트 b). 코드생성 이점(알고리즘 tool 조합)은 multi-iteration ReAct 루프로 달성됨.

### H6 — 생성/개념설계 AI: ops/파라미터만, 메시 bake 금지 (약한 절반)
**confidence: medium**(ACADIA 2023 PDF 텍스트층 비추출, 초록+2차 의존)
- 문헌의 생성AI도 **파라메트릭 스크립트/코드 출력**(메시 bake 아님) — ChatGPT가 Revit Dynamo 노드·Grasshopper 컴포넌트로 실행될 Python 생성, 모델=파라메트릭 정의(wallType/length/height 등). 자기수정은 **수동**(유저가 에러 손복사 환류), 저자는 API 자동화를 future work로.
- **Figcad 함의**: 어떤 생성AI 기능도 ops/파라미터 방출해야지 메시 bake 금지(불변 ① reject 게이트). Figcad의 자동 executeOp-에러 환류는 이미 이 논문 수동 루프보다 앞섬.

### H7 — ReAct 루프는 이미 있음, 신규 오케스트레이션 불필요
**confidence: medium** · ToolCAD(2604.07960, 미peer review) · 대조: `agent.ts:180-237`
- 다단계 계획→tool호출→관찰 루프(one-shot 아님)가 에이전트 CAD/BIM 편집의 검증된 추론 패턴, **Figcad가 이미 구현**(MAX_ITERATIONS=12, 각 tool 호출이 dryrun store 변경, 결과가 tool_result로). **루프 자체엔 신규 레이어 불필요 — critic/검증 스테이지만 추가.**
- ⚠️ ToolCAD의 gym/RL/curriculum은 *학습* 구성물(추론 권고 아님), 추론시 ReAct만 이관. "이게 capability-registry=best-in-class 입증" 동반 claim은 **0-3 반증**(과확대).

### ⚠️ 반증된 것 (4건, 0-3) — 보안 패턴 매핑
에이전트 **보안** 패턴(Plan-Then-Execute·Action-Selector·CaMeL 2506.08837)을 Figcad dryrun/registry에 매핑해 "현 설계가 이미 최적" 주장한 4 claim = **전부 반증**. **이 보고서는 보안문헌이 Figcad 설계를 보증한다고 주장 안 함** — NL→BIM·자기수정 문헌만 보증. dryrun=하드게이트는 Figcad 자체 불변 ② 근거로 타당(외부 보안근거 아님).

### 3차 Part A 종합 + 열린질문
| finding | 판정 |
|---|---|
| H1 도구추상화+NL→API | 이미 보유 (갭 아님) |
| H3 **lint-in-loop critic** | **ADOPT** ⭐ |
| H4 외부 결정적 검증자로 critic 배선 | ADOPT 원칙 (LLM 판사 금지) |
| H2 멀티에이전트 역할분담 | CONSIDER (단일패스 부족 입증시만) |
| H7 ReAct 루프 | 이미 보유 |
| H5 free-form 코드 레이어 | **REJECT** |
| H6 생성AI 메시 bake | REJECT, ops/파라미터만 |

**열린질문(디자인 판단)**: lint-in-loop을 매 iteration vs 루프 후 1회(overlap-wall O(n²) 비용, 416MB 스케일) · 어느 severity가 block vs inform(error만? warning도?) · 멀티에이전트 분할이 LOD 100-250엔 실익 있나(실프롬프트 A/B 필요, 문헌 추론 아님) · lint findings를 모델에 어떻게 노출(tool_result vs text vs 전용 read-only lint 도구, 프롬프트캐시 breakpoint와 상호작용).

---

## 부록 — 핵심 소스

| 영역 | 소스 | 품질 |
|---|---|---|
| 실시간/충돌 | figma.com/blog/how-figmas-multiplayer-technology-works | primary |
| branch/merge | onshape.com/en/features/branch-merge-cad · cad.onshape.com/help/.../branching.htm | primary |
| Speckle 객체모델/컨버터 | speckle.guide/dev/objects.html · github.com/specklesystems/speckle-sharp | primary |
| federation/diff | docs.speckle.systems/3d-viewer/federation · /compare-versions | primary |
| 커넥터 비대칭 | docs.speckle.systems/connectors/rhino/rhino | primary |
| live-sync/USD | docs.omniverse.nvidia.com/connect/.../live.html | primary |
| WASM 천장 | v8.dev/blog/4gb-wasm-memory · github.com/mcneel/rhino3dm/issues/512 | primary |
| 3D Tiles/배칭 | OGC 22-025r4 · docs.speckle.systems/developers/viewer/viewer-rendering | primary |

본 문서는 의사결정 참고용. 빌드 착수는 별도 결정 — 항목별 우선순위·닿는 파일·불변 가드는 §2~5에 박제. dim 4·5·6은 미답이니 그 위 의사결정 전 §6 리서치 패스 선행.
