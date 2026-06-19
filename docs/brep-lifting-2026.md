# B-rep → 파라메트릭 리프팅 — 2026 SOTA 재평가 & Figcad Track G 기계적 서브케이스

> **상태: ✅ 연구 완료 (R2, 2026-06-18~19).** 목적 = `hub-benchmark-review.md` §8 G1(brep→파라 시맨틱 리프팅 = v1.5 DEFER, Brep2Seq 근거)을 **2024–2026 SOTA로 재검증** + **기계적(비-ML) 결정론 서브케이스를 실행가능 목록으로** 추출(Track G AI clean-up = `geometry-representation-study.md` §9.3 import 표를 정밀화). **소스코드 미수정 — 지식 문서.**
>
> 검증 방식 = WebSearch 팬아웃 + 1차 소스 WebFetch(arxiv/OCCT/buildingSMART/Analysis Situs). 일부 PDF/페이월(eCAD-Net sciencedirect 403, 일부 PDF 바이너리)은 abstract/HTML로 대체 — 해당 항목은 신뢰도 낮춤 태그. **VERIFIED 사실과 SYNTHESIS 분리, 미지는 미지로.**

---

## 📋 Executive Summary — 깨서 먼저 읽기

**SOTA 판정 (Q1)**: **G1 DEFER 유지·강화. ML은 2024 Brep2Seq 이후에도 *실데이터*에서 BIM 요소추출 프로덕션 불가.** 2025–2026 신작(CADCL·BrepCoder·CADReasoner)은 합성 벤치마크 점수만 올렸고, **단 하나도 실제 임포트/스캔 데이터를 정직히 평가하지 못함**:
- CADCL(2025), BrepCoder(2026 MLLM) = **합성 전용**(DeepCAD/WHUCAD). 실데이터 평가 0. cmd ~89%/param ~82%는 *합성* 숫자.
- 실데이터 갭은 여전히 파괴적: DeepCAD를 실스캔(CC3D 5,570개)에 돌리면 **median CD 263.56 / invalidity 12.73** (합성 대비 수백 배 악화) — VERIFIED.
- 가장 최신 scan-aware(CADReasoner 2026)조차 **실스캔 데이터 확보 실패 → *시뮬레이션* 스캔으로만 평가**, 출력은 CadQuery(기계 CAD)지 BIM 벽/기둥 아님.
- 그리고 결정적: **이 ML들은 전부 *기계부품* 도메인(DeepCAD/Fusion360/ABC)**. 건축 BIM 요소(벽·슬라브·기둥) 직접 학습/평가한 것 없음. = 도메인도 안 맞음.
- → **production-usable for BIM element extraction = NO (2026).** v1.5 연기는 엔지니어링 게으름 아니라 ML 미성숙+도메인 부재가 근거.

**기계적 서브케이스 판정 (Q2) — 실행가능한 부분**: 임의 brep ML 리프팅과 **별개로, 결정론 지오메트리로 *지금* 신뢰성 높게 올릴 수 있는 서브케이스가 실재**한다. 핵심 = **건축 brep의 다수가 prismatic(직선압출)**이고, 압출 검출은 위상/표면타입 분석으로 결정론적:
1. **직사각형/폴리곤 수직압출 → 벽·기둥·슬라브** ✅ (측면 전부 평면+공통축 수직, 평행 cap 2장 → cap에서 프로파일 추출). 가장 견고.
2. **회전체(공축 cylinder/cone) → 원형 기둥** ✅ (표면타입=Cylinder + 공통축). 견고.
3. **임의 스윕 프로파일** ⚠️ (경로가 직선/원호면 가능, 자유곡선 경로는 어려움).
- 도구: OCCT `BRepAdaptor_Surface::GetType()`→`GeomAbs_SurfaceType`(Plane/Cylinder/Cone/...) · `ShapeAnalysis_CanonicalRecognition`(NURBS→해석면 변환, "visually-planar지만 NURBS저장" 갭 메움) · AAG(Joshi&Chang 1988, 면-인접+엣지 볼록/오목) · Analysis Situs(유일 오픈소스 OCCT 피처인식, rule-based=**"entirely deterministic"**).
- 깨지는 조건: 입력이 valid solid 아님 · 면이 maximized 아님(쪼개진 면) · 표면이 해석면 아닌 근사 NURBS · 불린 잔여/fillet/chamfer로 cap 오염 · 비-manifold.

