# 제너레이티브/개념설계 AI 범위 — Figcad가 무엇을 채택하나

> **R4 리서치 (2026-06-19).** `hub-benchmark-review.md` §6 #1 + H6의 미답 절반을 닫음. **구분(중요)**: NL→ops *편집*("이 벽 높여")은 §9 Part A에서 닫힘(ADOPT lint-in-loop critic, 나머지 스택 이미 보유). 이 문서의 타깃 = **제너레이티브/개념설계 AI** — NL/brief/제약 → massing/layout/floorplan *제안*을 무에서/제약에서 생성. §6 #1: "Forma/Snaptrude/Hypar/Finch의 NL→제너레이티브가 Figcad에 뭘 unlock하나? §9 H6가 원칙만 medium-conf로 잡음 — 구체 채택거리 미그라운딩."
> **하드 제약 (불변 ①)**: 어떤 제너레이티브 기능도 **ops/파라미터를 방출해야지(create_wall·create_slab with params), 메시를 bake하면 안 된다.** 메시-bake 생성 = reject 게이트. 이 문서가 그 게이트를 1차 소스로 확증하고, 무엇이 그걸 자연히 통과/위반하는지 매핑.
> 페어/선행: `hub-benchmark-review.md` H6(생성AI=파라미터만, 이 문서가 medium→그라운딩으로 승격) · `geometry-representation-study.md` §9(AI-freeform=파라미터 편집, import=lift+Lane-2+AI clean-up) · `positioning-vs-mcp.md` §8(ingest=PR primitive: import→staging AI clean-up→merge).

---

## 0. TL;DR — 판정 (2개 verdict)

**advisor가 가른 결정 축: 제너레이티브 기능을 "편집-clean" 게이트가 아니라 "정체성-fit" 게이트로 판단하라.**

1. **무에서 massing/layout 생성("brief→건물 제안")은 불변-clean이지만 off-identity.** create_* ops를 방출하면 불변 ① 통과(= 빈 doc을 가리킨 NL→ops 에이전트일 뿐) — **그러나 그건 *저작*이지 *조율*이 아니다.** repo가 거듭 reject하는 바로 그 방향(저작깊이 추격, `positioning-vs-mcp.md` §4). → **REJECT-as-core / CONSIDER-as-light-seed** (불변 위반은 아니나 정체성 게이트 b에 걸림).
2. **허브 정체성에 *맞는* 제너레이티브 = ingest된 모델을 ops로 lifting/clean-up하는 변환 AI.** `positioning-vs-mcp.md` §8 import→staging→merge PR primitive가 정확히 이 자리. = *조율을 섬기는* 제너레이티브/변환 AI. → **ADOPT (정체성 핵심, 불변 ① 준수 — 단 신뢰도 게이트 필요).**
3. **업계가 Figcad 불변을 확증한다 (R4의 가장 큰 발견):** 진지하게 출하/신뢰되는 제너레이티브 AEC는 **전부 파라미터/ops/코드를 방출하지 메시를 안 굽는다** — Hypar(Elements Wall/Floor 타입), Text2BIM(`create_wall()` 호출), TestFit(configurator + Dynamo 노드), scan-to-BIM(파라메트릭 IFC). **메시-bake 생성기(House-GAN류 raster)는 *낡고 약한* 연구 라인이고 분야 자체가 거기서 떠났다.** → **불변 ①은 제약이 아니라 업계-정렬 선택.**
4. **신뢰도가 진짜 병목, 검증된 답 = 결정적 checker-in-loop.** DStruct2Design 폴리곤-overlap 실패 **16-37%**, Cloud2BIM 실데이터 25-50mm 오차 + 곡벽/비직각 전부 실패. 생성 파라메트릭 출력은 **첫 패스에 신뢰성있게 build 안 됨** → 무거운 결정적 교정 필요. **= Figcad M12 lint-in-loop critic 아키텍처를 외부 확증** (Text2BIM 룰체커→BCF→Reviewer 루프, DStruct2Design verifiable constraints, 2026 RL-with-verifiable-rewards).
5. **메시-bake 생성 = HARD REJECT, 명시적으로.** 이 환경에 실제로 있는 `mcp__blender__generate_hunyuan3d_model`·`generate_hyper3d_model_via_text`(텍스트→메시 생성) = 정확히 reject 클래스. 불변 ① 직접 위반 — Figcad는 ops/파라미터만.

