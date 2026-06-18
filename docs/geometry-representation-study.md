# 3D 모델링 표현 방식 — 근본 연구 & Figcad 데이터구조 제안

> **상태: ✅ 완료 (자율 야간 작업, 2026-06-15) + §8 라운드트립 정밀화 · §9 운영 결론 추가 (세션 Q&A, 2026-06-17).** 3 딥리서치 패스(1a 패러다임·1b 커널·2 협업/Figcad-hard) + 코드 그라운딩 + F-rep 직접 fetch 검증. 중단조건 5개 충족. **§9 = "그래서 어떻게 바뀌나"**(F-rep 강등·AI-freeform=파라미터 편집·import clean-up·빌드 4개).

## 📋 깨서 먼저 읽기 — Executive Summary

**질문**: 모든 3D 표현(polygon/NURBS/parametric/implicit…)을 통합 수용하는 Figcad 데이터구조는? 새 방식 가능?

**답 (한 문단)**: Figcad 현 모델(§0 — 평면 typed 파라미터 레코드 + emergent 의존성 + pure-derive)은 이미 **"레시피 not 결과" 시스템이고 주류 CAD보다 깨끗하다**(주류는 recipe가 파생 brep을 참조하는 순환의존=persistent-naming, Figcad는 없음 — §3 P6, 검증됨). "새 데이터구조"의 정체 = 새 기하 커널이 아니라, **현 평면모델이 recipe-tree-CRDT의 degenerate 케이스임을 인식하고 3층 머지로 정식화**: ① 구조(피처/그룹/federation 참조) = **movable-tree CRDT**(Kleppmann, Isabelle/HOL 검증, Loro 출시) ② 파라미터 값 = **field-LWW**(이미 보유=불변②) ③ 시맨틱 유효성 = **post-merge lint 검증기**(=hub-benchmark §9 lint-in-loop critic과 합류). 참조는 stable-ID(persistent-naming 우회=Figcad 강점). 지오는 pure-derive 유지(§4).

**제안 2경로**:
- **경로 A(추천) — 불변① 유지**: 위 3층 머지 = 현 Figcad의 직접 일반화. coordination-free 자동머지 = 어떤 프로덕션 CAD(Onshape=서버권위·수동)도 못 한 강한 속성. 한계 = 파라메트릭 표현 가능한 것만, freeform은 Lane-2 passthrough+AI 리프팅.
- **경로 B — 불변① 진화(freeform 네이티브)**: 필요시. ~~OCCT 아니라 F-rep/SDF 레인 권장~~ → **§9.1서 F-rep 강등**(이기는 축 없음 — 도면 깸·**인터롭서 B-rep에 짐**[Rhino/Revit/CAD가 B-rep 커널]·off-identity). **건축 freeform 현실 답 = NURBS/SubD(라이노) Lane-2 passthrough + AI-편집은 파라메트릭 곡선 어휘로(§9.2).**

**첫 빌드(greenlight 시) = §6 1단계: 시맨틱-lint post-merge 검증기** — 작고 불변 깨끗, A/B 무관 필요, hub-benchmark §9와 절반 명세됨.

**기대치 솔직히**: 이 연구의 *근시일 빌드물*은 결국 **이미 백로그에 있던 lint 검증기(hub-benchmark §9)로 수렴**한다. 진짜 새 구조작업(movable-tree·3층 머지)은 **계층/federation이 1급 요구 될 때까지 연기**. 실망 아니라 정직한 yield = **검증된 장기 방향 + 기존 백로그 1건 확인 + 한 실험(0단계 포크)이 가르는 분기점**. 깊은 문서지만 "내일 지을 큰 새것"을 함의하지 않음.

**라운드트립 정밀화(§8, 이 세션 Q&A)**: "parametric"은 2종 — **의미 파라미터**(벽=중심선+두께, 툴 무관 → 각 툴이 자기 네이티브 재구성) vs **NURBS 수학**(control point+knot, *그 자체가 recipe*지만 출신 커널로만 무손실 왕복). **손실은 저장/운반이 아니라 "약한 커널서 편집→강한 표현 되올리기"**(SketchUp mesh 편집→Rhino NURBS 불가). 규칙 = **가진 것 중 최고수준 recipe 저장(의미 파라미터 > NURBS 수학 > raw mesh), 뷰·내보내기는 거기서 파생** = 불변①의 일반화.

**운영 결론(§9, 같은 세션)**: ① **F-rep 강등**(이기는 축 *없음* — 도면 깸·**인터롭서 B-rep에 짐**[지배 엔드포인트 Rhino/Revit/CAD가 B-rep 커널, F-rep은 거기로도 메시 강제]·off-identity → 먼 미래 각주, freeform 현실답=NURBS/SubD passthrough). ② **AI-freeform = B-rep 편집 아니라 *파라미터 편집***(곡선 중심선·스윕을 파라메트릭 어휘로 → AI "완만하게"=곡률 파라미터 ops). ③ **import = "올릴 수 있는 만큼 Lane-1, 나머지 Lane-2" + AI clean-up 패스**(충실도 보고, 조용한 근사 금지). **빌드 4개**: 머지 lint · Lane-2 원본 보관 · 파라메트릭 곡선 어휘 · AI clean-up.

**남은 진짜 리스크(연구 아니라 디자인 스파이크)**: ① coordination-free 파라메트릭 머지는 **미검증 가설**(Onshape가 서버권위 택한 이유 — §5 비판1) ② "수렴했으나 무효" 모델 해소 UX(차단 vs 플래그 vs 3-way — 비판2). **이 둘이 경로 A 핵심 미지수 → 작은 프로토타입 스파이크로 검증 권장.**

**투명성**: §1(이론/패러다임, Pass 1a)은 verify 단계 API 레이트리밋으로 *unverified-sourced*(1차 소스 추출됐으나 적대적 검증 미통과). 추천의 척추(§3·§4·§7 — movable-tree·Onshape·충돌분류기·F-rep 판정)는 **전부 검증된 소스**. 미탐색이었던 F-rep 대안은 직접 fetch로 메움(§7).

---


---

## 목표 (autonomous objective)

근거 기반으로 3D 모델링 표현 방식을 정립하고, **모든 3D 프로그램을 통합하는 Figcad 데이터구조를 제안.** 사용자 결정(이 세션): 제안은 **두 경로 둘 다 탐구·비교**:
- **경로 A — 불변① 유지본**: 더 나은 파라미터/레시피 스키마 + Lane-2 네이티브 passthrough 참조 레인. 현 아키텍처 진화, 4대 불변·CRDT·웹 유지.
- **경로 B — 불변① 진화본(하이브리드 커널)**: 일부 네이티브 지오(brep/메시)를 1급 시민으로 저장 허용. 근본 재설계, pure-derive/CRDT 머지 일부 포기 위험.

핵심 필터(모든 발견을 이걸로 해석): 4대 불변 ①지오 미저장·pure-derive ②변경 ops 경유=**CRDT 머지 가능** ③렌더루프 밖 명령형 HUD ④펜=도구/터치=카메라. 실시간 멀티플레이어(Yjs), 웹/mm-정수, 2레인 인터롭(파라메트릭 시맨틱 + 네이티브 passthrough).

## 중단 조건 (이 전부 충족 시 STOP + 최상단 요약 작성)
1. 표현 분류 + 실제 구현/저장/교환 + 협업/이론 그라운딩 완료.
2. 두 제안(A/B) 구체화 — 데이터구조 수준 디테일(스키마 shape·머지 의미·파생 경로·인터롭 참조).
3. 제안의 **선행연구 검증** 패스 완료(있는 아이디어인가/신규인가).
4. **적대적 자가비판** 완료(제안의 실패모드·불변 위반·robustness 구멍).
5. **구현 PLAN** 초안(코드 아님 — 어디 손대고 어떤 순서, 위험).