**Figcad 권고 (Q3)** — `geometry-representation-study.md` §9.3 3행 표를 **mechanical 행을 인식기별로 분해**해 정밀화:
| 티어 | 무엇 | 방법 | 불변① 영향 | 시점 |
|---|---|---|---|---|
| **T1 기계적 (지금)** | 직각 박스압출=벽/기둥 · 폴리곤압출=슬라브 · 공축 실린더=원형기둥 | 결정론 OCCT(표면타입+압출축+프로파일 추출) | **ops/params만 방출**(중심선·두께·height·section). 메시 절대 미베이크 | **거의 지금** (F5 `f13b771` 위 확장) |
| **T2 ML 연기 (v1.5+)** | 임의 brep(구조 有, 타입 불명) | AI 시맨틱 리프팅 | ops/params만, 충실도 보고 | ML 성숙 시 — **2026 미충족** |
| **T3 영구 passthrough** | 진짜 자유곡면(파라 등가물 *없음*) | Lane-2 원본 보관 | 저장 안 함=별도 표현(외부 모델), 파생 아님 | 영구 |

**= §9.3 표와 모순 없음 — T1 행을 "기계적으로 올릴 수 있는 것"에서 *구체적 인식기 3종*으로 분해.** §9.3가 "거의 지금(F5)"으로 묶은 것을 실제 OCCT 레시피로 명세.

**핵심 reframe (양방향 — 측정 전엔 중립)**: 건축 brep의 지배적 표현이 **압출**(IFC 표준이 `IfcExtrudedAreaSolid` — VERIFIED)이므로 T1 결정론 레인이 실제 건축 brep의 *다수*를 커버할 잠재력이 있다 — **그러나 반대 추론도 동등히 가능**: .3dm은 *깨끗한* 압출을 이미 경량 `Extrusion` 객체(검증서 1,075개)로 분리 저장하므로, **일반 Brep으로 남은 17,918개 풀은 비-자명 케이스(불린·fillet·import·join)로 *편향*됐을 수 있음** = T1 적중률이 낮을 수도. **어느 쪽이든 미측정 = 미지로 박제**(아래 §4). → **결론: T1이 다수냐 잔여냐는 *그 파일로 인식률 실측 후*에만 단정. 값싼 측정이 ML 베팅·낙관 framing보다 먼저.**

---

## §1. Q1 — ML SOTA 재평가 (2024–2026): DEFER 유지·강화

### 1.1 VERIFIED — 최신 방법들과 실측 숫자

| 방법 | 연도 | 입력→출력 | 평가 데이터 | 숫자 | 실데이터? | 소스품질 |
|---|---|---|---|---|---|---|
| **Brep2Seq** | 2024 | B-rep→피처시퀀스 | DeepCAD/Fusion360(합성) | 합성 99%+ / 실세계 op~70%·param~70–78% · **feature-level 1.65–3.35% 붕괴** | 부분(실세계 "simple mechanical"만) | **HIGH** (JCDE 11(1):110, 기존 baseline) |
| **CADCL** | 2025 | B-rep→파라시퀀스(contrastive) | DeepCAD·WHUCAD(**둘 다 합성**) | DeepCAD cmd 90.31%/param 81.52% · WHUCAD cmd 82.40%/param 78.79% | **❌ 없음** | **HIGH** (JCDE 12(10):176, fetch 검증) |
| **BrepCoder** | 2026 | B-rep→Python-like CAD code (**MLLM**) | DeepCAD(170K, **합성**) | RE cmd 89.34%/param 82.01% · CD 0.464e-3 · invalid 0.86% · CAD-QA 79% | **❌ 없음** | **HIGH** (arxiv 2602.22284, fetch 검증) |
| **CADReasoner** | 2026 | point cloud+멀티뷰→CadQuery(반복편집) | DeepCAD/Fusion360/MCB + **시뮬레이션 스캔** | scan-sim CD 0.15–0.56e-3, IR 0% | **❌ 실스캔 확보 실패→시뮬만** | **HIGH** (arxiv 2603.29847, fetch 검증) |