---

## 1. 방법 / 신뢰도

- **렌즈 = native output 표현 축** (advisor가 분해): (a) 제너레이티브 엔진이 *네이티브로* 방출하는 것, (b) 제품이 *export*하는 것, (c) (b)가 충실한 파라메트릭 재구성인지 baked dump인지. **Figcad 호환은 (a)에 걸림.**
- **소스**: aggregator 블로그(ai-tower·archgyan 등)는 lead로만; load-bearing native-output claim은 전부 primary(arxiv·공식 vendor doc·1st-party repo/README)에 앵커.
- **검증**: "논문서 데모됨" vs "출하되고 신뢰됨" 구분. Text2BIM `create_wall()` 코드블록은 arxiv HTML로 직접 확인. Hypar Elements 타입은 GitHub README로 확인.
- **시간민감**: 분야가 2024-2026에 **구조화 출력 쪽으로 수렴 중** (raster GAN → vector diffusion → LLM-to-code). 2026 스냅샷.

---

## 2. VERIFIED FACTS — native output 표현 축 (분야 현황)

> 핵심 발견 정렬: **진지한 제너레이티브 AEC는 파라미터/ops/코드를 방출한다.** 태그 P(primary)/S(secondary).

### 2.1 상업 제품

**Hypar (hypar.io) — 가장 강한 호환 신호** (P: github.com/hypar-io/Elements)
- 생성: 클라우드 **"functions"**(코어배치·파사드·daylight·layout)가 완전한 건물 시스템 방출.
- (a) native: 오픈소스 **Elements** 라이브러리의 **1급 시맨틱 BIM 타입(Wall·Beam·Column·Floor…) = typed 클래스** + "simple hybrid BREP/CSG geometry kernel" + 기하 primitive. **파라메트릭/절차적 지오, pre-baked 메시 아님.**
- (b) 직렬화: JSON(native)·IFC·glTF·DXF·SVG.
- 핵심: 자체 geometry kernel부터 빌드(Grasshopper/Dynamo 기반 아님). 제너레이티브 로직이 시맨틱 파라메트릭 element 방출.
- **Figcad 판정: 가장 직접 호환.** Elements Wall/Floor를 파라메트릭 profile로 방출하는 function = Figcad 불변이 요구하는 ops/파라미터 모양 그 자체. **제너레이티브 AEC가 end-to-end 파라메트릭-native일 수 있다는 가장 깨끗한 존재증명.**

**Text2BIM (arxiv 2408.08054, TUM, J. Computing in Civil Eng vol40 no2) — 정확히-호환 패턴** (P: arxiv HTML + GitHub dcy0577/Text2BIM)
- 생성: NL → 완전 편집가능 BIM(내부 layout·외피·시맨틱).
- (a) native: 멀티에이전트 LLM에서 "Programmer" 에이전트가 **제약 API를 호출하는 imperative Python 코드** 작성 — 샘플 호출 `create_story_layer()`·`create_wall()`, Vectorworks서 실행해 편집가능 native BIM. **메시/지오 출력 아님; ops/함수호출 방출.**
- 신뢰도 메커니즘 (Figcad lint-in-loop과 직결): **룰기반 model checker**(LLM 판사 아님)가 기하분석+collision detection+정보검증 → 에러를 **BCF**로 → Reviewer→Programmer 루프가 **에러 0까지 반복**. = 결정적-critic 자기수정 = Figcad M12 lint critic과 같은 아키텍처.
- 성숙도: 연구 프로토타입(Vectorworks 통합, 활발 유지 — Claude-4/o4-mini/Gemini-2.5 지원).
- **신뢰도 수치 = UNKNOWN**: 논문 §6.2가 3 LLM pass-rate 보고하나 정확 % 추출 실패(PDF 크기 초과, secondary 다 누락). 질적으로 "GPT-4o·Mistral-Large-2 high pass rates"만 확인.