## 가드레일 (자율 중 절대)
- **코드 편집·커밋·push·배포 금지.** 문서만. 구현은 사용자 greenlight 후.
- 거짓 금지: deep-research=검증된 사실, 제안=내 합성(명확히 라벨). 미답은 미답으로 박제.
- 경로 A는 4대 불변 준수, 경로 B는 "가설적 — 불변 변경 필요"로 명시.
- Figcad 현 표현은 **코드 그라운딩**(schema.ts·geometry/·store·DeriveCache) 후 단언.

---

## 진행 로그
- **2026-06-15**: 3 딥리서치 패스 병렬 발사.
  - Pass 1a `wpri3eepk` — 표현 패러다임+자료구조+이론. ⚠️ **완료했으나 verify 단계 100% API 레이트리밋**("Server temporarily limiting requests, not your usage limit")으로 25 claim 전부 abstain→기본 kill. **진짜 반증 아님** — claim은 1차 소스서 추출된 양질, 검증만 못 돔. → 아래 §1에 **unverified-sourced 리드로 salvage**. 합성 때 1차 소스 직접 읽어 self-verify 예정. 필요시 throttle 해제 후 타깃 재검증.
  - Pass 1b `wveubiz94` — 커널+구현+저장/교환. ✅ **부분 성공**: 3 finding **confirmed(3-0)** + 2 **진짜 refutation**(trim 1:1·OCCT 9레벨=과장 기각) + 나머지 verify throttle abstain. §2에 salvage.
  - Pass 2 `wv6x4e36w` — Figcad-hard. ⏳ 대기.
- **레이트리밋 = systemic(3패스 다 맞음). 전략 전환**: 워크플로 더 쏘면 verify 또 죽어 낭비 → **합성 때 load-bearing claim은 직접 1차 소스 WebFetch로 self-verify**(읽기, 부담 적음). 워크플로 재발사는 throttle 명확히 풀린 뒤만.
  - Pass 2 `wv6x4e36w` — Figcad-hard. ✅ **거의 완전 검증**(21/25 confirm). 키스톤. §3.