**실데이터 갭 (VERIFIED, 결정타)**: DeepCAD를 **실스캔 CC3D(5,570개)**에 적용 시 **median Chamfer Distance 263.56 / invalidity ratio 12.73** — 합성 테스트(CD <1, IR <1%) 대비 *수백 배* 악화. [출처: CADReasoner 관련 서베이/벤치마크 인용, confidence: MEDIUM-HIGH — 검색 요약서 추출, 1차 표 직접 미확인]

### 1.2 VERIFIED — 도메인 부정합

이 ML들은 전부 **기계부품 CAD 도메인**(DeepCAD/Fusion360/ABC/CC3D — sketch-extrude 기계가공 부품). **건축 BIM 요소(벽·슬라브·기둥·보)를 학습/평가한 brep→파라 리프팅은 발견되지 않음.** 출력 어휘도 기계 CAD 시퀀스(sketch+extrude+fillet+revolve)지 BIM 시맨틱(타입·재료층·호스트·IFC 매핑)이 아님 — `geometry-representation-study.md` §7 "F-rep은 BIM 시맨틱층이 위에 필요"와 같은 갭이 ML 리프팅에도 적용.

### 1.3 피처인식 ≠ 파라메트릭 리프팅 (혼동 주의)

검색서 99%+ 정확도가 보이나(BRepGAT 99.1% MFCAD18++ · BRepFormer SOTA · AAGNet) — **이건 *면 세그멘테이션/분류*(이 면이 pocket/slot/hole 피처에 속하나)지 *편집가능 파라미터 복원*이 아님.** 가공피처 인식 ≠ "벽=중심선+두께"로 리프팅. 또한 전부 **합성 MFCAD/MFInstSeg 데이터**. → 높은 숫자에 속지 말 것: BIM 리프팅과 다른 과업. [VERIFIED, confidence: HIGH]

### 1.4 SYNTHESIS — Q1 판정

**2024 이후 진보는 *합성 벤치마크 최적화*(CADCL +contrastive, BrepCoder +MLLM 코드정렬)지 *실데이터 일반화*가 아님.** 단 하나의 2025–2026 방법도 실 임포트 brep(특히 건축)에서 프로덕션 정확도를 입증 못 함. scan-aware 시도(CADReasoner)조차 실데이터 확보에 실패. **→ G1 v1.5 DEFER는 정당, 2026 기준 *더* 정당.** 진보 방향(MLLM·scan-sim)은 유망하나 **건축 BIM 요소추출 = 아직 아님.** 미래 재평가 트리거 = "실 임포트/실스캔 데이터에서 BIM kind(벽/기둥/슬라브) feature-level 정확도 80%+ 입증한 논문 출현".

---

## §2. Q2 — 기계적(결정론) 서브케이스 — 실행가능한 부분 ★

> 이게 R2의 신규·실행가능 산출. ML과 *독립*으로 지금 신뢰성 높게 올릴 수 있는 것.

### 2.1 VERIFIED — 결정론 도구상자 (OCCT/기하처리)

**(a) 표면타입 분류 — `GeomAbs_SurfaceType`** [OCCT docs, HIGH]
- `BRepAdaptor_Surface`로 Face를 3D surface처럼 다루고 `GetType()` → enum: **Plane · Cylinder · Cone · Sphere · Torus · BezierSurface · BSplineSurface · SurfaceOfRevolution · SurfaceOfExtrusion · OtherSurface.**
- = "이 면이 무엇인가"의 견고한 결정론 프리미티브. 압출/회전체 검출의 1차 분류기.
- ⚠️ 단 면이 **해석면으로 *저장*돼야** 함 — "visually planar지만 BSpline으로 저장"은 Plane으로 안 잡힘(아래 (b)가 해소).

**(b) Canonical Recognition — `ShapeAnalysis_CanonicalRecognition`** [OCCT docs, HIGH]
- NURBS/B-spline/Bezier 면·곡선을 **해석 등가물로 변환**: 곡선=line/circle/ellipse, 면=**planar/cylindrical/conical/spherical.**
- **max-deviation 기준**: 초기 geo와 canonical geo의 최대거리 < 주어진 tol일 때만 변환. → tolerance 명시적·제어가능.
- = "근사 NURBS 평면을 진짜 Plane으로" 메우는 결정론 브리지. Analysis Situs가 명시한 "canonical 입력 요구" 갭을 정확히 해소. **mm-정수 Figcad엔 tol 정합 좋음.**