**TestFit** (S: AEC Mag·Architosh 2024-07, 다수 확증)
- 생성: 부동산 feasibility — site plan·건물 config·주차·unit-mix, "수초에 수천 buildable 옵션".
- 입력: 부지경계 + 제약(setback·easement·access) + 최적화 타깃(FAR·주차비·yield).
- (a) native: **constraint-satisfaction solver + 파라메트릭 configurator + 제너레이티브 알고리즘** — 구성상 파라메트릭(메시 생성기 아님). (b) export: **Dynamo 노드 + Revit add-in**, SketchUp. **Dynamo-노드 export = 다운스트림에 파라메트릭/스크립트 recipe를 넘김**, 단순 지오 아님.
- 성숙도: 출하(2016~), 전용 "Generative Design" 2024-07 출시.
- **Figcad 판정: 호환** — 파라메트릭 configurator, Dynamo-노드 export가 Hypar와 함께 가장 ops-like.

**Snaptrude** (S: 자체 블로그 "RFP to Massing" 2026-03 — vendor primary이나 promotional)
- 생성: RFP/brief → site분석 → 프로그램 → **massing→core→"Pack"**, story별 stack. AI-에이전트 파이프라인.
- (a) native: Snaptrude는 native 파라메트릭 BIM 모델러. claim: 개념 massing → LOD 300/350 BIM, "massing을 wall/slab로 변환", **파라미터 보존한 채 Revit export.** = 파라메트릭-native + (c)충실 export. **vendor-claimed, 독립 검증 안 됨.**
- 신뢰도 신호: 2026에 "space-level 생성이 코어 파이프라인 밖으로(속도), AI는 department-level서 작동" = 세밀 생성이 de-scope됨(암묵적 신뢰도/성능 신호).
- **Figcad 판정: 아키텍처상 호환**(파라메트릭 BIM native, "massing→wall/slab"=ops 모양). 단 생성품질 claim은 vendor-only.

**Autodesk Forma** (P: adsknews.autodesk.com Building Layout Explorer 발표; S: Autodesk Community/Learn massing)
- 생성: massing 볼륨 + 환경분석(sun/wind/noise) + **"Building Layout Explorer"** = AI floor-plan layout 옵션.
- (a) native massing = **편집가능 파라메트릭 볼륨**(층수·층고·폭 파라미터, 직접조작 edge/vertex). 분석-메시 아님. (b) export: Revit native object로(terrain→toposolid, mass→wall/floor/roof) = (c)타입 재구성, 메시 dump 아님.
- **Building Layout Explorer 출력 표현(파라메트릭 vs raster) = 공식발표서 비공개. 진짜 unknown.**
- 성숙도: massing/분석 = 출하. **Layout Explorer = 명시적 EXPERIMENTAL** ("some outputs more useful than others as it continues to evolve").
- **Figcad 판정: massing은 파라메트릭/호환. AI *layout 생성* 출력 포맷 미검증.** Revit 브릿지는 Forma가 native 파라메트릭 재구성 가능함을 입증(좋은 신호).

**Finch (finch3d.com)** (S: AEC Mag "Finch3d starts to sing"; Finch Medium "Finch Graph Rules")
- 생성: 실시간 floor plan + massing + 라이브 성능피드백(면적·daylight·CO₂), 다수 topology 변형.
- (a) native: 특허 **"Finch Graph"** = 공간 그래프(room=node, adjacency=edge), room/corridor/구조/룰 관계 매핑. **명시적으로 pixel/image 기반 아님.** 결과 편집가능(AI 출력 수동 override).
- (b) export 포맷 = 1st-party primary 미고정(soft).
- **Figcad 판정: 구조상 호환**(관계/파라메트릭, raster 아님). 강한 개념 fit, 단 export 지오 포맷 미검증(soft on b).

### 2.2 학술/연구

**Architext (arxiv 2303.07519)** — NL→residential floor plan. (a) finetuned GPT가 **각 room을 2D 좌표 폴리곤으로 TEXT 방출** (raster 아님; DStruct2Design 비교표가 "Room polygon coords"로 확증, P arxiv 2407.15723). 신뢰도: "near 100%" valid(author claim). 한계: **수치 기하 제약 못 받음**(정확 면적 등). **Figcad 판정: 부분 호환** — room 폴리곤은 vector이나 *공간경계*지 건물 element 아님 → **lifting 패스 필요**(폴리곤→wall/slab ops).

