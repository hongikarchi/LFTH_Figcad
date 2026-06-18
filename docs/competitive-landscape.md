# 경쟁 지형 — 웹 BIM·AEC 협업 툴 (Arcol·Motif·Qonic·Forma·Snaptrude)

> **R4 리서치 (2026-06-19).** `hub-benchmark-review.md` §6 #2가 3패스 다 펑크낸 dim 6 경쟁지형. §6의 결론 = "딥리서치 부적합 — 검증된 fact 아닌 **포지셔닝 맵 + 불변 엣지 분석** 필요". 그래서 이 문서는 posture를 바꿈: **VERIFIED FACTS**(적대적 게이트 적용, kill된 claim = unknown으로 남김, "claim 0" ≠ "결론 0")와 **SYNTHESIS**(포지셔닝 맵·엣지/제약 분석 — 게이트 비적용, task가 명시적으로 분리 요구)를 나눔. 경쟁사의 *자기 포지셔닝 주장*("Arcol은 자신을 Figma for BIM이라 부른다")은 *포지셔닝 사실*로는 primary-true로 취급(기술적 달성과 구분).
> 페어 문서: `hub-benchmark-review.md`(§2 = 웹+실시간 단독은 무적 해자 아님 — 이 문서가 그 위에 세움) · `positioning-vs-mcp.md`(§2 해자=실시간·웹·중립, §6 가치갭=멀티모델 라이브 허브 미빌드).

---

## 0. TL;DR — 헤드라인 (정직하게, 크게)

**task가 요구한 가장 큰 답부터: "경쟁사가 이미 Figcad의 해자를 한다면 크게 말하라."**

1. **"Figma for BIM" 포지셔닝은 이미 점령됨.** Arcol·Snaptrude가 명시적으로 그렇게 마케팅하고, 둘 다 웹+실시간 멀티유저 협업이다. **Figcad 정체성의 표면 슬로건은 차별점이 아니다.** (VERIFIED — Arcol "Figma for BIM" via Liveblocks 블로그, Snaptrude "Figma for construction" via 마케팅.)
2. **웹+실시간 멀티플레이어 = 이미 5사 중 4사가 함.** Arcol(Liveblocks)·Snaptrude·Qonic·(Forma는 약하게). **이것도 차별점 아님.** `hub-benchmark-review.md` §2가 이미 경고한 것 — "웹+실시간 *단독*은 무적 해자 아님" — 이 패스가 그걸 **경쟁사 데이터로 확증**한다.
3. **하지만 — "중립 ∩ 편집가능 ∩ 실시간 ∩ 라이브 멀티모델 집계" 4중 교집합은 아무도 깨끗하게 점령 못 함.** 두 진짜 위협이 **서로 다른 축에서 탈락**한다:
   - **Motif** = 유일하게 **라이브 멀티소스 스트리밍**(Revit+Rhino를 한 브라우저 캔버스, "no exports") — 그러나 **마크업/리뷰 전용**(지오 편집 불가, 코멘트만 역동기화), **Autodesk/McNeel 잠김**(IFC/DWG 없음). = 라이브 집계 ✅ / 편집가능·중립 ❌.
   - **Qonic** = **편집가능 + 중립(IFC-native) + 실시간 + 웹**, 실제 지오 편집, 멀티분야 federation — 그러나 **자기 클라우드 IFC 모델로 import**(Revit→Qonic 단방향, **역왕복 없음**). = 편집가능·중립 ✅ / 라이브 외부툴 집계·왕복 ❌.
   - Arcol·Snaptrude = 단일모델 **저작** 툴(Figma식 멀티*유저*), import-replace. Forma = 웹이나 **비중립**(Autodesk 잠김).