**(c) Attributed Adjacency Graph (AAG)** [Joshi & Chang 1988 (원전) + Analysis Situs/AAGNet (구현), HIGH]
- 그래프: 노드=면(표면타입 속성), 아크=면-면 인접(엣지 **볼록/오목 vexity** 속성). `["1","3","convex"]`.
- **엣지 볼록성(dihedral angle) = 피처인식의 근본 휴리스틱.** `FindConvexOnly()`/`FindConcaveOnly()`.
- 피처 = 서브그래프 패턴 매칭. 원전(1988)은 polyhedral 피처(pocket/slot/step/polyhedral hole) 견고.
- ⚠️ "vertex-only touching"(엣지 공유 없는 정점접촉) 미포착. AAG는 geo가 **frozen**일 때만 유효(인덱스 = 입력 수정 시 무효).

**(d) Analysis Situs — 유일 오픈소스 OCCT 피처인식 프레임워크** [analysissitus.org, HIGH]
- 두 접근: **Rule-based**("pretty fast", "**entirely deterministic and straightforward**", 유지보수 쉬움, 확장성 낮음) + **Isomorphism**(그래프 분해+패턴매칭, 계산 비쌈, 서브타입 구별).
- **prismatic 초점**: "Feature recognition focuses on parts with prismatic geometries—characterized by **straight extrusions**". prismatic contour = (선택적)bottom + bottom에 수직한 walls 시리즈 = pocket의 일반화.
- 견고 인식: drilled holes(countersunk/counterbored 변형)·shafts·cavities·fillets·threads.
- **3대 입력 요구(견고성 게이트)**: ① 입력은 **valid solid** ② CAD 면이 **maximized**(쪼개진 동일평면 면들이 하나로) ③ canonical 면은 **해석면으로 표현**((b)로 사전처리).
- 실패모드: "interacting + complex features에선 simple scanning이 error-prone — 풍부한 위상/기하 체크 필요."

### 2.2 SYNTHESIS — 서브케이스별 결정론 레시피 (Figcad kind 매핑)

> 알고리즘 = (b) canonical 사전처리 → (a) 표면타입 분류 → 토폴로지 패턴 검사 → 프로파일 추출 → **ops 방출**(불변① — 메시 미베이크).

**케이스 1 — 직각 박스/폴리곤 수직압출 → 벽 / 기둥 / 슬라브** ✅ 가장 견고
- 패턴: 모든 측면 = Plane이고 법선이 **공통축에 수직** + **평행한 cap 면 2장**(법선 = ±축). [VERIFIED 압출 위상: 측면=프로파일 sweep, end면=프로파일 평면 평행 — IFC/extrusion 문헌 HIGH]
- 프로파일 = cap 면의 외곽 루프(holes=내곽 루프). 압출축 = cap 법선, height = cap 간 거리.
- Figcad 매핑:
  - 얇고 긴 직사각형 단면 + 수직축 → **wall**(중심선=프로파일 장축 중심선, thickness=단축, height). ⚠️ 중심선 추출 = 직사각형 프로파일의 medial axis(결정론, 단순 사각형은 자명).
  - 작은 닫힌 단면 + 수직축 → **column**(point at + section + height).
  - 큰 폴리곤 + 얇은 height → **slab**(boundary + thickness). = IFC `IfcSlab` = ArbitraryClosedProfile 압출(VERIFIED).
- **불변①**: 중심선/boundary/section/height = 전부 **파라미터** → ops 방출, 파생은 기존 `extrudeProfile`(코드 이미 보유, §0). 메시 0.

**케이스 2 — 회전체(공축 cylinder/cone) → 원형 기둥** ✅ 견고
- 패턴: 면 타입 = **Cylinder**(또는 Cone) 표면들이 **공통 축** 공유 + 평면 cap. `GeomAbs_Cylinder` 직접.
- 축·반지름은 `BRepAdaptor_Surface`의 cylinder 파라미터서 직접(결정론).
- Figcad 매핑: **column**(section=circle, radius, height). 기존 circle section 어휘 재사용.
- **불변①**: radius/height/at = 파라미터. ops 방출.