**House-GAN / House-Diffusion (House-Diffusion = arxiv 2211.13287)** — graph-제약 floor plan. House-GAN: vector 생성하나 **raster로 discriminate**, "raster-to-vector 변환 필요" → raster-tainted = **비호환.** House-Diffusion: **직접 vector**(room/door = 1D 폴리곤 loop 좌표) = **부분 호환**(vector이나 room boundary, wall-lifting 필요; bubble-graph 입력, NL 아님). 둘 다 연구 프로토타입.

**최근 궤적 (2024-2026) — 구조화 출력이 이김** (P)
- **DStruct2Design (arxiv 2407.15723)**: floorplan = **JSON, room=폴리곤 vertex + 수치필드(면적·타입)**, 제약명세/검증 가능. best: Total-Area 0.95, Room-Area 0.94. **BUT 폴리곤-overlap 실패 16-37%** = 생성 layout이 자주 **기하적으로 invalid(겹침)** = 교정 필요. (구체 신뢰도 수치, primary.)
- **"Generative Floor Plan Design with LLMs via RL with Verifiable Rewards"** (OpenReview `ZMmDwqjQN9`, 2025-11; arxiv PDF `2511.00066`) — LLM fine-tune + RLVR로 수치(면적·치수)+공간(topology) 제약 강제. **[정정: R1 sub-agent가 인용한 ID `2605.14117`은 실재하지 않음 — 실제 paper는 OpenReview, arxiv `2511.00066`. WebSearch로 확인·교정.]** + **"Text-to-Code Generation for Modular Building Layouts in BIM" (Text2MBL, arxiv 2509.23713, NeurIPS 2025)** — "fully parametric, semantically rich BIM layouts through on-the-fly code instantiation", Revit API C# 클래스 (github.com/CI3LAB/Text2MBL). 둘 다 WebSearch로 ID 검증됨(P). 분야가 **LLM→구조화데이터/LLM→코드 + verifiable/결정적 보상·체킹**으로 수렴 = Text2BIM·Figcad critic-in-loop과 동형.

### 2.3 Import clean-up / model lifting (mess→파라메트릭)

> `positioning-vs-mcp.md` §8 ingest=PR primitive의 "staging AI clean-up" 레인의 실증.

- **Cloud2BIM (arxiv 2503.11498, 오픈소스)**: 대형 point cloud → **파라메트릭 IFC**(IfcWall start/end·IfcSlab profile·IfcOpening·zone), **메시 아님.** 주목: **기하 heuristic만 — AI/딥러닝 없음**(density histogram·morphology·contour·Douglas-Peucker). 신뢰도: 합성 mm-level, **실데이터 25mm(일부 >50mm), 곡벽·비직각 opening·split-level 불가**, 노이즈/sparse서 degrade. (`hub-benchmark §8 G2`가 이미 CONSIDER로 잡음 — 출력이 Figcad kind에 1:1.)
- **딥러닝 scan-to-BIM** (ISPRS 2024, CVPR 2024 Scan-to-BIM Challenge): PointNet++ + RANSAC/PCA + IfcOpenShell → **편집가능 파라메트릭 BIM**(Revit 호환). BIMStruct3D(arxiv 2604.24311): topology refinement + IFC export.
- **Takeaway**: scan/mesh→BIM 연구계열 전체가 **파라메트릭 IFC element(ops 모양) 방출로 수렴**, 메시 bake 아님 → Figcad "import→AI clean-up→파라메트릭" 레인 직접 확증. 단 **직각 primitive에 제약 + messy input서 degrade** → `geometry-representation-study.md` §9의 "Lane-2 잔여 + AI clean-up fallback" 필요성 확인.

### 2.4 호환성 매트릭스 (native output 축)

| 도구/논문 | native 출력 (a) | Figcad 호환? | 성숙도 |
|---|---|---|---|
| **Hypar** | 시맨틱 Elements(Wall/Floor/Beam), BREP/CSG kernel | **YES — 직접** | 출하 |
| **Text2BIM** | Python `create_wall()` API 호출 | **YES — 정확 패턴** | 연구 |
| **TestFit** | constraint-solver param; Dynamo-노드 export | **YES** | 출하(gen 2024) |
| **Snaptrude** | 파라메트릭 BIM; "massing→wall/slab" | **likely yes** (vendor-claim) | 출하 |
| **Forma** | 파라메트릭 볼륨 → Revit native 재구성 | **massing yes**; AI-layout 포맷 unknown | 출하(massing)/실험(Layout) |
| **Finch** | 공간 그래프 + grid-aligned wall | **likely yes** (export 미검증) | 출하 |
| **Architext** | room 폴리곤 좌표(text/vector) | **부분** — 폴리곤→wall lifting 필요 | 연구 |
| **House-Diffusion** | vector 폴리곤 loop | **부분** — lifting 필요; graph 입력 | 연구 |
| **House-GAN** | raster-discriminated | **NO** — raster→vector 변환 | 연구 |
| **Cloud2BIM/scan-to-BIM** | 파라메트릭 IFC element | **YES** (직각만) | 오픈소스/연구 |