- **완료 경로**: Pass 2 회수 ✅ → §0 코드 그라운딩 ✅ → §1~3 salvage ✅ → F-rep 직접 WebFetch self-verify ✅(throttle 완화) → §4 제안 ✅ → §5 비판 ✅ → §6 구현계획 ✅ → §7 F-rep 평가(비판#6 해소) ✅ → Executive Summary ✅. **중단조건 5개 충족 → STOP.**
- **미수행(의도적)**: 별도 Pass 3 선행연구 = Pass 2가 이미 heavy 검증 prior-art(Loro/Onshape/CadQuery/Lv&He/Bidarra) 제공 + F-rep 직접 fetch로 갭 메움 → 불필요. 1a 재검증 = throttle 리스크 대비 가치 낮음(척추는 1b·2·fetch로 검증됨, 1a는 supporting).
- **사용자 핸드오프**: 남은 건 디자인 스파이크(coordination-free 파라 머지 검증 + 무효수렴 UX) — 연구 아님. §6 0·1단계 참조.

---

## §0. Figcad 현재 표현 (코드 그라운딩) ✅

> 코드 직접 확인: `schema.ts`(v3)·`geometry/index.ts`(DeriveCache)·규칙 `core-geometry.md`·`ops-store.md`. 제안의 baseline = 이걸 정확히 핀.

**데이터 모델 = 14 kind discriminated union, 전부 *파라미터*만 (지오 0)**
- 각 Element = 평면 zod 객체 `{id, kind, levelId, typeId?, ...params}`, **mm 정수**(ops 경계 `quantize`). 지오메트리 필드 없음.
- **위치 프리미티브 4원형**(schema.ts `POSITIONAL` 단일소스): `segment {a,b}`(wall·beam·stair·railing·curtainwall·grid·dimension) · `polygon {boundary}`(slab·roof·zone) · `point {at}`(column·text·label) · `hosted`(opening — 호스트 벽 파생). + 스칼라 파라미터(thickness/height/section/offset/slope…).
- **Type/Instance 분리**(9 typed kind): ElemType가 공유 파라미터(thickness·section·color), 인스턴스가 배치+오버라이드. typeId 참조. = Revit 패밀리/Rhino·Revit 인스턴싱(§2 1b)과 동형. zone/text/label/dimension = type 없음.

**지오메트리 = 저장 안 함, 순수 파생**(`deriveX()`, DeriveCache 해시 메모)
- 출력 `DerivedGeometry {positions, normals, edges, anchors, labels}` = **클라 로컬 캐시, Y.Doc 절대 안 들어감**(규칙①).
- derive = `(element params + 해석된 의존성)`의 순수함수. **의존성은 외부서 해석돼 deriveKey에 폴드**: joins(벽 마이터=끝점 공유 이웃), hostedOpenings(벽 구멍), type, level, 바인딩 해석 좌표(치수·라벨 타깃 추종). `DeriveIndex` 변경당 1회 O(n) 구축(아니면 O(n²)).
- **deriveKey = 모든 입력을 포괄하는 합성 문자열**(의존 좌표 포함), 캐시는 문자열 동등성(`hit.key === key`) 비교로 메모이즈(해시 다이제스트 아님). 같은 파라미터=같은 메시(결정론).
- **지오 생성 프리미티브 = `extrudeProfile`**(Section rect/circle→N각형 테셀→압출), 기둥/보/계단/지붕/난간/멀리언 공유 단일 경로. 벽=중심선+두께 압출+마이터+개구부 구멍(earcut). **부울/CSG 커널 없음**("CSG 불필요" 설계원칙).

**변경 = DocStore ops만**(규칙②): Element=중첩 Y.Map, 필드단위 LWW, 삭제>편집, 단일 transact=undo 1스텝, 연쇄삭제(벽→개구부). yjs는 core·collab 안에만.

**의존성은 암시적 — derive 때 해석(저장 안 함)**: 벽 조인=끝점 좌표 일치(mm-exact `==`)로 계산, 개구부=hostId, 치수/라벨=targetId+anchor. **관계가 그래프로 저장되는 게 아니라 매번 파라미터 매칭으로 재파생.**

### Figcad-filter 해석 (이론 매핑 — 제안의 출발점)
1. **Figcad는 이미 "레시피 not 결과"/pure-derive 시스템** = FRep/CSG/파라메트릭 극(§1). 지오=파라미터의 평가물, 파라미터만 저장. ✅ 불변①.
2. **단 Figcad 레시피는 단일 함수트리(FRep Gob_Tree)가 아니라 평면 typed 파라미터 레코드 집합 + 암시적 의존성 해석층.** → **변분/선언적(order-independent→CRDT 가환, §1 Hoffmann)에 가깝지 절차적 피처-히스토리가 아님.** ✅ **이게 Figcad가 잘 머지되는 이유**(평면 LWW 레코드, 순서있는 히스토리 없음).
3. **persistent-naming 문제(§1 최대 난제)를 아직 안 맞음** — Figcad는 파생 brep의 *서브엔티티 선택*을 노출 안 함("이 파생된 edge 필렛" 없음). 참조는 **요소 전체(id) + 명명 앵커(a/b 끝점)**에 바인딩, 파생 face/edge엔 안 함. → 1a 하드문제 우회. **그러나 이게 한계이기도**: 파생 서브지오 참조 불가. Lane-2 네이티브 페이로드나 freeform에서 파생 face 선택 허용하면 persistent-naming이 문다.
4. **의존성=좌표 일치**(벽 마이터 mm-exact `==`)는 의도적 CRDT-친화 선택: 저장된 조인 엣지가 없으니 머지충돌 없음, 조인은 LWW 생존한 끝점들로 재파생. **관계가 저장이 아니라 emergent.** (대조: 조인 그래프 저장 시 CRDT 트리/그래프 머지문제 §1 Kleppmann 직격.)
## §1. 표현 분류 + Figcad-filter 적합성

> **상태: Pass 1a salvage (⚠️ unverified-sourced — verify 레이트리밋. 1차 소스서 추출됨, 합성 전 self-verify 필요).** 아래는 검증 대기 리드. 대부분 1차 소스(논문 PDF) 기반이라 신뢰도 높으나 적대적 검증 미통과 표시 유지.

**A. 함수 표현 (F-rep / 음함수 / SDF) — ★ Figcad 코어 1순위 후보**
- **FRep (Pasko)**: 기하 = `f(x₁..xₙ) ≥ 0` 만족 점집합, f는 *평가됨*(저장 아님). 모델 = 정의함수(레시피)뿐. → **불변① 그 자체.** [Pasko FRep PDF, primary]
- **내부 표현 = 재귀 k-ary 구성트리(Gob_Tree)** = 프리미티브(잎=블랙박스 함수) + 연산(내부노드), **실파라미터는 별도 Geometric store 맵**. = 컴팩트 구조 DAG+파라미터 → **직렬화·머지 가능(불변②)**, 평가된 메시와 분리.
- **연산 닫힘(closure)**: 모든 단/이/k항 연산이 정의함수→정의함수. 부울 = R-함수(∩=min, ∪=max). **균일 노드 대수 = op-log/CRDT가 필요로 하는 성질.** [Pasko, primary]
- 음함수 = **해상도 독립**(무한 해상도, 메모리 해상도 비례 안 함). 단 grid 재이산화(level-set/FMM)는 원 zero-set 안 보존. [arxiv 1812.03828, 2104.08057, primary]
- "**효율+메모리+임의위상 동시 만족하는 정준 3D 표현 없음**" — 음함수/함수공간 동기. [occupancy net, arxiv 1812.03828]

**B. CSG / 절차 — pure-derive 축**
- **CSG vs B-rep = store-vs-derive 양극**(Hoffmann): CSG=암시적/절차적 컴팩트 대수식(연산=정규화 집합연산), B-rep=경계를 명시 저장한 위상 자료구조. **= 불변① 설계선택 그대로 — CSG류=pure-derive 후보, B-rep=hybrid/store 대안.** [Hoffmann PDF, primary]

**C. B-rep / 메시 — store 축 (경로 B 하이브리드 관련)**
- B-rep = 연속 파라메트릭 곡면/곡선(기하) + 이산 위상(연결성) 2층 분리. 위상은 oriented coedge(half-edge 유사)/face-adjacency 그래프. [arxiv 2104.00706, 2006.10211]
- **위상 유효성 = Euler-Poincaré `V−E+F=H+2(S−G)`**, Euler 연산자가 이 불변 보존. → store 한다면 CRDT/ops가 지켜야 할 검증 규칙. [GWB Euler operators, primary]

**D. 파라메트릭 핵심 난제 — persistent-naming (★ 경로 A의 최대 적)**
- **persistent-naming 문제**: 파라미터 바뀌면 base로 되돌려 전체 재평가 → 선택된 엔티티(예: 라운딩할 edge)를 *원 자료구조와 독립적으로* 기술하고 새 인스턴스에 재해석해야. **불변①(매 편집 재파생)의 직접 비용, CRDT 머지서 가중**(동시편집의 명명 엔티티 재해석). [Hoffmann · JCDE 3(2):161 · sciencedirect S1110016818300814, primary]
- 위상 split/merge 시 둘+ 엔티티가 같은 이름 → **순수 위상 ID로 해소 불가 모호성.** [JCDE, primary]
- persistent-ID 3계열(위상기반/기하기반/혼합). 리뷰 결론: **단일 접근 불충분 → 위상+기하 혼합 권고.** → 경로 B(일부 기하 앵커 저장) 논거. [sciencedirect, primary]
- **변분(constraint, 순서무관) vs 파라메트릭(절차, 순서의존)**: 순서무관 = **CRDT 가환성에 직결** → 변분/서술 스타일이 피처-히스토리보다 Figcad 머지에 적합. [Hoffmann, primary]

**E. 협업 자료구조 — 핵심 제약**
- **CRDT tree-move 문제(Kleppmann)**: 트리 move를 delete+recreate/naive LWW로 못 함 — 동시 move가 서브트리 복제 / 두 안전한 move가 합쳐져 사이클·분리. **트리구조(=레시피 DAG) 협업 모델의 핵심 장애.** [Kleppmann 2021, primary]
- **CRDT 기반 실시간 협업 CAD 동기화** 선행연구 존재 — 합성 전 정독 필수. [researchgate 327993774, primary] + TVCG 2010 협업 + 최근 arxiv 2508.01633.
- macro-parametric 교환 = 레시피(생성+수정 히스토리) 교환, 명시 모델은 on-demand 생성(STEP류). [JCDE, primary]

**핵심 소스(1a)**: Pasko FRep(primary)·Hoffmann "How Solid is Solid Modeling"(primary)·GWB Euler operators(primary)·arxiv 1812.03828(occupancy)·2104.08057(SDF)·2104.00706·2006.10211(B-rep ML)·JCDE 3(2):161 & sciencedirect S1110016818300814(persistent-naming)·Kleppmann CRDT tree-move·researchgate 327993774(CRDT 협업 CAD)·TVCG 2010.240·arxiv 2508.01633.

> **합성 시 self-verify 우선순위**(제안의 load-bearing): ① FRep closure/머지가능성(Pasko 정독) ② 변분=순서무관=CRDT가환(Hoffmann) ③ persistent-naming + 혼합 ID 권고(JCDE/sciencedirect) ④ CRDT tree-move 제약(Kleppmann) ⑤ CRDT 협업 CAD 선행연구(researchgate).
## §2. 커널·프로그램 구현·저장·교환

> **상태: Pass 1b salvage.** ✅ = 3-0 적대적 검증 통과(신뢰 높음). ⚠️ = verify throttle abstain(unverified-sourced). 🚫 = 진짜 refutation(import 금지).

**✅ 확정 (3-0 검증) — 커널 내부 = 위상/기하 분리 + indirection + 구조적 공유**
- **OpenNURBS Brep** = 명시적 타입 계층(ON_Brep/Face/Loop/Trim/Edge), **기하는 indirection**(edge가 공유 곡선배열 `m_C3`의 인덱스 `m_c3i` 저장), per-entity tolerance `m_tolerance`. [developer.rhino3d.com brep-data-structure, primary]
- **OCCT** = 위상(TopoDS)/기하(Geom) 분리, `TopoDS_Shape`=공유 heavy `TopoDS_TShape` 위의 light handle, **copy-free 구조적 공유**. [dev.opencascade.org modeling-data, primary]
- **Rhino RhinoCommon = 멀티표현**(GeometryBase ⊃ Brep/Mesh/SubD/Curve/Surface/Point/PointCloud), 평면 압출은 경량 `Extrusion`. **→ Figcad wall(중심선+두께 압출) ≅ Rhino Extrusion (동형).** [RhinoCommon GeometryBase, primary]
- **Figcad 읽기**: 두 커널 다 indirection+구조공유 = **불변① 거울**(기하를 가리키는 참조). **instance = 공유 정체성 + transform → CRDT 머지에 매핑.** 경로 B(하이브리드) 채택 시 per-entity tolerance 유지 + singular trim 가드.

**🚫 진짜 refutation (import 금지 — 과장 기각)**
- trim→edge **1:1 아님**(singular trim은 nullptr 반환, 0-3).
- OCCT가 **9레벨 하향전용 DAG 아님**(0-3 기각). 구조공유는 맞으나 "9레벨 단방향" 단정 과함.

**⚠️ unverified-sourced 리드 (throttle abstain — 합성 때 self-verify)**
- **Revit: 파라메트릭 기술 = source of truth, brep는 *파생***(faces/edges 조회용) — **불변① 평행.** 단 납품BIM은 brep 영속 가능성(검증 필요). [jeremytammik tbc, Revit API geometry docs]
- **Revit GeometryInstance** = 패밀리 기하 1벌 + transform(인스턴싱), `GetInstanceGeometry`(변환본) vs `GetSymbolGeometry`(패밀리 좌표). → typeId/인스턴스 패턴과 동형.
- **SubD(.3dm)**: **control net 영속, limit surface는 read 때 파생**(= store-params/derive-geometry, Figcad 정렬). 단 limit-surface 평가기는 **독점**(무료 openNURBS에 없음) → SubD import 한계.
- **Onshape**: 파일 패러다임을 **서버 피처리스트**로 대체, 동시 다중유저 편집(머지 방식 미검증).

**❓ 여전히 미커버 (Pass 1b 미답 → 합성 때 직접 fetch 또는 Pass 2/3)**
- **STEP/IFC/USD/glTF 교환손실 메커니즘**(2레인 인터롭 핵심) — 미답.
- Parasolid/ACIS/CGAL 내부 + robustness. **CGAL exact-predicates vs Figcad mm-정수 양자화** 대비.
- Onshape 동시편집 머지 vs Figcad CRDT-ops(불변②) 상세.

**핵심 소스(1b)**: developer.rhino3d.com(OpenNURBS brep·RhinoCommon·SubD guide)·dev.opencascade.org(OCCT modeling data)·Revit API geometry docs·jeremytammik tbc. 전부 1차.
## §3. 협업 가능 표현 + 파라메트릭/절차 이론 (Pass 2 — 키스톤) ✅

> **상태: Pass 2 = 거의 완전 검증**(21/25 confirm, fetch 4건만 throttle). 신뢰 높음. 이 패스가 제안의 척추.

**P1. Path A(불변① 유지) = 레시피/피처/구조 계층을 *movable-tree CRDT*로 머지** (지오 머지 아님)
- Kleppmann movable-tree CRDT(IEEE TPDS 2021, **Isabelle/HOL 기계검증**, Loro 출시): move=노드 parent 포인터 설정 `Move(t,parent,meta,child)`. 동시 같은노드 move=**Lamport 타임스탬프 LWW**(최대 opID 승, 나머지 무효). 임의 순서 도착 수렴=**undo-do-redo 리플레이**(타임스탬프 순, 서버·합의 불필요). 사이클 방지=새 parent의 조상인 move는 **무시하되 로그**. delete=trash로 move. [move-op.pdf·arxiv 2311.14007·Loro, primary, 3-0]
- **Figcad 매핑**: §0의 평면 element 집합 = 1레벨 degenerate 트리. 이걸 중첩 레시피 트리로 일반화하면 movable-tree CRDT가 구조 수렴 보장.

**P2. move는 delete+reinsert로 구현 불가** — 동시 delete+reinsert=중복, 상호 move=사이클. Automerge는 아직(2026) delete+reinsert=중복. **first-class move op 필수, 유효성은 RE-DERIVE**(visible↔invisible, ascending-ID 순). → **Figcad op-log 교훈: 재배치를 delete+create 아니라 move op으로.** [3-0]

**P3. Onshape가 불변①(pure-derive)을 산업스케일 검증** — **정의(Part Studio 피처리스트)만 DB 저장**, brep·삼각형은 캐시(항상 재생성 가능). 동시편집=**불변 microversion 델타 트리**(레시피 델타 op-log, CRDT 아님·지오 머지 아님), 피처는 stable 내부 ID라 rebasable. [onshape blog, primary, 3-0] ⚠️ **단 서버권위·수동 충돌해결 — 자동수렴 아님.** "피처 레이어가 올바른 머지 granularity"는 증명하나 "레시피 머지가 자동 수렴"은 증명 안 함.

**P4. generic CRDT는 필요하나 불충분 — 도메인 충돌분류기 필요** — Onshape는 피처수준서 기하충돌 검출, 충돌 피처는 미변경(수동). Lv&He 2018(CRDT-for-CAD): 동시 피처 op를 **3관계 분류 — 의존충돌/배타/호환**, CRDT 위 피처기반 검출+해결층. **generic list/tree CRDT(Yjs/Loro)는 구조충돌만 자동, 시맨틱 충돌 불가.** [sciencedirect S147403461730486X·US Patent 10691844, 3-0/2-1]

**P5. Path B(진화) = CadQuery 모델** — 평문 절차 레시피 on OCCT B-rep 커널(OCP), **스크립트가 모델 포맷**, 지오는 평가로 full B-rep/NURBS 파생, STEP/3MF 인터롭. **참조=query-selector(런타임 `>Z`/`|Z`/무게중심), 저장 ID 아님** — 위상변화·동시편집에 resilient하나 위상 시프트엔 fragile + 계산가능 기하 의존. [cadquery docs, primary, 3-0]

**P6. "recipe vs evaluated"는 정준** — 주류 파라메트릭 CAD = 이중표현(파라메트릭 정의 + boundary-evaluator 재생성 brep), GCS 기반(Sketchpad 1960s, 본격 1980s Pro/E). ⚠️ **결정적 단서**: 주류 history-based CAD는 recipe가 *파생* brep 엔티티 참조 = **순환의존(persistent-naming)** → 불변① 깨끗이 못 만족. **Figcad의 독립파라미터 pure-derive는 주류 CAD보다 깨끗·강함.** [Bidarra CAD&A 2005, arxiv 2202.13795, 3-0]

### ⚠️ Pass 2 핵심 caveat (synthesis 필수 반영)
- **Onshape/주류 = 서버권위, CRDT 아님, 수동 충돌해결.** 피처 레이어가 올바른 granularity임은 증명, 자동수렴은 미증명. **Figcad Yjs 자동머지 야망 = 어떤 프로덕션보다 강한 속성.** movable-tree CRDT만 coordination-free 수렴 증명 — 그것도 **구조만 수렴, per-node param 값 충돌은 companion map CRDT(field-LWW) 필요 = Figcad 불변② 이미 보유.**
- **성능**: movable-tree CRDT 비용 비자명 — 피크 remote op당 ~200 undo/redo, 처리량 600~5700 op/s(vs leader-ordered 14k~22k), full op-log 보유 필요(causal-stability 절단 완화). **iPad Safari/웹 인터랙티브 스케일서 수용가능한지 = 미해결**(→ 하이브리드 강제 가능성).
- **refuted(0-3)**: "병합된 구속집합은 solve 전 over/under-constrained 검출·수리 필수" = **기각**. 병합 구속에 pre-solve 수리게이트 가정 금지.

### 미연구 갭 (Pass 2가 명시)
- **F-rep/음함수(Pasko/HyperFun) + USD 컴포지션/레이어링이 피처트리보다 더 머지친화적인가** = 생존 claim 0(스코프엔 있었으나 미답). 1a salvage(§1 A)에 FRep closure/Gob_Tree 리드 있으나 unverified. **= 유일한 열린 연구 가지**(§6서 처리).

**핵심 소스(2)**: Kleppmann move-op.pdf·arxiv 2311.14007(PaPoC'24)·Loro·Onshape eng blog·sciencedirect S147403461730486X(Lv&He CRDT-CAD)·US Patent 10691844·Bidarra CAD&A 2005·arxiv 2202.13795(GCS)·CadQuery docs·OpenUSD. 대부분 1차·검증.
## §4. 제안 — 경로 A(불변① 유지) / 경로 B(진화) + 트레이드오프 ✅

> 합성(내 작업, 검증된 Pass 2 findings + §0 코드 기반). **핵심 발견: Figcad 현 평면 element 모델(§0)은 recipe-tree-CRDT의 degenerate(1레벨) 케이스.** 원리적 일반화 = 아래 3층.

### 통합 모델 — "3층 머지 over typed 파라메트릭 피처트리"
어떤 모델링 표현이 *동시협업 + pure-derive + 인터롭*에 맞나? 검증된 답:

| 층 | 무엇 | 머지 메커니즘 | Figcad 현 상태 |
|---|---|---|---|
| **구조** | 피처/요소 계층(부모-자식·그룹·assembly·Lane-2 federation 참조) | **movable-tree CRDT**(P1, Kleppmann/Loro) — first-class move op(P2) | 평면(1레벨), move=delete+create. **갭: 중첩+move op** |
| **파라미터 값** | 노드별 스칼라(중심선·두께·height·section…) | **field-LWW map CRDT** | ✅ **이미 보유**(Y.Map 요소, 불변②) |
| **시맨틱 유효성** | 병합 결과가 도메인 규칙 위반?(겹침·미접합·고아·호스트초과·구속 모순) | **post-merge 검증기**(P4 충돌분류기 = **lint**) — 차단 아니라 플래그(coordination-free 유지) | ✅ lint 8종 보유. **갭: 머지 후 자동 구동 = hub-benchmark §9 lint-in-loop critic과 동일** |

**참조**: stable element ID + 명명 앵커(a/b) 유지 = **persistent-naming 우회**(§0·F6, Figcad 고유 강점). 서브엔티티 참조 필요시 **query-selector**(P5 CadQuery, 파생 때 계산, 저장 ID 아님).
**지오메트리**: pure-derive(extrudeProfile + per-kind derive) 불변. ✅

---

### 경로 A — 불변① 유지 (recipe-tree CRDT, Figcad의 직접 일반화) ⭐ 추천
**무엇**: 현 모델 + (1) 선택적 계층(그룹/assembly/federation 참조)을 movable-tree CRDT로 (2) first-class move op (3) **시맨틱 충돌층 = lint를 post-merge 검증기로 정식화**(hub-benchmark §9와 합류).
- **불변① 완전 유지**: 지오 미저장, 파라미터서 pure-derive.
- **검증된 근거**: movable-tree CRDT(P1, Isabelle/HOL)·Onshape가 피처레이어 granularity 검증(P3)·field-LWW는 이미 보유·lint=충돌분류기(P4).
- **Figcad 고유 우위**: 독립파라미터 pure-derive = **주류 CAD보다 깨끗**(P6 — 주류는 recipe가 파생 brep 참조하는 순환의존, Figcad는 없음).
- **⚠️ 헤드라인 이점은 *조건부***: "coordination-free 자동머지 = 어떤 프로덕션 CAD(Onshape=서버권위·수동)도 못 한 강한 속성" — **이게 매력이자 동시에 §5 #1의 미검증 키스톤이다(같은 사실 양면).** Onshape가 *바로 이걸 못 해서* 서버권위를 택했다. → **이 이점은 §6 0단계 스파이크가 "coordination-free 레시피 머지가 실제로 생존"을 보이는 조건에서만 성립.** 스파이크 실패 시 = 경로 A가 아니라 **Onshape식 서버권위+수동해결로 후퇴**(다른 아키텍처). 즉 현 추천은 "올바른 *방향* + 한 실험이 가부 결정".
- **한계**: 파라메트릭 표현 가능한 것만(14 kind + 확장). **freeform NURBS/메시 서브지오 네이티브 편집 불가** → Lane-2 immutable passthrough(메시 표시)로, AI 시맨틱리프팅(hub-benchmark G1, v1.5)으로 Lane-1 승격.

### 경로 B — 불변① 진화 (하이브리드 커널, CadQuery 모델)
**무엇**: 실제 B-rep 커널(OCCT/WASM, CadQuery OCP식) 추가 → freeform 네이티브 저작. 레시피는 여전히 CRDT 머지, 단 일부 네이티브 B-rep 저장(Lane-2가 1급·편집가능) → **불변① 완화**.
- **이득**: 네이티브 freeform 저작 + Rhino/CAD와 더 단단한 왕복(파라 근사 아니라 실 B-rep 보유).
- **비용(큼)**: (a) **WASM 커널 무게 + wasm32 4GB 천장**(hub-benchmark F8 — OCCT 브라우저서 같은 벽) (b) **persistent-naming fragility**(P6 순환의존 — 경로 A가 우회하는 하드문제를 떠안음, query-selector는 위상변화에 fragile P5) (c) robustness(부울 실패) (d) **"주류보다 깨끗"한 순수성 상실** — 주류 CAD화 (e) 무거운 머지(기하/위상 시맨틱 충돌).

### 트레이드오프 판정
| | 경로 A | 경로 B |
|---|---|---|
| 불변① | 완전 유지 | 완화(일부 지오 저장) |
| freeform 네이티브 | ❌(Lane-2 passthrough) | ✅ |
| CRDT 순수성 | coordination-free(주류 초월) | 부분 상실 |
| persistent-naming | 우회(강점) | 떠안음 |
| wasm32 천장 | 무관 | 직격 |
| 빌드 규모 | 직접 일반화(중) | 근본 재설계(XL) |
| 정체성 적합 | ✅ 조율허브(저작은 전문툴) | ❌ Rhino 대체 지향 |

**추천 = 경로 A.** 근거: (1) 검증된 선행연구의 직접 일반화 (2) 4대 불변·웹·iPad·**허브 정체성**(Figcad는 freeform 저작툴 아님 — 정밀모델링은 Rhino) 부합 (3) Path B의 freeform 이득은 **off-identity**(Rhino 대체 아님)이고 비용(wasm32·persistent-naming·순수성 상실)은 심각. freeform = Lane-2 passthrough 유지 + AI 리프팅(v1.5)으로 승격.

**"새 데이터구조"의 정체**: 새 기하 커널이 아니라 — **Figcad 평면모델이 recipe-tree-CRDT의 degenerate 케이스임을 인식하고, 3층 머지(movable-tree 구조 + field-LWW 파라미터 + 시맨틱-lint 검증기)를 typed 파라메트릭 피처트리 위에 정식화, stable-ID/query-selector 참조로 pure-derive, freeform은 immutable Lane-2 참조로 두고 AI로 승격.** **novelty = 조합**: coordination-free CRDT + 독립파라미터 pure-derive + 시맨틱-lint 검증기 + 2레인 native federation을 *동시에* 하는 프로덕션 시스템 없음(Onshape=서버권위, CadQuery=싱글유저, Loro=generic). Pass 2가 명시한 갭("파라메트릭 레시피의 coordination-free 자동머지를 한 프로덕션 시스템 없음")을 정확히 채움.
## §5. 적대적 자가비판 (경로 A 공격) ✅

> 추천(경로 A)을 깨려 시도. 발견된 약점, blocking vs 수용가능 표시.

1. **🔴 BLOCKING — "coordination-free 자동머지 + lint 플래그"는 검증된 적 없음(핵심 베팅).** Onshape는 *바로 그 이유로* 서버권위·수동해결 선택(P3) — 파라메트릭 레시피의 coordination-free 머지가 어려워서. 유일한 coordination-free 증명(movable-tree, P1)은 **generic 트리지 파라메트릭 시맨틱 아님**. → 경로 A 중심 가정(파라 레시피를 post-hoc lint만으로 coordination-free 머지)은 **어떤 소스도 검증 안 함 = 가설이지 검증된 설계 아님.** 가장 정직한 핵심 리스크.

2. **🔴 lint=충돌분류기 등치는 handwave.** lint은 *무효 결과*(겹침·고아) post-hoc 검출. Lv&He(P4)는 두 *op*가 호환/충돌인지 머지 *전/중* 추론. **post-merge lint은 "모델이 망가졌다"를 플래그할 뿐 나쁜 머지를 되돌리거나 해소 선택 못 함.** → 모든 복제본이 *무효 모델에 수렴*(수렴은 맞으나 틀림). Onshape는 충돌 피처 차단해 이걸 방지. Figcad "수렴 후 플래그" = 망가진 모델 보여주고 수동수리 = 차단보다 나쁠 수 있음. **해소 UX 미해결.**

3. **🟡 movable-tree CRDT 성능을 Figcad가 *수입*함.** 현 평면모델은 트리-move 비용 0. 계층 추가 시 remote op당 ~200 undo/redo(P2 caveat)를 iPad Safari서 떠안음. **질문: Figcad가 계층이 필요한가?** 평면모델 잘 돎. movable-tree는 가장 많이 인용된 검증 finding이나 **Figcad에 아직 없는 문제의 해법일 수 있음** — over-engineering 경계. 계층(assembly/federation 참조)이 1급 요구 될 때만.

4. **🟡 "주류보다 깨끗"은 조건부.** Figcad가 persistent-naming 우회하는 건 *서브엔티티 선택 미노출* 덕분뿐. (a)freeform (b)파생 edge 필렛 (c)Lane-2 서브엔티티 참조 — 하나라도 필요해지면 persistent-naming 직격. **순수성 = LOD 100-250 거침 유지 조건부 = 영구 천장**(정밀모델링으로 성장 불가). 정체성과 일치하나 "한계"가 아니라 hard ceiling.

5. **🟡 query-selector 서브참조도 fragile.** P5(CadQuery #565/#371): 비평면 face서 "예상외 결과", 위상변화에 brittle. 경로 A의 서브참조 탈출구도 약함.

6. **🔴 F-rep 대안 미평가(Pass 2 갭) — 추천을 바꿀 수 있음.** 피처트리로 갔으나 §1 salvage의 FRep(closure·Gob_Tree·R-함수)는 **더 자연히 머지가능한 레시피일 수 있음** — 순수 함수트리라 위상/ID 없음 = **persistent-naming이 *원천적으로* 없음**(비판 4 무력화). HyperFun이 "**협업** multidimensional F-rep"이란 점도 직접 시사. **F-rep을 코어로 공정 평가 안 함 = 진짜 미탐색 가지.** → §6서 처리, 추천은 그때까지 잠정.

7. **🟡 Lane-2 federation 통합 미명세.** 외부 네이티브가 트리 노드면 배치는 movable-tree가, 내용(payload)은 immutable blob — 단 외부서 갱신(새 Rhino push)되는 federated 모델 diff/버전은 object-granular 버전관리(hub-benchmark F3) 필요 — recipe-tree가 처리 안 함. 접점 미정.

**종합**: 경로 A는 *방향*은 옳고 불변 깨끗하나, **핵심 베팅(coordination-free 파라 머지)이 미검증**(1)이고 **F-rep 대안이 미평가**(6)라 **추천은 잠정**. 1·2는 "수렴≠유효" 문제로 진짜 — 해소 UX 설계 필요(차단 vs 플래그 vs 3-way). 3은 "계층 정말 필요한가"로 스코프 축소 가능.
## §6. 구현 PLAN (코드 아님 — 사용자 greenlight 후 빌드) ✅

> 경로 A 기준, 위험 낮은 순. **F-rep 평가(§7)와 비판 1·2 해소 후 확정.**

**0단계 (선행 — 아키텍처 *포크* 결정, 빌드 전)**: F-rep 평가는 §7서 완료(코어=피처트리 유지). 남은 결정 = **coordination-free 레시피 머지가 생존하나, 아니면 Onshape식 서버권위+수동해결로 후퇴해야 하나** — 이건 검증이 아니라 **갈림길**. 작은 스파이크: N명 동시 파라/구조 편집을 Yjs 머지 → "유효-합의지만-무효-모델"(겹침·호스트초과·구속모순) 수렴이 *얼마나 자주* 나나 측정. **드물면 → 경로 A(머지+lint 플래그). 잦으면 → 서버권위+수동(=Onshape, 다른 아키텍처) 후퇴.** 이 스파이크가 §4 헤드라인 이점의 가부를 가름.

**1단계 — 시맨틱-lint post-merge 검증기 (최고가치·최저위험, A/B 무관 필요)**
- = hub-benchmark §9 lint-in-loop critic을 *협업 머지*로 확장. 머지/transact 후 `lint(store)` 구동 → findings를 **차단 아니라 플래그**(coordination-free 유지). P4 충돌층의 Figcad식 답.
- 닿는 파일: `store.ts`(transact 후 훅)·`lint.ts`(재사용)·`collab`(remote 머지 트리거)·web `LintPanel`(머지 충돌 표시). **전부 불변 깨끗**(lint=읽기전용 순수).
- ⚠️ 비판 #2 미해결분: "수렴했으나 무효" 모델의 **해소 UX**(플래그만? 3-way? 소프트락 강화?) 별도 설계.

**2단계 — first-class move op (계층 추가 *시에만*)**
- 비판 #3: 평면모델은 move op 불필요. **그룹/assembly/Lane-2 federation 참조가 1급 요구 될 때만.** 그때 movable-tree CRDT(Loro 알고리즘/Yjs 호환), **delete+reinsert 금지**(P2 함정). iPad 성능 게이트(P2 ~200 undo/redo) 선테스트.

**3단계 — Lane-2 federation 참조** (hub-benchmark F6과 합류)
- 외부 네이티브 모델 = immutable 참조 노드(메시 표시), object-granular 버전 diff(F3)로 갱신 추적. 비판 #7 접점 명세.

**비채택**: 경로 B(하이브리드 커널) = freeform 저작이 hard 요구 되기 전엔 보류(정체성 위배 + wasm32·persistent-naming·순수성 비용). freeform = Lane-2 passthrough + AI 리프팅(v1.5 G1).

**요약**: 실제 첫 빌드 = **1단계(시맨틱-lint 머지 검증기)** — 작고, 불변 깨끗, A/B 무관 필요, hub-benchmark §9와 이미 절반 명세. 2·3단계는 계층/federation 요구 따라. **단 §7(F-rep 평가) + 비판 1·2 해소가 추천 확정의 전제.**
## §7. F-rep 코어 대안 공정 평가 (비판 #6 해소) ✅

> 1차 소스 직접 WebFetch 검증(Pasko frep.pdf + Wikipedia FRep). 비판 #6의 "F-rep이 더 머지친화 코어일 수 있다"를 공정 평가.

**F-rep이 Figcad 불변에 *우아하게* 맞는 점 (검증됨)**:
- 기하 = `f(x)≥0` **런타임 평가, 미저장** → 불변① 자연. [Pasko·Wiki, fetched]
- 레시피 = **구성트리(잎=프리미티브, 노드=연산), 파라미터 별도 store** → 구조 데이터, movable-tree CRDT 적용가능. [fetched]
- **closure**: 모든 연산이 정의함수→정의함수 → **균일 노드 대수**(CRDT 노드 타입 깨끗). 부울=R-함수(min/max). [fetched]
- **순수 함수형, 위상·명시 ID 없음** → **persistent-naming 문제가 *원천적으로* 없음**(비판 #4 무력화). [fetched]
- HyperFun = "**협업** multidimensional F-rep" — 협업 F-rep 선례 존재.

**그러나 Figcad 코어엔 부적합 (검증된 결정타)**:
- **sharp prismatic 기하에 부적합**: "F-rep handles prismatic (sharp) geometry less elegantly — sharp edges require explicit R-function design and can introduce numerical artifacts near discontinuities." [Pasko, verbatim] **건축 BIM은 대부분 직각·각진 형상(벽·슬라브·기둥)** — 음함수로 표현 어색.
- **정확 평면 경계/엣지 추출 미지원**: 등위면→마칭큐브 메시뿐, **정확한 평면 face/edge 추출 안 됨**. → **Figcad 코어 산출물(deriveDrawing: 절단/투영/HLR/해치 평면도 + 치수 + mm-exact 스냅·마이터)에 치명적.** F-rep은 정밀 2D 도면·치수에 부적합.
- 인터롭: IFC/Revit/CAD = B-rep/파라메트릭 시맨틱, 음함수 아님 → F-rep→IFC 벽 = 손실 변환(brep→param 문제 재현).
- BIM 시맨틱: 벽은 형상만이 아니라 타입·재료층·호스트·IFC 매핑 = F-rep은 기하전용이라 **파라메트릭 시맨틱층이 여전히 위에 필요.**

**판정**: F-rep은 persistent-naming을 우아하게 없애고 머지·pure-derive·협업에 좋으나, **Figcad 코어(정밀 직각 BIM + 정확 도면/치수 + B-rep 인터롭)엔 틀린 도구.** 건축 BIM은 prismatic+시맨틱이지 implicit+organic이 아님.
- **→ 경로 A 코어 추천 불변**(피처트리 + extrudeProfile 유지). F-rep이 피처트리를 *대체 안 함*.
- **→ 단 경로 B(진화/freeform) 재구성**: freeform이 필요해지면 **OCCT B-rep 커널보다 F-rep/SDF가 더 나은 진화** — 무거운 B-rep 커널 없음, 머지가능 트리, **persistent-naming 없음**. ⚠️ 단 "더 가볍다"는 절반만 — **그리드 평가+마칭큐브 메싱은 해상도 따라 자체 WASM 메모리 비용 있음**(공짜 아님, B-rep 커널 무게는 회피하나 메싱 메모리는 남음). 비용 = 정밀 엣지추출 불가(but freeform은 벽 같은 정밀 정사영 도면 불필요). **freeform 레인의 권장 표현 = F-rep/SDF(OCCT 아님).**

**추천 확정**(잠정 해제): **경로 A 코어(피처트리 3층 머지) + freeform 필요시 F-rep/SDF 레인(경로 B 대체)**. 남은 진짜 리스크 = 비판 #1·#2(coordination-free 파라 머지의 미검증 + 무효수렴 해소 UX) = **연구 아니라 디자인 스파이크**(§6 0·1단계).
> ⚠️ **§9.1 추가 강등**: F-rep은 인터롭서 *B-rep에게 짐*(지배 엔드포인트 Rhino/Revit/CAD가 B-rep 커널 → F-rep은 거기로도 메시 강제, "메시와 비김"이 아니라 B-rep에 짐)이라 *freeform 레인으로도 먼 미래 각주*. 건축 freeform 현실 답 = NURBS/SubD passthrough + AI-편집은 파라메트릭 곡선 어휘(§9.2).

## §8. 라운드트립 정밀화 — "parametric 2종 + 손실 위치 + 저장 규칙" (세션 Q&A, 2026-06-17) ✅

> §4 Lane-1/Lane-2를 사용자 문답으로 더 날카롭게. "Rhino→Figcad→Rhino가 네이티브로 돌아오나, 모든 모델링 프로그램을 네이티브로 받나"의 정밀 답. §2 line 141 자기식별 갭(STEP/IFC/USD/glTF 교환손실 메커니즘 — 미답)을 닫음.

**1. "parametric"은 두 뜻 — 반드시 분리** (§3 P6 recipe-vs-evaluated가 한 축으로 뭉뚱그린 것):
- **(a) 의미 파라미터(semantic)**: 벽=중심선+두께+높이. **툴 무관**, 작음. 모든 BIM 툴이 "벽"의 *뜻*을 알아 → 같은 파라미터에서 **자기 네이티브 객체를 재구성**(파라 벽→네이티브 Revit 벽·ArchiCAD 벽·IFC 벽). = Figcad 14 kind = **Lane-1**.
- **(b) 기하 recipe(geometric)**: NURBS 수학(control point + knot + weight + trim 곡선)도 *그 자체가 recipe*다 — 베이크된 메시가 아니라 생성식. 단 **출신 커널(Rhino/OpenNURBS)로만 무손실 왕복**. `.3dm` 파일이 정확히 이걸 직렬화. = **Lane-2 네이티브 페이로드**.
  - ⚠️ **불변① 관계 정밀**: 이 무손실 왕복은 **원본 NURBS 페이로드를 실제로 저장·동기화**해야 성립. 이는 불변①의 *파생 네이티브 요소*가 **아니라**, **불투명 네이티브 페이로드 = 별도 표현**으로 다뤄 우회한다(`federation-design.md` 프레이밍: 외부 모델은 읽기전용 *별도 표현*, Figcad 파생 요소 아님 → 불변① 텍스트 무위반). **현 경로 A(§4)는 Lane-2를 immutable passthrough 메시 *표시*로만** 두므로, 출신툴 무손실 왕복은 **Lane-2를 "저장 참조"로 확장하는 설계 작업**이지 오늘 바로 되는 게 아님(§4 경로 A 너머).

**2. 손실 위치 — 저장/운반이 아니라 "약한 커널서 편집→강한 표현 되올리기"**:
- NURBS 면도, 의미 파라미터 집합도 **무손실 전송**된다. 저장·운반 자체는 손실 없음.
- 진짜 손실 = **약한 커널 툴에서 편집한 뒤 강한 표현으로 되올리기.** 예: SketchUp에서 mesh 정점을 옮김 → 그 mesh 편집을 Rhino NURBS control point로 *되돌릴 수 없음*. 이건 **커널 비대칭**(F5 손실 비대칭=업계 표준)이지 Figcad 갭이 아님 — **누구도 못 고침**. AI 시맨틱 리프팅(hub-benchmark G1, v1.5)이 *근사*로만 메움.
- ∴ 세 케이스 정확히 갈림:
  - **Rhino→Figcad→Rhino 네이티브** = ✅ *단 Lane-2 네이티브 페이로드 저장·동기화가 전제*(별도 표현 = §4 현 경로 A의 메시-passthrough를 넘어선 설계 확장, 오늘 X) → 출신 커널 재구성.
  - **벽·슬라브를 Revit/CAD/ArchiCAD 어디서나 네이티브** = ✅ (Lane-1 공유 파라미터 → **모델 1개 + 툴당 변환기 1개 = N개**, N² 쌍대응 아님).
  - **임의 NURBS → SketchUp 네이티브** = ❌ (SketchUp에 NURBS가 *없음* = 물리적 불가, 한계는 타겟 툴이지 허브 아님).

**3. 저장 규칙 (불변①의 일반화·결정)**:
> **가진 것 중 가장 높은 수준의 recipe를 저장한다** (의미 파라미터 > NURBS 수학 > raw mesh — raw mesh는 더 높은 recipe가 정말 없을 때만). **표시·내보내기는 항상 거기서 파생.** 출신 툴엔 네이티브, 약한 툴엔 tessellate한 mesh "뷰". **저장본 = 진실의 원천(source of truth), 약한 툴 통과로 절대 안 깎임**(약한 툴은 파생 mesh 뷰만 받고 원본은 그대로).

**결론**: "만능 단일 표현으로 모든 툴을 네이티브 수용"은 환상(커널 물리). 현실 최선 = **Lane-1 공유 파라미터로 의미요소 네이티브-everywhere + Lane-2 네이티브 recipe 보관으로 출신툴 무손실**. Figcad 현 모델이 이미 이 길 위에 있고, 빠진 것 = (협업) 머지 lint(§6 1단계) · **Lane-2를 "저장 참조"로 확장**(현재는 메시 표시만 — 출신툴 무손실 왕복하려면 원본 페이로드 저장·동기화, 별도 표현으로) · (v1.5) AI 리프팅으로 Lane-2→Lane-1 승격. (freeform F-rep 레인은 §9.1서 강등 — 운영 결론 전체 §9.) = §0~§7의 직접 귀결, 새 기하 커널 아님.

## §9. 운영 결론 — Figcad가 실제로 어떻게 바뀌나 (세션 Q&A, 2026-06-17) ✅

> §8 라운드트립 정밀화의 후속. "그래서 *코드·로드맵*이 어떻게" 의 답. §7(F-rep)·§4(2레인)를 운영 결정으로 좁힘. **합성·세션 결론**(검증된 §3·§7 findings 위), deep-research 신규 검증 아님.

### 9.1 F-rep 최종 강등 — 먼 미래 각주
§7은 "freeform 필요시 OCCT 아니라 F-rep/SDF 레인 권장"이라 했으나, **인터롭 축에서 F-rep이 *B-rep에게 진다***가 결정타(§7 line 275를 변별 논거로 승격):
- ⚠️ 주의 — *틀린 논거 배제*: "약한 툴(SketchUp) 가면 메시로 degrade되니 F-rep 이득 0"은 **B-rep도 똑같이 해당**(B-rep→SketchUp도 메시)이라 F-rep을 *변별 못 함*. 그 논거대로면 B-rep도 강등돼야 함 → 잘못. freeform 레인의 진짜 선택은 *F-rep vs B-rep*이고, 변별점은 따로 있다.
- **변별점**: 건축 인터롭의 지배 엔드포인트(Rhino·Revit·CAD)는 **그 자체가 B-rep/NURBS 커널.** → **B-rep/NURBS는 거기로 native 왕복**되지만 **F-rep은 *거기로도* 메시/surface-fit 강제**(IFC/Revit/CAD = B-rep 시맨틱, 음함수 아님 — §7 line 275). 즉 F-rep은 "메시와 비김"이 아니라 **중요한 엔드포인트에서 B-rep에게 *짐*.** native F-rep 왕복은 다른 F-rep 툴(nTop 등)뿐인데 건축툴 중 거의 없음.
- ∴ **F-rep이 Figcad에서 이기는 축이 *없음*** — (a) 도면 깸(§7, 코어) (b) 인터롭서 B-rep에게 짐(위) (c) off-identity. **→ 로드맵서 먼 미래 각주로 강등.** 유일 잔존 가치 = "만약 *우리가* freeform 저작 + CRDT 머지까지 원하면 데이터 모델이 OCCT보다 우리 불변에 맞음" — 전제(우리가 freeform 저작)가 정체성 밖.
- **건축의 유기적 형상 = 현실에선 NURBS/SubD(라이노).** Figcad는 Lane-2 passthrough로 받고 저작 안 함.

### 9.2 AI-freeform = B-rep 편집이 아니라 *파라미터 편집*
"AI한테 곡면 벽 완만하게" 류 요청 — 가능하나 **AI도 B-rep 직접 편집 못 함**(커널 없음 + 불변①). AI가 하는 건 **파라미터 바꾸는 ops 방출.** → 진짜 질문 = "그 형상이 파라메트릭이냐."
- **갈래 1(정답)**: freeform을 *파라메트릭 어휘*로 흡수 — 곡선 중심선 벽(중심선=호/NURBS *곡선*, control point=**파라미터**)·스윕·로프트. AI "완만하게"=곡률 파라미터 조정 ops. **불변① 깨끗(곡선=레시피, 메시 파생)·도면 됨(곡선을 우리가 소유→평면 절단 정확, F-rep과 달리)·인터롭 native.** AI 기계 이미 있음(M4 NL→ops), 빠진 건 곡선 어휘.
- **갈래 2**: import된 불투명 B-rep blob = AI 직접 편집 X → 먼저 파라미터로 리프팅(9.3) 후 갈래 1.
- **갈래 3**: 임의 2D 자유곡면 control-net 편집 = 라이노 됨(경로 B, off-identity) → passthrough.
- **경계**: 1D 곡선/단순 프로파일 = 우리 일(파라메트릭) / 임의 2D 자유곡면 = 라이노 일(passthrough).

### 9.3 Import 전략 = "올릴 수 있는 만큼 Lane-1, 나머지 Lane-2" + AI clean-up
받는 데이터를 최대한 파라메트릭으로 올리면 편집·도면·인터롭 다 풀림. 단 **"전부"는 불가** — 못 올리는 잔여가 항상 남음:

| 들어온 것 | 올리기 | 신뢰성·시점 |
|---|---|---|
| 인식 프리미티브(박스압출=벽·실린더=기둥·닫힌곡선=슬라브) | ✅ 기계적 | 높음 · 거의 지금(F5 `f13b771`) |
| 임의 B-rep(구조 有, 타입 불명) | ⚠️ AI 리프팅 | 불안정(Brep2Seq 실데이터 op~70%·**feature 1-3% 붕괴**) · v1.5 |
| 진짜 자유곡면(파라 등가물 *없음*) | ❌ 강제=근사=손실 | passthrough |

- ∴ **Lane-2 못 버림 — 두 레인 영구 공존.** "전부 파라메트릭" 강제 = 무손실 blob을 손실 근사로 바꿔치기 = 손해(436MB 검증 72% Brep).
- **충실도 경고(허브=신뢰)**: clean-up이 *조용히 근사 금지.* 정확히 올린 건 올리고 못 올린 건 **플래그+원본 보관.** 보고 예: "벽 50 변환(정확)·기둥 8 변환·자유곡면 12 참조 보관(파라 불가)."
- **clean handoff**: 관례 프로토콜(레이어 약속·IFC 시맨틱 export — 커넥터 이미 convention-following) + AI 보조. 단 라이노 유저의 조각을 *강제* 파라메트릭 못 만듦(통제 밖).

### 9.4 수렴 — 실제 빌드 (우선순위)
1. **머지 lint 검증기** (§6 1단계, 최소·최우선 — 협업 머지 유효성. M12-B가 AI용 절반 착수 `f5112dc`).
2. **Lane-2 원본 보관** (현재 메시 표시만 → 원본 payload 저장·동기화 → origin 툴 무손실 왕복). native 인터롭 잔여 절반.
3. **파라메트릭 곡선 어휘 확장** (곡선 벽·스윕·로프트 — 올릴 *대상* 넓힘 + AI-편집 freeform).
4. **AI clean-up 패스** (import 시 lift-what-maps + 잔여 Lane-2 + 충실도 보고 = F5+G1을 명시 UX). brep=v1.5/AI, 프리미티브=거의 지금.

**안 함**: OCCT B-rep 커널 · F-rep 레인 · mesh-bake 생성AI · 만능 변환기.
**native 호환** = 올린 파라메트릭 분량은 everywhere native, 잔여는 origin-only. **목표 = 파라메트릭 분량 최대화**(clean handoff + AI clean-up), 잔여는 정직히 passthrough.

---

## 부록 — 핵심 소스 (3패스 + 직접 fetch)

| 영역 | 소스 | 검증 |
|---|---|---|
| movable-tree CRDT | Kleppmann move-op.pdf(IEEE TPDS, Isabelle/HOL)·arxiv 2311.14007(PaPoC'24)·Loro | ✅ 3-0 |
| 파라 CAD pure-derive | Onshape eng blog·US Patent 10691844 | ✅ 3-0 |
| 피처 충돌분류기 | sciencedirect S147403461730486X(Lv&He 2018)·Onshape branch-merge | ✅ 3-0/2-1 |
| 하이브리드 레시피 | CadQuery docs(OCCT/OCP, query-selector) | ✅ 3-0 |
| recipe vs evaluated | Bidarra CAD&A 2005·arxiv 2202.13795(GCS) | ✅ 3-0 |
| F-rep | Pasko frep.pdf·Wikipedia FRep·HyperFun | ✅ fetch 검증 |
| 커널 내부 | OpenNURBS·OCCT·RhinoCommon docs | ✅ 3-0 (1b) |
| 표현/이론(unverified) | Hoffmann·Requicha·occupancy/SDF arxiv·persistent-naming 리뷰 | ⚠️ 1a throttle, 1차 소스 |

**검증 한계 투명성**: 1a(§1)는 verify 단계 API 레이트리밋으로 unverified-sourced(1차 소스서 추출됐으나 적대적 검증 미통과). 1b·2·F-rep은 검증 통과. 핵심 추천(경로 A 3층 머지)의 척추(movable-tree·Onshape·충돌분류기·F-rep 판정)는 **전부 검증된 소스**.