**케이스 3 — 일반 스윕 프로파일** ⚠️ 부분
- 경로가 **직선**(=케이스 1) 또는 **원호/원**(beam following arc, 곡선 중심선 벽)이면 결정론 가능 — `geometry-representation-study.md` §9.2 "파라메트릭 곡선 어휘"와 합류.
- 경로가 **임의 자유곡선** = 결정론 어렵 → T2(ML) 또는 T3(passthrough). 단 §9.2 갈래1(곡선 중심선=호/NURBS 곡선 control point=파라미터)로 일부 흡수 가능.

**케이스 4 — 인식 실패 → 잔여** ❌ T3
- valid solid 아님 · fillet/chamfer가 cap 오염 · 불린 잔여 · 비-manifold · 진짜 자유곡면 → **Lane-2 원본 보관 + 충실도 플래그**(§9.3 "조용한 근사 금지").

### 2.3 VERIFIED — 깨지는 조건 (정직한 brittleness)

- **canonical 미표현**: 면이 BSpline으로 저장 + tol 밖 → (b) 변환 실패 → 압출 미검출. (Rhino brep는 종종 해석면 보존하나 보장 없음.)
- **maximized 아닌 면**: 한 평면이 여러 face로 쪼개짐 → cap 단일면 가정 깨짐. 사전 면 병합 필요.
- **fillet/chamfer 모서리**: cap-측면 경계가 라운드 → "직각 압출" 패턴 흐림. fillet 제거(suppress) 사전처리 필요(Analysis Situs가 fillet 인식 보유).
- **불린 잔여·비-manifold**: 측면 법선 공통축 가정 깨짐.
- **AAG frozen 요구**: 입력 수정 시 인덱스 무효 — Figcad는 한 번 import 변환이라 무관(편집은 변환 *후* ops로).
- → **신뢰성 전략 = 보수적 검출 + 충실도 보고.** 확신 못 하면 T1 강제 말고 T3 passthrough(허브=신뢰, §9.3).

---

## §3. Q3 — Figcad 권고 (티어드 + 불변 태그)

> `geometry-representation-study.md` §9.3 표의 **정밀화**(모순 아님). §9.3 "인식 프리미티브 = ✅ 기계적 · 거의 지금(F5)"을 **인식기 3종으로 분해 + OCCT 레시피 명세**.

### T1 — 기계적으로 지금 올린다 (Track G primitive recognition)
- **무엇**: 케이스 1(직각/폴리곤 수직압출→벽/기둥/슬라브) + 케이스 2(공축 실린더→원형기둥) + 케이스 3 직선/원호 경로.
- **방법**: `ShapeAnalysis_CanonicalRecognition` 사전처리 → `BRepAdaptor_Surface::GetType` 분류 → 압출/회전 위상 패턴 → 프로파일 추출 → **DocStore ops 방출**.
- **불변① 영향**: 🟢 **ops/params만 방출**(중심선·thickness·height·section·boundary·radius·at). **메시 절대 미베이크.** 파생 = 기존 `extrudeProfile`. 불변② 경유(executeOp).
- **시점**: 거의 지금 — F5 역-import(`f13b771`, 기둥+보 복원)의 직접 확장. 커넥터(`connectors/rhino/`)나 interop(`rhino3dm.ts`·`ifcImport.ts`)에 인식 패스 추가.
- **어디서 도나**: 정밀모델링 아니라 *import 변환* — OCCT/canonical은 커넥터(.NET RhinoCommon) 또는 서버측. 브라우저 WASM OCCT는 wasm32 4GB 천장(F8) — **커넥터 경로 권장**(VALIDATION_260416 패턴: File3dm.Read→subset→push).

### T2 — ML로 연기 (성숙 시, v1.5+)
- **무엇**: 임의 brep(구조 有, 타입 불명 — 케이스 1·2 패턴 안 맞지만 파라 등가물 존재 가능).
- **방법**: AI 시맨틱 리프팅(Brep2Seq류). **2026 미성숙 = 연기 정당**(§1).
- **불변① 영향**: 🟢 리프팅 결과도 ops/params만. AI가 메시 방출 = 불변① 위반(REJECT, ROADMAP H6).
- **시점**: "실데이터 BIM feature-level 80%+" 입증 논문 출현 시 재평가. 현재 트리거 미충족.
- **충실도**: 조용한 근사 금지 — 변환분/근사분/실패분 보고(§9.3).