---

## 3. SYNTHESIS — Figcad가 무엇을 unlock하나 (정체성 + 불변 게이트)

> H6(생성AI=ops/파라미터만, medium-conf)를 그라운딩으로 승격하고, advisor의 정체성-축 프레이밍으로 채택거리를 가른다.

### 3.1 두 종류의 "제너레이티브"를 가른다 — 이게 결정 축

**advisor 핵심: 불변 게이트(메시 bake?)는 통과해도 *정체성 게이트*(저작 vs 조율)에서 갈린다.**

| 종류 | 무엇 | 불변 ① | 정체성(허브) | 판정 |
|---|---|---|---|---|
| **A. 무에서 생성** (brief→massing/layout, Forma Layout Explorer·Snaptrude RFP·Text2BIM·Architext) | 빈 doc에 create_* ops | clean **if ops** | **off** — 저작이지 조율 아님 | REJECT-core / CONSIDER-light-seed |
| **B. ingest 변환/clean-up** (messy import→파라메트릭 ops, Cloud2BIM·scan-to-BIM lifting·brep→파라 시맨틱 리프팅) | 외부모델→staging→merge | clean **if ops** | **core** — 조율을 섬김 (§8 PR primitive) | **ADOPT** (신뢰도 게이트 하) |
| **C. 메시-bake 생성** (text→mesh: hunyuan3d·hyper3d·House-GAN raster) | 지오메트리 직접 | **위반** | n/a | **HARD REJECT** |

**왜 A가 off-identity인데 불변엔 clean한가**: NL→massing이 `create_wall`/`create_slab`만 방출하면 불변 ① 통과(메시 안 구움) — 기술적으로 §9 NL→ops 에이전트를 빈 doc에 가리킨 것뿐. **그러나 그건 "말로 건물을 *짓는다*" = 저작깊이**, `positioning-vs-mcp.md` §4가 데스크톱 몫으로 둔 것. Figcad 일감 = *모으고 조율*. → 불변으론 못 막지만 **정체성 게이트 b**(더 무거운 단독 모델러化, `hub-benchmark §1.4`)에 걸림.

**왜 B가 정체성 핵심**: `positioning-vs-mcp.md` §8 = ingest는 PR(import→staging AI clean-up→merge). clean-up "지능"(스냅수정·겹침 dedup·분류·labeling·brep→파라 리프팅)이 **중앙 staging의 AI**. = *조율을 섬기는* 변환/제너레이티브 AI. 입력(messy 외부모델)이 허브의 본질이고, 출력(깨끗한 파라메트릭 ops)이 불변 ① 준수. **이게 §6 #1이 물은 "제너레이티브가 Figcad에 뭘 unlock하나"의 진짜 답** — 무에서 짓는 게 아니라 **들어온 것을 ops로 들어올린다.**

### 3.2 채택/거부 권고 (각각 불변 태그)