4. **그러나 정직한 경고 (advisor 강조):** Figcad의 "라이브 멀티모델 허브 + 왕복" 차별점은 **4대 불변 중 하나가 아니며**(불변은 pure-derive·ops·렌더루프·펜터치 — 전략 해자가 아니라 대부분 구현/UX), `positioning-vs-mcp.md` §6에 따르면 **아직 안 지어졌다**(ReferenceLayer = dev-flag, import는 여전히 doc-replace). **즉 오늘 Figcad의 vs-Motif/Qonic 실차별점은 얇고 부분적으로 aspirational이다.** Qonic은 *지금* 출시되어 실 지오를 편집하고 federation을 한다 — Figcad가 약속만 한 영역에서 이미 GA다.
5. **불변 ① (pure-derive)는 양날.** 깨끗한 diff·파라메트릭 편집엔 **엣지**, brep ingest엔 **제약**(VALIDATION_260416의 72% brep — Qonic은 실 solid/NURBS를 Figcad가 derive 못 하는 스케일로 편집). §3에서 솔직히 다룸.

---

## 1. 방법 / 신뢰도

- **posture (핵심)**: 이전 3패스가 0 claim 낸 이유 = "kill 다 하는" 적대적 딥리서치를 *분석* 질문에 적용 → 마케팅 소스가 게이트에 컷 → 생존 0 → 결론 0. 이 패스는 **사실/분석 분리**로 그 함정을 회피. kill된 사실 = unknown(결론 없음의 사유 아님).
- **소스**: primary 우선 (제품 docs·founder talk·changelog·funding press·Crunchbase/Tracxn). 마케팅 페이지는 *자기 포지셔닝*엔 primary, *기술 달성*엔 self-claimed로 태그.
- **검증**: 가장 load-bearing 1건(Motif 라이브 스트리밍 + 코멘트만 역동기화)은 Motif 자체 페이지로 직접 재확인 — 전체 crux 판정이 거기 걸려 있어서. 확인됨 ("Live model streaming from Revit and Rhino. No exports", 마크업/코멘트 중심, IFC/DWG 미언급).
- **시간민감 caveat**: 이 시장은 빠르게 움직임 — Arcol 2025-06 GA, Motif 2025-03 첫 출시, Qonic 2026-04 도면생성 추가. 이 문서는 2026-06 스냅샷. funding 수치는 dated press 기준이나 미공개 라운드 존재(Arcol Series A 금액 등).

---

## 2. VERIFIED FACTS — 제품별 (적대적 게이트 적용)

> 각 항목: primary(P) / secondary(S) / self-claimed(SC) 태그. self-claimed = 마케팅 주장이나 독립 검증 안 됨.