### T3 — 영구 passthrough
- **무엇**: 진짜 자유곡면(파라 등가물 *없음*) · 인식 실패 잔여(불린 잔여·비-manifold·과도 fillet).
- **방법**: **Lane-2 원본 보관**(원본 brep/NURBS payload 저장·동기화 = 별도 표현, `federation-design.md`) + 충실도 플래그.
- **불변① 영향**: 🟢 텍스트 무위반 — 외부 모델은 **읽기전용 별도 표현**(Figcad 파생 요소 아님), `geometry-representation-study.md` §8 프레이밍. raw mesh 저장은 "더 높은 recipe 정말 없을 때만"(§8 저장 규칙).
- **시점**: 영구 — 두 레인 영구 공존(§9.3 "Lane-2 못 버림").

### 정량 미지 (정직)
- 436MB 검증서 **72%가 Brep** — 그중 **몇 %가 케이스 1·2(단순 압출/회전)인가 = 미측정.** "건축은 mostly prismatic"은 IFC 표준(`IfcExtrudedAreaSolid`이 벽/슬라브/기둥 standard — VERIFIED)으로 *방향* 지지되나, *그 .3dm Brep 매스의 실제 비율*은 미측정. → **T1이 다수냐 일부냐는 측정 전엔 미지.** 권고: **T1 구현 전/중 그 파일로 인식률 실측**(케이스1·2 hit 비율) = 값싼 검증, ML 베팅보다 먼저.
- ⚠️ 보조 단서: .3dm은 이미 경량 **Extrusion 객체**(검증서 1,075개)를 일반 Brep과 분리 저장 — 이건 출신툴이 *이미 압출로 분류*한 것이라 T1이 **자명하게** 흡수(프로파일+축 직접). 17,918 Brep 중 압출-등가는 별도 검출 필요.

---

## §4. 미지·한계 (박제)

- **케이스 1·2의 실제 건축 brep 적중률 미측정**(§3 정량 미지). 측정 전 "T1=다수" 단정 금지.
- **PDF 본문 일부 미확인**: arxiv 2209.01161(prismatic-from-voxel)·2208.10555(CADOps-Net) PDF = 바이너리/크기 초과로 abstract만. prismatic 검출 *세부 알고리즘*은 1차 표 직접 미확인(서베이 요약 의존, MEDIUM).
- **eCAD-Net(sciencedirect 403)·BrepMFR·BRepGAT 정밀숫자**: abstract/검색요약만 — 단 이들은 피처세그(§1.3) 또는 합성평가라 판정에 비-load-bearing.
- **CC3D 263.56/12.73 수치**: 검색 요약서 추출(CADReasoner 맥락), 1차 표 직접 미확인 = **MEDIUM-HIGH**. 방향성(실데이터서 수백배 악화)은 확실, 정확 소수점은 재확인 권장.
- **중심선 추출(벽)**: 단순 직사각형 프로파일은 자명하나, L/T자·복합 프로파일의 medial-axis 결정론 추출 견고성은 케이스별 — 미세부.

---

## §5. 소스 (검증)

| 영역 | 소스 | 검증 |
|---|---|---|
| ML baseline | JCDE 11(1):110 Brep2Seq · github zhangshuming0668/Brep2Seq | HIGH (기존) |
| ML 2025 | JCDE 12(10):176 CADCL (fetch: 합성전용, 90.31/81.52) | HIGH fetch |
| ML 2026 | arxiv 2602.22284 BrepCoder MLLM (fetch: 합성전용, 89.34/82.01) | HIGH fetch |
| ML 2026 scan | arxiv 2603.29847 CADReasoner (fetch: 실스캔 확보실패→시뮬, CadQuery 출력) | HIGH fetch |
| 실데이터 갭 | CC3D DeepCAD CD 263.56/IR 12.73 | MEDIUM-HIGH (검색요약) |
| 피처인식(≠리프팅) | arxiv 2504.07378 BRepFormer · JCDE BRepGAT 99.1% · AAGNet (S0736584523001369) | HIGH (도메인 주의) |
| 표면타입 | OCCT BRepAdaptor_Surface · GeomAbs_SurfaceType (fetch) | HIGH |
| canonical recog | OCCT ShapeAnalysis_CanonicalRecognition · occt3d.com SDK (search) | HIGH |
| AAG | Joshi&Chang 1988 (quaoar.su PDF) · Analysis Situs aag.html (fetch) | HIGH |
| 피처인식 프레임 | analysissitus.org recognition-principles/framework (fetch: rule-based=deterministic, 3입력요구) | HIGH |
| 건축=압출 | buildingSMART IfcExtrudedAreaSolid (fetch: 벽/슬라브/기둥 standard) | HIGH |
| 압출 위상 | CADOps-Net 2208.10555 · prismatic-from-voxel 2209.01161 (abstract만) | MEDIUM |