**ADOPT — 정체성 핵심:**
- **[B1] Import clean-up 패스 = ingest staging의 AI 변환** — messy import(스냅 안맞음·겹친선·미분류 레이어)를 **파라메트릭 ops 제안**으로. *touches 불변 ②*(DocStore ops 경유 필수) + *불변 ①*(메시 주입 금지, 파라미터만). 입력=reference-layer 읽기메시, 출력=create_* ops 제안 → staging diff 리뷰 → merge. 실증: Cloud2BIM·scan-to-BIM이 파라메트릭 IFC 방출(메시 아님)로 이 레인 검증. `geometry-representation-study.md` §9 "빌드 4개" 중 AI clean-up 패스. **단 §3.3 신뢰도 게이트 필수.**
- **[B2] brep→파라메트릭 시맨틱 리프팅 (v1.5, ML 성숙 대기)** — `hub-benchmark §8 G1`이 이미 DEFER로 정당화(Brep2Seq feature-level 1.65-3.35% 붕괴). VALIDATION_260416의 72% brep가 요구. *touches 불변 ①*(파라미터 복원→ops, 지오 미저장). **= B1의 더 어려운 케이스, ML 미성숙이 연기 사유(엔지니어링 게으름 아님).**
- **[B3] critic-in-loop = lift 신뢰도 게이트** — 모든 B 생성은 §3.3 결정적 critic 통과 필수. `hub-benchmark §9 H3/H4`(M12-B `f5112dc` lint-in-loop critic)를 **import 레인으로 확장**. *touches 불변 ②*(lint=읽기전용 순수, merge 게이트 앞).

**CONSIDER (light, 정체성 경계):**
- **[A-light] "seed from sketch/brief" = 빈 캔버스 1-shot 시드, 깊은 저작 아님** — `hub-benchmark §9 H6` + M9-A(스케치→모델)가 이미 토대. NL/sketch → *초기* massing ops 시드(그 후 사람/AI가 조율). *touches 불변 ①*(ops만). **경계 주의**: 이게 "AI가 전체 설계를 짓는다"로 커지면 off-identity. M9-A 수준(시드)에서 동결, 풀 제너레이티브 저작으로 확대 금지. = `positioning-vs-mcp.md` §4 "입력 UI 가볍게 + 파라메트릭 어휘 풍부 + sketch/text→AI 채널" 정렬.

**REJECT:**
- **[C] 메시-bake 생성AI — HARD REJECT, 명시적.** text→mesh / image→mesh가 OBJ/glTF 메시를 doc에 굽는 것. **이 환경에 실재하는 reject 클래스**: `mcp__blender__generate_hunyuan3d_model`·`mcp__blender__generate_hyper3d_model_via_text`(텍스트→3D 메시), House-GAN(raster floorplan). **불변 ① 직접 위반**(지오는 파라미터에서 순수파생, 저장/생성 금지). `ROADMAP` REJECT 목록 H6과 일치. Figcad는 ops/파라미터만 — 어떤 생성품도 create_*로 표현 안 되면 reject.
- **[A-deep] 무에서 풀 제너레이티브 저작** (brief→완전 건물, Forma/Hypar식 깊이) — 불변은 통과하나 **정체성 게이트 b**(저작깊이=데스크톱 몫). `positioning-vs-mcp.md` §4·§7 "모델링 깊이 추격 멈춰라". `hub-benchmark §1.4` 게이트 (b). Hypar/Forma가 이미 함 = 베끼면 단독 모델러化.

### 3.3 신뢰도 게이트 — 생성 파라메트릭은 첫 패스에 안 build됨 (결정적)

**R4 가장 실용적 발견**: 생성→파라메트릭 출력은 신뢰성있게 valid하지 *않다*:
- DStruct2Design **폴리곤-overlap 16-37%** (생성 layout이 자주 기하 invalid)
- Cloud2BIM 실데이터 **25-50mm 오차 + 곡벽/비직각 전부 실패**
- Text2BIM은 룰체커가 에러 0까지 반복해야 했음

**∴ 어떤 B(또는 A-light) 채택도 결정적 critic-in-loop 필수** = Figcad가 이미 가진 것(M12-B lint-in-loop, `f5112dc`). 검증된 패턴(Text2BIM 룰체커→BCF→Reviewer, 2026 RL-with-verifiable-rewards)이 **전부 결정적 외부 검증자**(LLM 판사 아님 — `hub-benchmark §9 H4`와 일치). **즉 새 critic 아키텍처 불필요 — import 레인에 기존 lint critic을 배선하는 일.**

### 3.4 H6 승격 (medium → grounded)