### 2.1 Arcol (arcol.io)
- **포지셔닝**: "Figma for BIM" (SC→P: Liveblocks 블로그가 Arcol의 목표를 "create a 'Figma for BIM'"로 인용). AEC Mag: "cloud-native BIM 2.0 modelling system for architects." **= AUTHORING 툴, 허브 아님.** "preRevit detail design", massing 단계 경쟁(Revit/Forma/SketchUp).
- **협업**: 브라우저 + 실시간 멀티**유저** (P, Liveblocks `@liveblocks/react`). **5사 중 유일하게 실시간 tech가 구체 소스 있음** (Liveblocks = conflict-free 데이터, CRDT에 가장 근접한 claim). UK+NYC 동시편집 데모. **외부 멀티모델 집계 안 함.**
- **인터롭**: import-replace, 라이브 집계 아님. Revit(native mass로)·GLTF export, DWG/site import. "Rhino/Grasshopper deep integration in the works"(McNeel과) = **미출시**.
- **모델링 깊이**: 개념/LOD 100-250. loft·push/pull·sweep·Boolean·파라메트릭. AEC Mag: "models look fairly simple", 상세모델링 "under development".
- **타깃**: 건축가, 초기/개념설계.
- **funding/성숙도** (P/S): 2021 설립 (Paul O'Carroll, NYC). $5M seed (Procore 창업자 Tooey Courtemanche + Amar Hanspal[지금 Motif CEO=경쟁자] 포함). 미공개 Series A 2024말. **공개 출시 2025-06-02.** $100/user/mo. 얼리어답터 Corgan·Warren & Mahoney.
- **WEAKNESSES**: 개념 전용(상세 BIM 없음); **Safari 미지원**(Chrome/Edge만 — "web-native" 치고 역설적); 라이브 외부모델 집계 없음; Rhino/GH 미출시; GA로는 매우 어림(2025 중반 출시).

### 2.2 Motif (motif.io) — **moat-threat #1**
- **포지셔닝**: 중립-ish 조율 HUB, 명시적으로 저작/모델링 툴 **아님**. VERIFIED 자기진술: "Motif brings teams together in a shared space to **review, organize, and present** architectural designs—across 2D and 3D, from any source." 블로그: **"the industry does not need another conceptual modelling tool on the web"** — 모델링 대신 "infinite canvas" 협업 선택.
- **협업**: 브라우저 + 실시간. **핵심 VERIFIED (Motif 자체 페이지 직접 재확인)**: **"Live model streaming from Revit and Rhino. No exports, no file conversions."** 모델 "appear instantly", 실시간 갱신. 실시간 tech 미명시(CRDT claim 없음). **5사 중 유일하게 진짜 라이브 멀티소스 집계를 한 캔버스에 함.**
- **인터롭** (= 중립·편집가능에서 탈락하는 지점):
  - 소스 = **Revit·Rhino·Grasshopper·Dynamo만.** **IFC 없음, DWG 없음.** Autodesk/McNeel 중심.
  - 지오는 소스→Motif. **코멘트만 Motif→소스 동기화** ("Every comment in Motif syncs back to Revit and Rhino automatically"). **지오 편집은 역왕복 안 함.**
  - CRITICAL (S, 자체 페이지와 일치): 스트리밍은 **지오메트리만, 풀 파라메트릭 데이터 아님** — "Motif focuses on markup rather than parametric design."
- **모델링 깊이**: 모델러 아님. 3D 표면 위 sketch/markup, comment, sheet review, AI 시각화(렌더링). 스트리밍 지오 **편집 불가**.
- **타깃**: AEC/O 팀 설계리뷰·조율; 개념~프레젠테이션, pre-documentation.
- **funding/성숙도** (P/S): 2023 설립 — **Amar Hanspal(ex-Autodesk 공동CEO/CPO) + Brian Mathews(ex-Autodesk product CTO)**. **총 $46M** (seed Redpoint + Series A CapitalG[Alphabet], Baukunst 양쪽). **첫 제품 2025-03-26 출시.** 2025 "AI Disruptors 60".
- **WEAKNESSES**: 에디터 아님(마크업만); 지오-only 스트림이 파라메트릭 BIM 데이터 손실; Autodesk/Rhino 잠김 = **IFC/DWG 없음 = 진짜 중립 아님**; 코멘트만 역왕복. 가장 잘 펀딩되고 가장 허브 모양이나 **의도적으로 조율 레이어, 편집가능 허브 아님.**

### 2.3 Qonic (qonic.com) — **moat-threat #2**
- **포지셔닝**: 편집가능·중립 클라우드 BIM 저작+조율 ("BIM 2.0", "complete reset... free from legacy constraints"). IFC-native 조율/저작이 Revit/Archicad를 **보완**(대체 아님). 벤더-중립 설계.
- **협업**: 브라우저(+ 네이티브 Win/macOS + iOS/Android). VERIFIED (자체 FAQ): "real-time collaboration, tracking each user's changes separately and automatically syncing them **without conflicts**" / 동시변경 per-user 추적. 실시간 tech 미명시(내장 충돌해결·버전관리; CRDT claim 없음).
- **인터롭**: IFC-native, 벤더-중립, "single-vendor desktop lock-in" 명시 회피. IFC2x3/4/4x3·Revit·Rhino·SketchUp import. **CRITICAL (현행 2026): Revit add-in = Qonic으로 단방향 EXPORT, Revit로 역왕복 문서화 안 됨.** **멀티분야 federation 함**(여러 분야모델·clash·이슈를 한 공유 클라우드모델에) — BUT *자기* federated IFC 모델, 라이브 스트림 외부툴이 편집을 되미는 게 아님. 2023 베타 "import what has changed"는 계획됐으나 미출시; 2026 현재도 역왕복 부재/미확인.
- **모델링 깊이**: **실 지오메트리 편집** (데이터-only 툴 대비 차별점). 커널: AEC Mag 베타(2023-12)는 **ACIS 기반 solid + NURBS**라 했으나 한 라운드는 "top-secret lightweight kernel of origins unknown" — **커널 정체 미해결**, 단 "실 solid/NURBS 편집"은 양쪽 다 성립. 2026-04: **네이티브 도면생성**(IFC/BIM→주석 plan/section, DWG export) 추가.
- **타깃**: 건축↔시공 인터페이스, 멀티분야 조율, 모델 enrichment/검증; 엔지니어+건축가.
- **funding/성숙도** (P/S): ~2021 설립 (Ghent, 벨기에) — **5명 ex-Bricsys 창업자** (Bricsys/Hexagon 매각 후). **자력/부트스트랩** (Tracxn에 VC 없음; Trimble 0-60 Challenge 액셀러레이터만; 회사 진술 "completely self-funded... free from investor pressure"). 오픈베타 2023-12 → 현재 **상업/GA**, freemium (Free 5,000m² → Team €195/mo → Professional €895/mo → Enterprise). 면적기반 캡.
- **WEAKNESSES**: **Revit 역왕복 없음**(단방향 import); 라이브 외부툴 집계자 아님(자기 destination 모델); 2D 문서화 역사적 약함(2026-04에야 대응); 면적기반 캡이 대형 estate에 불리; 부트스트랩 = VC 경쟁사 대비 느린 스케일; 커널 미공개.

### 2.4 Autodesk Forma (구 Spacemaker AI)
- **포지셔닝**: 초기/개념 + (신규) schematic 설계 AUTHORING. 웹-native 개념 모델러 + AI 환경분석. **중립 허브 아님.** Forma Building Design(신규)는 schematic LOD 200-300.
- **협업**: 완전 브라우저, 무설치; 실시간 환경분석/제너레이티브. **실시간 멀티유저 co-editing은 강조/소스 없음** — Forma의 "real-time"은 *분석 피드백*이지 Figma식 공동편집 아님.
- **인터롭**: **비중립 — Autodesk/Revit 잠김.** Revit = 첫 "Forma **Connected Client**"(양방향, native object, 파일교환 없음). IFC/OBJ import는 됨(reference/편집가능 지오로 변환), BUT **Forma에서 직접 중립 IFC export는 없음 — Revit 경유.** = 깨끗한 "웹+실시간-ish이나 비중립" 데이터포인트. 유저포럼이 native/IFC export 요청; Revit 커넥션 "not ready for production"(비판적 테스트).
- **모델링 깊이**: 개념 massing + (신규)schematic. 부지토포·massing·program/unit-mix; 제너레이티브 옵션. 진짜 기하 모델링 깊이는 제한.
- **타깃**: 건축가/도시계획가, 초기 부지+개념; 지금 schematic.
- **funding/성숙도**: Autodesk 소유(Spacemaker 2020 인수 ~$240M). Forma Site Design GA 2023-05. **Building Design: Revit 통합 2026-04 "Tech Preview", 2026 중 GA 예정.** 성숙한 모회사.
- **WEAKNESSES**: 벤더 잠김(Autodesk 생태계, Revit-경유 export, 중립 IFC out 없음); Revit 커넥터 not production-ready 비판; 개념 깊이 제한; 라이브 멀티툴 집계자 아님; "real-time" = 분석이지 멀티플레이어 아님.

### 2.5 Snaptrude (snaptrude.com)
- **포지셔닝**: AUTHORING 툴, 브라우저 협업 개념설계. "Figma for the construction industry" 마케팅 (S/SC — *자체* Series-A 블로그는 Figma 표현 안 씀; 포지셔닝은 진짜, 표현은 페이지마다 다름). 지금 "AI-Powered BIM software for Architects."
- **협업**: 클라우드-native, 브라우저; 멀티유저 동시 편집, checkout/sync 없음; 클라이언트 라이브 리뷰 참여. 실시간 tech 미명시(CRDT claim 없음).
- **인터롭**: import-replace (라이브 집계 아님). Import: Revit·DWG·SketchUp·Rhino·IFC. Export: Revit(.rvt 양방향 via "Snaptrude Manager" 플러그인)·IFC·DWG. **양방향 Revit 링크가 Speckle + Dynamo + Revit API 위에 빌드** (주목: 인터롭이 Speckle 의존). Revit 중심. 한 화면에 여러 라이브 외부모델 **안 가짐.**
- **모델링 깊이**: 개념/pre-detailed (LOD 100-250). "Sketch to BIM"; massing·form·iteration. wall thickness/MEP는 Snaptrude서 문서화 안 함 — 명시적으로 pre-full-BIM. 상세 개념 BIM은 Revit로 export.
- **타깃**: 건축가/설계팀, 개념~초기설계, 클라이언트 iteration. 고객: WeWork·Layton·Accenture(15+사).
- **funding/성숙도** (P/S): ~2020 설립 (인도/미국). **Seed $6.6M(2023초), Series A $14M(2023-11-09), 둘 다 Foundamental 리드 + Accel; 총 ~$20.6M.** GA, 활발히 출하(Snaptrude 3.0, Sketch-to-BIM). Accel 후원 VERIFIED.
- **WEAKNESSES**: 개념 전용(상세 BIM 저작 없음); Revit 중심 인터롭; 인터롭이 **Speckle 의존**(3rd-party 의존); import-replace(라이브 집계 아님); 대형 Revit 모델 성능 이슈(instancing으로 완화); 인터넷 의존.

---

## 3. SYNTHESIS — 포지셔닝 맵 + 불변 엣지/제약 분석 (게이트 비적용)

> 여기는 *분석*이다 — 위 VERIFIED 사실 위에 세운 판단. task가 명시적으로 사실과 분리 요구. advisor 가이드: posture가 prior 0-claim 실패의 원인이었으므로, 분석엔 kill-게이트를 적용하지 않는다.

### 3.1 판별 질문 — "저작 툴이냐 중립 허브냐"

각 제품에 advisor의 판별 테스트 적용: **너는 그 안에서 *설계*하는 저작 툴인가(design IN it), 아니면 외부 툴[Rhino+Revit+CAD]의 라이브 모델을 *집계*하는 중립 허브인가?**

| 제품 | 저작 vs 허브 | 라이브 멀티모델 집계? | 편집가능? | 중립? | 왕복(역write)? |
|---|---|---|---|---|---|
| Arcol | 저작 | ❌ (import-replace) | ✅ (자기모델) | 부분(Revit export, Rhino 미출시) | export-out만 |
| Snaptrude | 저작 | ❌ (import-replace) | ✅ (자기모델) | 부분(Revit/IFC, **Speckle 의존**) | Revit 양방향(Speckle) |
| Forma | 저작 | ❌ | ✅ (자기모델) | **❌ Autodesk 잠김** | Revit Connected Client만 |
| **Motif** | **허브** | **✅ Revit+Rhino 라이브** | **❌ 마크업만** | ❌ (Autodesk/McNeel, IFC 없음) | **코멘트만** |
| **Qonic** | 저작+조율 | ❌ (자기 federated IFC) | **✅ 실 지오** | **✅ IFC-native** | ❌ (Revit 단방향) |
| **Figcad** | **편집가능 허브 (목표)** | 🟡 ReferenceLayer dev-flag만 | ✅ pure-derive ops | ✅ 중립 설계 | ✅ `?op=apply` Pull/Push |

**핵심 관찰**: **"라이브 멀티모델 집계"와 "편집가능+왕복"을 동시에 하는 칸이 비어 있다.** Motif가 전자를, Qonic이 후자를 가졌으나 **교차 없음.** Figcad는 설계상 둘 다(왕복은 `?op=apply`로 실재, 라이브 집계는 ReferenceLayer dev-flag — `positioning-vs-mcp.md` §6의 미빌드 갭) 노린다.

### 3.2 포지셔닝 맵 (2축)

```
                    중립 (Switzerland)
                          ↑
              Qonic ●     |     ● Figcad(목표)
            (편집·IFC,     |    (편집·왕복·라이브집계
             역왕복 ✕)     |     — 라이브집계 미빌드)
                          |
   Motif ●               |
 (라이브집계·마크업만,     |
  Autodesk잠김)          |
 ─────────────────────────┼─────────────────────────→ 편집가능/왕복
              Snaptrude ● |  ● Arcol
            (Speckle왕복)  | (export-out)
                          |
                       Forma ●
                    (Autodesk 잠김)
                          ↓
                    벤더 잠김
```

- **세로축 = 중립성** (위=모든툴 중립, 아래=벤더 잠김). **가로축 = 편집가능+왕복** (오른쪽=편집해서 원본에 되씀).
- **viewer/editable 축**: Motif만 viewer-ish(마크업). 나머지는 다 editable이나 *자기 모델*만.
- **LOD 축**: Arcol·Snaptrude·Forma·Figcad = LOD 100-250(개념). Qonic = concept→construction(더 깊음, 실 지오). Motif = LOD 무관(저작 안 함, 스트림만).

### 3.3 Figcad는 어디에 유니크하게 앉는가

**유니크 칸 = "중립 ∩ 편집가능+왕복 ∩ 라이브 외부툴 집계 ∩ 웹+실시간."** 4중 교집합. **오늘 아무도 깨끗하게 점령 안 함** — 그러나:

- **Motif가 가장 가까운 *허브* 모양** (라이브 집계 + 웹 + 실시간 + 코멘트 왕복). **차이 = Figcad는 편집을 되쓰고(왕복), 중립이다(IFC).** Motif는 의도적으로 마크업-only + Autodesk-locked.
- **Qonic이 가장 가까운 *편집가능·중립* 모양** (실 지오 편집 + IFC-native + 멀티분야 federation + 웹+실시간). **차이 = Qonic은 자기 클라우드 IFC로 import하고 역왕복이 없다.** = destination 저작환경이지, 외부 툴 라이브 집계자가 아님.

### 3.4 정직한 차별화 — 얇은 곳을 크게 말한다

**advisor가 강조한 brutal version, 묻지 않고 전면에:**

1. **웹+실시간+"Figma for BIM"은 차별점이 아니다.** 4사가 한다. `hub-benchmark-review.md` §2가 이미 말했고 이 패스가 경쟁 데이터로 확증. AI도 table-stakes(`positioning-vs-mcp.md` §1).
2. **실차별점 = 중립 + 라이브 멀티모델 허브 + 왕복 = 4대 불변 중 *어느 것도 아니다*.** 불변(pure-derive·ops·렌더루프·펜터치)은 엔진 건강/UX지 전략 해자가 아니다. 해자는 *포지셔닝 선택*(중립·허브)이지 *불변*이 아니다.
3. **그 실차별점이 부분적으로 aspirational이다.** `positioning-vs-mcp.md` §6: ReferenceLayer = dev-flag, 프로덕션 UI 없음; import = doc-replace(한 번에 모델 하나). **즉 "라이브 멀티모델 허브"라는 핵심 약속이 거의 안 지어졌다.** 반면 **Qonic은 *지금* GA로 멀티분야 federation + 실 지오 편집 + IFC 중립을 한다.** Figcad가 약속만 한 영역의 큰 덩어리를 Qonic이 이미 출하 중이다.
4. **결론: 오늘 Figcad의 vs-Qonic 실우위는 (a) `?op=apply` 양방향 왕복**(Qonic은 Revit 단방향) **(b) 진짜 라이브 실시간 멀티플레이어 협업 *회의*면**(Qonic은 충돌없는 동기화이나 "회의"로 포지셔닝 안 함) **(c) Yjs true-CRDT/offline**(F1) **— 그리고 이것들조차 라이브 집계 허브 UI가 실재해야 의미가 생긴다.** 안 지으면 Qonic이 더 완성된 같은 카테고리다.

### 3.5 불변 ① (pure-derive) = 양날 — 솔직히

- **EDGE**: 지오 미저장·순수파생 → 깨끗한 객체단위 diff(F3), 깨끗한 파라메트릭 편집, 충돌없는 머지. 협업판으로는 더 깔끔한 변경모델 (`hub-benchmark-review.md` §7).
- **CONSTRAINT**: **brep를 ingest 못 한다.** VALIDATION_260416의 **72%가 Brep** = pure-derive 파라미터로 못 표현 → skip-and-count. **Qonic은 실 brep solid/NURBS를 Figcad가 derive 불가능한 스케일로 편집한다.** 즉 "실 모델을 편집"하는 영역에서 Qonic이 구조적으로 더 멀리 간다 — Figcad는 파라메트릭 어휘로 표현되는 것만 편집 가능(LOD 100-250 의도적 천장과 정렬되나, brep-heavy 실파일 ingest엔 실제 벽).
- **화해**: 이건 `geometry-representation-study.md` §9가 이미 답함 — F-rep 강등, import=lift-what-maps + Lane-2 잔여 + AI clean-up. **불변 ①을 버리지 말고, brep 잔여는 reference-layer 읽기메시로 집계**(편집 불가, 보기/조율만). 즉 Qonic식 "실 brep 편집"을 쫓지 않고, **편집 못 하는 brep도 라이브로 *모아 본다*** = 허브 정체성. 단 이 경로(ReferenceLayer 실 UI)가 미빌드라는 게 §3.4-3의 갭.

### 3.6 누가 Figcad를 죽일 수 있나 (위협 순위)

1. **Qonic** — 가장 위험. 편집가능+중립+실시간+웹을 *지금* 출하, 실 지오까지. **Figcad보다 카테고리상 더 완성됨.** 만약 Qonic이 (a) 외부툴 라이브 집계 + (b) 역왕복을 추가하면 = Figcad 칸 직접 침범. 막는 것 = Qonic이 부트스트랩(느림) + destination-저작 멘탈모델(허브 아님)에 갇힘 + "조율 회의" 포지셔닝 부재.
2. **Motif** — 둘째 위험. 최고 펀딩($46M), ex-Autodesk 팀, 유일한 라이브 집계. **만약 편집가능+IFC 중립을 추가하면** = Figcad 칸 침범. 막는 것 = 의도적으로 마크업-only 선택("안 만든다 또 다른 모델러"), Autodesk 잠김 전략적 베팅.
3. Arcol/Snaptrude/Forma = 다른 칸(단일모델 저작) — 직접 위협 낮음, 단 "Figma for BIM" 마인드셰어를 선점해 Figcad 슬로건 약화.

---

## 4. 권고 (정체성 게이트 통과 여부)

> `positioning-vs-mcp.md` §7 권고("멀티모델 라이브 허브를 실제로 켠다")를 경쟁데이터로 **확증·긴급화**.

1. **ReferenceLayer dev-flag → 진짜 UI 1순위.** 경쟁분석이 §6 갭을 확증: 그게 유일한 빈 칸이고, Qonic/Motif가 양쪽에서 다가온다. **이게 안 지어지면 Figcad는 vs-Qonic에서 덜 완성된 같은 카테고리.**
2. **왕복(`?op=apply`)을 마케팅 전면에.** Qonic의 명시적 약점(Revit 단방향) = Figcad의 검증된 우위. F1 Yjs CRDT/offline도(Motif/Qonic 다 CRDT claim 없음).
3. **"Figma for BIM" 슬로건 재고.** 점령됨(Arcol/Snaptrude). 더 날카로운 = **"BIM 조율의 Figma — 멀티툴 라이브 + 중립 + 왕복"** (단일모델 저작과 구분되는 *허브* 강조).
4. **불변 ① 유지 + brep는 reference-layer 읽기집계** (§3.5, `geometry-representation-study.md` §9). Qonic식 brep 편집을 쫓지 말 것 = 저작깊이 함정(off-identity).
5. **모니터링**: Qonic이 라이브 집계/역왕복 추가하는지, Motif가 편집/IFC 추가하는지 — 둘 다 직접 칸 침범 신호.

---

## 5. VERIFIED vs SYNTHESIS vs UNKNOWN (투명성)

- **VERIFIED (primary/직접확인)**: Motif 라이브 스트리밍+코멘트만 역동기화+IFC없음(자체 페이지 직접 fetch); Arcol→Liveblocks; Motif $46M/founders/2025-03; Qonic ex-Bricsys+IFC-native+자력+Revit 단방향 import+federation; Snaptrude $14M Series A(Foundamental/Accel)+Speckle-based Revit 링크; Forma Revit Connected Client 잠김+IFC는 Revit 경유만.
- **SELF-CLAIMED (마케팅, 회의적)**: "Figma for BIM/construction"(Arcol·Snaptrude — 포지셔닝 사실로는 참, 기술 claim 아님); Motif/Qonic/Snaptrude 실시간-멀티유저 claim(공개 tech 디테일 없음).
- **SYNTHESIS (이 문서 분석, 게이트 비적용)**: 포지셔닝 맵 좌표, 엣지/제약 판단, 위협 순위, "유니크 칸 비어있음" 결론. = 검증된 fact가 아닌 *판단*.
- **UNKNOWN (정직하게)**: Qonic 커널(ACIS vs 미공개); Motif가 >2 소스툴 동시집계 하는지(plausible이나 Revit/Rhino만 구체); **5사 중 누구도 CRDT/Yjs 공개 claim 없음**(Figcad의 Yjs는 차별 가능성이나 그들이 내부적으로 뭘 쓰는지 unknown); Arcol Series A 금액; Forma 멀티플레이어 co-editing(소스 없음). 이 unknown들은 "결론 0"의 사유 아님 — 위 분석은 verified 사실 위에 선다.

---

### 한 문장 요지
> "Figma for BIM" 슬로건과 웹+실시간은 **이미 경쟁사가 점령** — 차별점 아님. Figcad의 진짜 빈 칸 = **중립 ∩ 편집가능+왕복 ∩ 라이브 외부툴 집계** 4중 교집합 (Motif는 집계만·마크업, Qonic은 편집·중립이나 역왕복 없음 — 교차 없음). **하지만 그 차별점은 4대 불변이 아니라 포지셔닝 선택이고, ReferenceLayer 미빌드라 부분적으로 aspirational** — Qonic이 인접 카테고리를 *지금* GA로 더 완성. 불변 ①은 양날(diff 엣지 / brep ingest 제약). **권고 = 라이브 허브 UI를 켜라(1순위), 왕복·CRDT를 마케팅 전면에, brep는 reference-layer 읽기집계로(불변 ① 유지).**