**검증 한계 투명성**: load-bearing 판정(ML 합성전용·실데이터 갭·결정론 도구 실재·건축=압출)은 전부 1차 소스 fetch 검증. 일부 PDF 본문·페이월은 abstract/검색요약 대체(태그). 적대적 검토 = "피처인식 99%≠파라리프팅"(§1.3)·"scan-sim≠실스캔"(CADReasoner)·"기계도메인≠BIM"(§1.2) 함정 명시 회피.

---

## 부록 — 436MB 측정 대용: 실 Rhino 모델 적중률 측정 (2026-06-19, Rhino MCP/RhinoCommon)

> §Exec의 미측정 질문("기계적 sub-case가 실 건축 Brep *대부분* 커버하나")을 실측. 원 436MB(260416)는 미오픈 — 사용자가 연결한 실 건축 모델 `260617_입면 스터디.3dm`(3722 obj, 블록 인스턴스 재귀 포함)에서 RhinoCommon(=OCCT급 B-rep 커널, R2 권장 툴체인)으로 분류. mm·tol 0.01.

**분류기(결정적)**: Extrusion=선형압출(liftable) · Brep solid 전부평면=prism(벽/슬라브/기둥) · Brep solid+실린더면=원형기둥 · 나머지=freeform 잔여 · 열린 surface=non-solid.

| 분류 | 수 | 매핑 |
|---|---|---|
| Extrusion | 130 | wall/slab/column |
| Brep prism(전부평면 solid) | 199 | wall/slab/column |
| Brep cylinder | 203 | round column |
| Brep freeform | 32 | Lane-2 잔여 |
| Brep non-solid(열린 surface) | 123 | Lane-2(파사드 패널) |
| **합(Brep+Extrusion)** | **687** | |

**기계적 적중률 = 532/687 = 77.4%** (non-solid 제외 시 532/564 = **94.3%**).

**레이어별 핵심 패턴 — liftable이 구조/1차 건축요소에 집중**: 기둥 H-500x500 109/109 · 보 H-300x500 130/130 · 슬라브 10/10 · 벽 A-Wall 27/27·F-Wall 42/50 · 계단 47/47 · 주차 78/78 = **~100%**. 잔여(0% liftable) = 파사드 장식(up-light 0/56·crease panel 0/27·strip·panel·window) = 자유곡면/열린 surface = **어차피 Figcad kind 아님 = Lane-2 passthrough가 맞음**.

**판정(R2 게이트 통과)**: 기계적 리프트가 실 건축 Brep의 **대부분(77~94%)을 커버하고, liftable한 게 정확히 Figcad kind(기둥·보·슬라브·벽·계단)에 집중**. 잔여는 파사드 디테일(원래 passthrough). → **Track G 기계적-리프트 빌드 GO** (단 커넥터/RhinoCommon 경로 — wasm32가 브라우저 OCCT 차단).

**측정 caveat(정직)**: ① 원 436MB(260416, 24819 obj·72% Brep)가 아닌 더 작은 입면스터디 파일 — 적중률은 파일별 다를 수 있음(파사드-heavy 모델은 낮음). ② "전부 평면 solid=prism"은 *상한 프록시* — 진짜 압출인식(일정 프로필·단일 축)은 더 엄격하니 실 liftable은 다소 낮음. 단 구조 레이어 100% 집중은 프록시 정밀도와 무관하게 견고. ③ 분류만 했고 파라미터 추출(프로필·축·치수)→ops 방출은 G 빌드 본체.