`hub-benchmark §9 H6`는 "생성AI=ops/파라미터만, 메시 bake 금지"를 **medium-conf**(ACADIA 2023 텍스트층 비추출, 초록 의존)로 잡았다. R4가 이를 **primary로 그라운딩**:
- Hypar Elements(GitHub README, 시맨틱 typed 클래스)·Text2BIM(`create_wall()` arxiv HTML 직접)·scan-to-BIM(파라메트릭 IFC) = **진지한 출하/연구가 전부 파라미터/ops/코드 방출, 메시 안 구움.**
- 메시-bake(House-GAN raster)는 **낡고 약한 라인, 분야가 떠남**(vector diffusion→structured→code 수렴).
- **결론: 불변 ①은 제약이 아니라 업계-정렬 선택.** H6 원칙 유지 + confidence high로 승격. (모순 없음 — H6 강화.)

---

## 4. VERIFIED vs SYNTHESIS vs UNKNOWN (투명성)

- **VERIFIED (primary)**: Text2BIM `create_wall()`/`create_story_layer()` Python ops 방출 + 룰체커→BCF→반복 루프(arxiv HTML); Hypar Elements 시맨틱 typed BIM 클래스 + BREP/CSG kernel(GitHub README); Cloud2BIM 파라메트릭 IFC 출력 + heuristic-only(no AI) + 실데이터 25-50mm·곡벽실패(arxiv); DStruct2Design JSON 폴리곤+수치필드 + overlap 16-37%(arxiv); House-Diffusion vector / House-GAN raster(CVPR); Architext room 폴리곤 좌표(DStruct2Design 비교표); 분야가 LLM→code+verifiable로 수렴(2025-26 — Text2MBL arxiv 2509.23713 "fully parametric BIM via code instantiation" + BIMStruct3D arxiv 2604.24311 IfcWall/IfcColumn via IfcOpenShell, 둘 다 WebSearch로 ID·요지 검증). **ID 정정 1건**: RLVR floorplan paper는 R1이 인용한 arxiv `2605.14117`이 실재 안 함 → 실제 OpenReview `ZMmDwqjQN9`/arxiv `2511.00066`로 교정.
- **VENDOR-CLAIMED (회의적)**: Snaptrude "massing→wall/slab, 파라미터 보존 Revit export"(자체 블로그); Forma massing 파라메트릭 볼륨(community); Finch 그래프 비-raster(AEC Mag/Medium).
- **SYNTHESIS (이 문서 판단)**: A/B/C 정체성 분류; B=정체성 핵심·A=off-identity 결론; 신뢰도 게이트=critic-in-loop 매핑; H6 승격. = verified 사실 위 판단.
- **UNKNOWN (정직)**: Text2BIM 정확 pass-rate %(PDF 크기 초과, §6.2 보고하나 secondary 다 누락); Forma Building Layout Explorer 출력 포맷(파라메트릭 vs raster, 비공개); Finch/Snaptrude export 지오 포맷(native 파라메트릭은 확인, export 충실도 b/c 미고정). 웹 차단 없었음 — 유일 실패 = PDF 크기 제한, HTML/secondary로 우회.

**핵심 소스**: arxiv 2408.08054(Text2BIM, P) · github.com/hypar-io/Elements(P) · arxiv 2503.11498(Cloud2BIM, P) · arxiv 2407.15723(DStruct2Design+Architext 비교, P) · openaccess.thecvf.com HouseDiffusion CVPR 2023(P) · adsknews.autodesk.com Building Layout Explorer(P). Vendor/S: Snaptrude 블로그(2026-03) · AEC Mag(Finch·TestFit) · Architosh(TestFit 2024-07).

---

### 한 문장 요지
> 제너레이티브 AEC를 3종으로 가른다: **A 무에서 생성**(불변 clean이나 off-identity 저작 → REJECT-core/CONSIDER-light-seed) · **B ingest 변환·clean-up**(messy import→파라메트릭 ops, §8 PR primitive = **정체성 핵심 ADOPT**, 단 신뢰도 게이트 하) · **C 메시-bake**(hunyuan3d/hyper3d/House-GAN = **HARD REJECT 불변 ① 위반**). **§6 #1 답 = 제너레이티브가 unlock하는 건 "무에서 짓기"가 아니라 "들어온 것을 ops로 들어올리기"**(import clean-up·brep 리프팅). 업계 확증: 진지한 생성AEC는 전부 파라미터/ops/코드 방출 → **불변 ①은 제약 아니라 업계-정렬**(H6 medium→high 승격). 생성 파라메트릭은 첫패스 안 build됨(overlap 16-37%) → **결정적 critic-in-loop 필수**(= M12-B lint critic을 import 레인에 확장).
