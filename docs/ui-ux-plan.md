# Figcad UI/UX 정리 — 개념 카테고리 + 재구성 계획

> 2026-06-23. 트리거: "지금 구현한 기능을 concept별로 카테고라이징 → 그 위에서 UI/UX 구성 계획".
> 2단계 분리: **Part 1 = 개념 분류(중립·서술)** · **Part 2 = 재구성 계획(분류 위에서)**. 권위 기준 = `positioning-vs-mcp.md`(편집가능 중립 조율 허브 / 해자=실시간·웹·중립 / 멀티모델 허브가 진짜 가치갭) + `hub-benchmark-review.md`.
> 분류 = 전수 코드 인벤토리(8 서브시스템 ~80 기능) 근거. **핵심 원칙: 1 개념 = 1 UI 홈** — 이것이 오버랩(스토리전환 2곳·뷰상태 3곳·변환 3곳·속성편집 4곳)을 녹이는 치료제.

---

## Part 1 — 개념별 기능 분류 (무엇을 만들었나)

분류는 **사용자 관점 능력(capability)** 기준, UI 위치 아님. 정체성 3축(웹·실시간·AI) 중 **실시간·AI = 축**, **모델링 = substrate(축 아님, table-stakes 토대)**. 나머지(문서·검증·뷰·입력)는 보조 substrate. 멀티모델 허브 = 중립 해자의 구현체.

성숙도 표기: ✅shipped · 🟡partial · 🔒hidden/dev-flag.

### 1. 모델 저작 (Authoring) — 파라메트릭 어휘 [substrate]
*포지셔닝: 입력 UI는 가볍게, 파라메트릭 어휘는 풍부하게.*
- **요소 배치** — 14 kind 그리기 도구: 벽·문·창·슬라브·그리드·기둥·보·계단·난간·지붕·커튼월·존·텍스트·레이블·치수 ✅
- **요소 편집** — SelectTool(픽/박스선택/직접드래그·핸들·그립) ✅ + EditActions 7변환(이동·복사·배열·대칭·분할·연장/자르기·회전) ✅
- **파라메트릭 속성** — InfoBox 인스턴스 편집(kind별 치수·높이·오프셋…) ✅
- **타입/패밀리** — Navigator 타입 정의(두께·단면·개구부치수…), 인스턴스 참조 ✅
- **레벨/층** — elevation·height·order, 캐스케이드 삭제 ✅
- **ops** — create/update/delete/move/rotate/transformCopy/split/trim (모든 변경의 단일 경로) ✅

### 2. 실시간 협업 (Real-time) [축 = 헤드라인 해자]
*포지셔닝 §2: 실시간+웹은 데스크톱이 구조적으로 못 따라옴. **그런데 UI 노출은 가장 얇다.***
- **Presence** — 멀티플레이어 커서 콘+이름라벨 ✅ · 연결상태 점 ✅ · 동시작업 인원수(텍스트만) ✅ · 선택 공유(원격 하이라이트 틴트) ✅ · 소프트락(편집중 advisory) ✅
- **공유/룸** — 프로젝트=`?p=` 룸, 공유=주소창 URL 복사 🟡 (Share/초대 버튼 없음)
- **사용자 정체성** — 자동 게스트명+팔레트색 🔒 (rename UI 없음)
- **Undo/Redo** — per-user(LOCAL_ORIGIN, 내 변경만), Ctrl+Z / 2·3손가락 탭 ✅ (온스크린 버튼 없음)
- **코멘트/리뷰** — 핀+스레드+resolve+점프, 문서 동기화(awareness 아님) ✅
- **버전/히스토리** — 커밋 스냅샷·타임라인·diff·복원·fork ✅ (3D 시점 미리보기 v1.5)

### 3. AI [축 = table-stakes]
*포지셔닝: AI는 잘하되 방어선 아님. 파라메트릭 어휘가 AI 천장.*
- **자연어 모델링 챗** — 한국어 요청→계획 스트리밍→승인 게이트 ✅
- **손그림 스케치→평면** — Sketch 도구 펜드로우→PNG+mm프레임→Claude ✅
- **에이전트 편집** — 기존 요소 자연어 수정(26 도구 카탈로그) ✅
- **applyOpLog 승인 게이트** — 계획 검토→승인/거부, ops 재생(undo·collab 무료) ✅
- **lint-in-loop critic** — 결정론적 lint 자기검증(2라운드) before 승인 ✅
- 서버 에이전트 루프 — 키 서버측, dry-run, SSE ✅ (남은 사용자작업=AI키)

### 4. 멀티모델 허브 — 연동·교환·커넥터 [중립 해자 / 진짜 가치갭]
*포지셔닝 §6: "import는 문서를 교체 = 한 번에 모델 하나"가 미빌드 갭. §8: ingest = PR primitive.*
- **4a. 연동 (Reference overlay, 비파괴)** — 다른 Figcad 룸 ✅ · glTF 업로드 ✅ · IFC 메시 오버레이 ✅ · .3dm 메시 🟡(버튼 라벨이 'glTF/IFC'라 발견 불가) · 3D-Tiles 🔒(extractor 없음) · 소스 관리(가시성토글·상태점·제거) ✅ · projectOrigin 정렬(자동) ✅
- **4b. 교환 (Convert in/out)** — IFC/.3dm/DXF export ✅ · JSON 백업 export/import ✅ · IFC import ✅ · .3dm/DXF import 🟡 · **import = 문서 전체 교체(파괴적)**
- **4c. 커넥터 (라이브 툴 왕복)** — Rhino Pull(허브→Rhino) 🟡 · Push(Rhino→허브) 🟡 · PushBreps(솔리드 일괄 ingest) 🟡 · live-write 백엔드(?op=apply/pull/origin) ✅ · 블롭 업로드/서빙 백엔드 ✅
  - 커넥터 진입은 전부 Rhino 안 — **Figcad-web UI 없음**(상태 표시도 없음)

### 5. 문서·도면 (Document / 2D) [substrate]
- **도면 뷰** — 평면/단면/입면 2D 라인워크 뷰어(휠줌·드래그팬) 🟡(인라인스타일·모달·인쇄시트 아님)
- **단면/입면 도구** — 선 그어 뷰 생성 ✅ (단 **Toolbox에 없음** — DrawingPanel '+단면/+입면' 안에만)
- **주석** — 치수·텍스트·레이블(목적=문서화, 모델요소와 구분) ✅
- **도면 DXF export** — 뷰별 2D 납품(전체모델 plan DXF와 별개) ✅

### 6. 검증 (Validate / data hygiene) [substrate]
- **lint 11 규칙** — missing-ref·orphan·misfit·duplicate·overlap·unjoined·extreme… ✅
- **검사 패널** — 심각도 정렬·점프·원클릭삭제수정·디바운스 ✅
- **검사 배지** — QuickOptions 카운트+최악심각도 틴트 ✅
- **협업 병합 배너** — 원격 머지가 새 문제 유발 시 알림(flag-not-block) ✅
- **기하이동 자동수정**(미접합 치유·겹침 nudge) 🔒 v1.5 (삭제기반 수정만 ship → fix버튼 불일치)

### 7. 뷰·탐색 (Viewport / Navigate) [substrate]
- 3D↔평면 토글 ✅(Navigator에 묻힘) · 활성 스토리 전환 ✅(2곳 중복) · zoom-to-fit ✅(F키만) · 키보드 줌/팬 ✅ · 요소 점프 포커스 ✅ · 북향 스냅(자동) ✅ · 평면전환 트윈 ✅ · 비활성 스토리 고스팅 ✅ · 그리드/지면/라이팅 씬 ✅ · render-on-demand·적응DPR ✅

### 8. 입력 (Input modality) [substrate / 불변 규칙 4]
- 펜=도구 ✅ · 터치=카메라 ✅ · 팜리젝션 ✅ · 마우스 Rhino 바인딩 ✅ · RMB=Enter/체인확정 ✅ · 2·3손가락 탭=undo/redo ✅ · 제스처취소 안전 ✅
- **per-tool 단축키 없음** (Esc/Delete/undo/zoom-pan만) — 데스크톱 효율 갭

### 분류의 payoff — 1 개념 = 1 UI 홈
인벤토리가 찾은 오버랩은 전부 "한 개념이 여러 집을 가짐"의 증상. 개념 홈을 못박으면 자동 해소:

| 오버랩 (현재) | 개념 홈 (분류상) |
|---|---|
| 스토리 전환 — Navigator + QuickOptions 2곳 | **7. 뷰·탐색** |
| 뷰 상태 — QuickOptions·Navigator·DrawingPanel 3곳 | **7. 뷰·탐색** |
| 변환 — SelectTool드래그·EditActions·AI 3곳 | **1. 저작/편집** (한 개념, 입력경로 3개는 OK) |
| 속성 편집 — InfoBox·Navigator타입·AI·드래그 4곳 | **1. 저작** (인스턴스=InfoBox, 타입=Navigator 역할분리) |
| IFC/.3dm — 교환(교체) vs 연동(오버레이) 같은 파일 | **다른 개념** 4a vs 4b → UI에서 반드시 분리 |
| DXF export — 전체plan vs 뷰별 2곳 | 전체=4b 교환 · 뷰별=5 문서 |

---

## Part 2 — 재구성 계획 (분류 위에서)

### 원칙 3개
1. **1 개념 = 1 UI 홈.** 패널 진입 메커니즘 단일화(현재 3종: QuickOptions토글·도구선택 부작용·항상켜짐·Navigator클릭 혼재).
2. **정체성 순서로 노출.** 실시간·허브 = 해자 → 프라임 자리. 모델링 = substrate(어휘 풍부·입력 UI 가볍게, 포지셔닝). 현재는 정확히 반대(실시간 최약·모델링 최강 노출).
3. **iPad-first 어포던스.** 핵심 동작(undo/redo·fit·뷰토글)에 온스크린 버튼. 키보드/제스처 전용 금지.

### P0 — 정체성 갭 (포지셔닝 권위 직결, 먼저)

**P0-1. 연동(오버레이) vs 교환(교체) 분리 — 파괴적 모호성 제거.**
현재 Navigator 우측에 '교환'과 '연동'이 인접, 같은 IFC/.3dm를 받지만 결과 정반대(교환=문서 전체 교체 파괴적 / 연동=읽기전용 오버레이). 라벨이 결과를 안 알림 → "Rhino 참조로 가져오기"가 문서 삭제로 직행 가능. 포지셔닝 §6이 명시한 #1 가치갭(멀티모델 허브)을 정면으로 훼손.
- **연동(Reference)을 프라임 경로로 승격** — 멀티모델 오버레이가 허브의 본질. 발견성↑.
- **교환 import를 PR/staging 흐름으로 재구성** (포지셔닝 §8: import = PR 올림 → staging clean-up → merge). 즉시 문서교체 금지, 명시적 머지 게이트. 최소한 파괴적 경고+별도 구역.
- .3dm 연동 발견성(버튼 라벨), 3dtiles 배지·demo박스 등 vestigial 정리.

**P0-2. 실시간을 1급 UI로 — 해자 가시화.**
해자(실시간)가 UI 최약. 현재: 인원수 텍스트뿐, Share 없음, rename 없음.
- **Share/초대 버튼** (현재=주소창 URL 수동복사).
- **아바타 파일(presence row)** — Figma류, 인원수 텍스트 대체.
- **인라인 rename** (게스트명 탈출).
- **코멘트 패널을 코멘트 도구와 분리** — 리뷰 패널을 도구 무장 없이 열기.
- (선택) 커넥터/Rhino 동기화 상태를 web에 표시 — 툴↔허브 경계 가시화.

### P1 — 표면 일관성 (오버랩 해소)
- **패널 진입 단일화** — AI·검사·버전·코멘트·도면 한 런처(예: 우측 아이콘 독 or 하단바 일관 행). 코멘트=도구 부작용 제거.
- **단면/입면 도구를 Toolbox로** — '모든 도구는 Toolbox' 모델 복원(현재 DrawingPanel 안에만).
- **뷰·스토리 = 뷰포트 컨트롤로 단일화** — 3D/평면 토글·스토리 전환·fit·undo/redo를 캔버스 코너 컨트롤 클러스터로(iPad 어포던스 + 중복 제거).
- **InfoBox 과부하 분해** — 현재 5역할(도구설정·인스턴스편집·다중선택요약·타입선택·힌트) 한 스트립. 인스턴스 속성을 전용 패널로 분리 검토. 복잡 편집기(커튼월·지붕 슬로프·레이블 템플릿)는 스트립 부적합.
- **검사/버전 슬롯 공유 해제** — 무관 기능 강제 배타 제거.

### P2 — 마감/일관성
- DrawingPanel을 glass 스타일+도킹으로(모달·인라인스타일 outlier 해소), 장기=인쇄시트.
- lint fix버튼 일관성(미접합/겹침 무수정 사유 표기 or v1.5 치유 도입).
- per-tool 단축키 어포던스 예약(데스크톱 절반).

### 목표 영역 배치 (스케치)
- **좌 레일 = 내가 하는 일(도구/모드)** — 개념 그룹화: 선택·편집 / 모델(구조·외피·공간) / 주석·도면(단면입면 포함) / AI.
- **우 레일 = 프로젝트(Navigator)** — 프로젝트맵(스토리·3D·도면) / 타입 / **연동(허브, 프라임)** / 교환(PR게이트, 분리·경고).
- **상단 우 = 협업 홈** — Share + 아바타 파일 + rename.
- **캔버스 코너 = 뷰포트 클러스터** — undo/redo · fit · 3D/평면.
- **하단 바 = 상태** — 연결·인원(아바타로 승격)·활성스토리·뷰라벨 (패널토글 잡탕 제거).
- **속성** — 단일 홈(전용 패널 or 슬림화한 InfoBox).
- **패널 런처** — 단일 메커니즘: AI·검사·버전·코멘트·도면.

---

## Part 3 — 결정 필요 (the fork)
범위 선택이 하류 전부를 가름:
- **A. 점진 정리** — 현 ArchiCAD 도킹 유지, 오버랩·갭만 수술(P0+P1 일부). 저위험, 빠름.
- **B. 구조 재구성** — 정체성 순(실시간/허브 우선) 레이아웃 재설계. 해자 가시화 최대, 비용 큼.

→ **결정됨 (2026-06-23): B. 전면 구조 재구성.** 정체성 순(실시간·허브 우선) 레이아웃 재설계, ArchiCAD 차용 탈피. 타겟 레이아웃 스펙 = Part 4.

---

## Part 4 — 추천 타겟 레이아웃 (전면 구조 재구성)

> 설계 방법: 3 독립 컨셉(Figma-for-BIM / 모드스위처 / 캔버스우선) → 3 렌즈 심사(해자노출·불변실현성·iPad+데스크톱) → 합성. **Synthesis basis:** Base = Concept 2 (Moat-Frame + Mode-Swapped Core) — won invariant-feasibility (5) and ergonomics-dual (4). Graft = Concept 1's always-on hub strip + source-tool badges (lifts C2's only weakness: hub gated behind a mode, capping moat-exposure at 4) and Concept 3's bottom-corner thumb map + orthogonal keyboard layer + "moat is the only undismissable chrome" discipline. Fatal flaws avoided: C1's Sheet-as-canvas-mode render-pipeline risk (deferred to last slice), C3's near-selection popover #3 hazard (rejected in favor of a persistent docked inspector).

### 1. THESIS

**A persistent moat-frame wraps a mode-swapped core.** The frame — which never unmounts — renders BOTH moat axes permanently in prime real estate: real-time presence (top-right) and the multi-model hub stack (top-center), with neutral made literal via source-tool badges on every model chip. Inside the frame, one left rail + one right inspector reconfigure per identity-ordered task-mode (협업·리뷰 · 모델 · 허브 · 도면), so no surface is overloaded and every capability has exactly one home. The moat is the headline; substrate is the swappable interior. **Identity order, not ArchiCAD's palette order.**

### 2. SURFACE MAP

#### Persistent moat-frame (never unmounts)

| Zone | Screen position | Owns (categories) | On |
|---|---|---|---|
| **Doc menu + room name** | top-left | ☰ menu: JSON backup/restore (the ONLY true doc-replace, confirm-gated), interop EXPORT (IFC/.3dm/DXF/JSON), settings · room name click-to-rename | always |
| **Mode tabs** | top-center-left | 4 identity-ordered tabs: 협업·리뷰 \| 모델 \| 허브 \| 도면 (large tap targets) | always |
| **Hub strip** (C1 graft) | top-center | **4a** federated-model chips (source-tool badge + color dot + eye-toggle) · **4c** connector live-link chip · single **+Add model** entry | always |
| **Presence strip** | top-right | **2** avatar pile (color=cursor, tap=follow) · Share (URL+role+QR) · connection dot · comment badge · **6** lint severity badge · **3** AI toggle | always |
| **Canvas** | center, full-bleed | **7** viewport · imperative HUD (cursors/dim-chips/labels/pins/ghosting) · **8** InputManager surface | always |
| **Viewport cluster** (C3 graft) | bottom-right (thumb zone) | **7** 3D/plan toggle · active-story stepper (SINGLE owner) · fit · north-up · ghosting toggle · jump-to-element · **8** on-screen undo/redo | always |
| **AI dock** | right edge, collapsible | **3** NL chat · agent edit (26-tool) · applyOpLog approval gate · lint-in-loop critic · Sketch entry | ambient (toggle) |

#### Mode-swapped core (mounts/unmounts on `activeMode`)

| Zone | Position | Per-mode content |
|---|---|---|
| **Left rail** | docked left, collapsible | **협업·리뷰:** comment threads + version timeline + lint findings (3 sections) · **모델:** 14 draw tools + 7 transforms + Select · **허브:** federation source mgmt + interop import-staging + connector Pull/Push/PushBreps · **도면:** view list + section/elevation tools + annotation tools |
| **Right Inspector** | docked right, persistent shell, **selection-driven** | **모델:** instance props + Types/families editor + EditActions transform strip · **협업:** selected thread / version diff · **허브:** selected source align (projectOrigin) + merge-staging gate · **도면:** view props (scale/cut-height) |

Inspector 셸은 항상 도킹(데스크톱 dense 수치입력 위해 keyboard-tabbable — C3 popover 밀도 갭 회피); *내용*은 selection × mode로 키잉.

#### strip↔mode 경계 규칙 (하드 불변 — QuickOptions+Navigator 중복 재발 방지)

> **strip은 glanceable STATUS + 단일 entry/toggle 소유. mode는 WORKING surface 소유. strip은 자기 mode가 소유한 컨트롤을 절대 렌더 안 함 — 요약하고 mode로 링크만.**

- Hub strip = 모델 칩(status) + `+Add model`(entry) + 가시성 토글. 소스 *관리*(제거·정렬·import-staging)는 허브 mode.
- Presence strip = 아바타 + Share + 연결점 + 배지(status/entry). 스레드 *읽기/답글*·버전 *타임라인*·lint *findings*는 협업·리뷰 mode.
- view/story에 부여한 "단일 권위 소유자" 규율과 동일. 새 기능에 이 경계를 명료히 못 쓰면 안티패턴 재발 신호.

### 3. CATEGORY HOMES

| # | Category | Single home | Entry |
|---|---|---|---|
| 1 | 모델 저작 | **모델 mode**: 좌레일(draw+transforms), 우인스펙터(props+types+EditActions strip) | mode 탭 / 핫키 2 / Cmd-K; 요소 선택→인스펙터; 배치전 도구 컨텍스트=레일 옵션행(`InfoBoxToolContext` 흡수) |
| 2 | 실시간 협업 | **Presence strip**(항상) + **협업·리뷰 mode** 레일(스레드/버전) | strip 항상; Share 초대; peer 탭=follow; 코멘트 배지로 어느 mode서나 스레드 점프 |
| 3 | AI | **AI dock**(ambient, 전 mode) | top-right AI 토글 / Cmd-K "ask AI"; Sketch는 dock 안에서 무장 |
| 4a | 연동/Federation | **Hub strip**(칩, 항상) + **허브 mode**(소스 관리) | `+Add model` → "Layer in"(기본, 안전) |
| 4b | 교환/Interop | EXPORT=☰ Doc 메뉴 · IMPORT=**허브 mode** staging gate | `+Add model` → "Merge into document"(staged) |
| 4c | 커넥터/Connector | **Hub strip** 칩(status) + **허브 mode** Pull/Push/PushBreps | 칩=라이브 Rhino 세션; mode=왕복 액션 |
| 5 | 문서·도면 | **도면 mode**: 뷰 리스트 + 단면/입면/주석 도구(레일); 뷰 props(인스펙터) | 도면 탭 / 핫키 4 / 뷰 클릭; 뷰별 DXF=☰ export |
| 6 | 검증 | **lint 심각도 배지**(presence strip) + **협업·리뷰 mode** lint 섹션 | 배지→협업 lint 섹션; 머지 배너 ingest 후 딥링크 |
| 7 | 뷰·탐색 | **Viewport cluster**(bottom-right) — view mode+active story 단일 출처 | 항상 버튼 + 데스크톱 핫키; 트리/strip은 state SELECT만, 위젯 복제 안 함 |
| 8 | 입력 | **InputManager**(chrome 없음) + viewport cluster 온스크린 미러 | pointer-implicit; iPad는 cluster 버튼으로 undo/redo/fit/view |

### 4. THE SINGLE LAUNCH RULE

> **활성 MODE가 working surface(좌레일+인스펙터 내용) 마운트. SELECTION이 인스펙터 채움. moat-frame은 절대 unmount 안 함. AI dock과 viewport cluster만 ambient 토글. 그 외 floating·독립 토글 없음.**

현재 3 진입 메커니즘 전부 제거:
- **QuickOptions 패널토글 행 없음** — QuickOptions 해체(연결→presence strip, story/view→viewport cluster, lint/version/drawing/AI→각 mode/dock).
- **도구선택 부작용 없음** — `uiStore.ts` L116–125 `setTool` 분기 제거(`sketch`→`aiOpen`+`viewMode:'plan'`, `comment`→`commentsOpen`). 도구는 도구만 무장.
- **Navigator-클릭 런치 없음** — 트리 클릭=state SELECT(`activeViewId`/`activeLevelId`), 컨트롤 스폰 안 함.

`uiStore.ts` L132–134 강제 배타(`setLintOpen`/`setVersionOpen` 상호 클리어)도 삭제 — lint/version이 협업 레일 독립 섹션 → "슬롯 공유" 갭이 state 층에서 소멸.

**선언된 단 하나의 예외:** Sketch-to-model은 AI dock에서 무장(panel→tool, 스케치 펜). 반대 방향 "도구는 패널 안 띄움" 유지; 위반으로 안 읽히게 문서화.

mode 전환 간 per-mode UI 상태(마지막 도구·스크롤·선택) 기억.

### 5. P0-1 — 연동(overlay) vs 파괴적 import (PR/staging/merge, 포지셔닝 §8)

같은 IFC/.3dm/DXF가 인접·동일문구 버튼에서 정반대 결과 내면 안 됨. **안전 기본 + 게이트된 escalation으로 분리, 동사와 게이트로 구분.**

**단일 ingest 진입:** Hub strip `+Add model`. 어떤 외부 모델(Figcad 룸·glTF·IFC 메시·.3dm 메시·import 의도 파일)이든 FIRST로 읽기전용 OVERLAY 착지(비파괴, 소스배지 칩). 이게 프라임 "모델 가져오기" 동사 = "import=한번에 하나 교체"를 진짜 라이브 허브로 전환.

**Escalation (PR primitive):** 오버레이 칩 메뉴 **"Merge into document…"** → 허브-mode 인스펙터 staging gate:
- native Figcad kind로 lift되는 요소 표시(`docs/brep-lifting-2026.md`: lift되는것 표면화+residual 플래그+AI clean-up — full-fidelity 아님),
- 후보에 lint-in-loop,
- 현 문서와 diff,
- **기본 결과 = ADDITIVE** — "변환 요소를 라이브 문서에 INTO 머지"(append, 기존 지오와 공존; one-model-at-a-time 진짜 탈출). **DocStore ops 1 undo 스텝**으로 커밋(불변 #2).

**진짜 replace는 추방.** 문서 전체교체(`importFile` replace, "JSON 가져오기 교체" `Navigator.tsx` L226–229)는 ☰ Doc 메뉴로 — confirm 게이트·distinctly-worded restore/new-file, ingest와 절대 인접 안 함.

**인접 동일문구 두 업로드 삭제:** `Navigator.tsx` L243–250(`importFile`)와 L266–273(`uploadFederationFile`) → 단일 `+Add model` overlay-first로 합침.

> **스코프 sharpening:** SAFETY(전 ingest를 overlay-default로 우회·두 업로드 삭제·파괴 경로를 Doc 메뉴 confirm 뒤로)는 **순수 reuse**(`FederationReconciler` 이미 오버레이, `importFile` 이미 교체) → 신규 지오 코드 0, P0 슬라이스. ADDITIVE merge-as-ops 게이트가 **net-new**(리콘실러는 ReferenceLayer *메시* 산출, ops 아님) = **최대 리스크.** 안전 우회 ≠ additive 머지.

### 6. P0-2 — 실시간 1급화

Presence strip(top-right)이 최약 moat을 최강 chrome으로, **협업·리뷰가 DEFAULT 랜딩 mode**(협업자 첫 화면=툴박스 아닌 moat; 빈/신규 룸은 Share-first empty state=온보딩):

1. **아바타 파일** — 라이브 peer, 각 커서색; 탭=follow/jump. "N명 동시작업" 텍스트 대체(QuickOptions L42–44).
2. **Share 버튼** — 룸 URL + role + **크로스기기/iPad QR**(현 URL복사-only 대체).
3. **Rename** — 내 아바타 탭→표시명(Share에도), 게스트명 탈출.
4. **연결점** — live/connecting/offline(QuickOptions L40 이전).
5. **코멘트 도구 분리** — 읽기/답글은 활성도구 무관 협업 레일 상주; 코멘트 *도구*는 핀만; strip 배지로 어느 mode서나 스레드 점프.
6. **버전/히스토리** — 협업 레일 1급 섹션(commit/diff/restore/fork), lint와 슬롯 공유 안 함.
7. **커넥터 상태** — Rhino 세션 라이브 시 Hub strip 칩.

> **#3 함정:** 아바타 파일은 **derived peer-IDENTITY selector**(join/leave/rename/color만)에 바인딩 — 매 커서이동에 발화하는 raw CRDT awareness 금지(프레임당 React thrash). 파일=React(identity), 커서위치=imperative HUD. Hub-strip 칩은 `SOURCE_BADGE`(이미 `useNavigatorFederation`) 재사용.

### 7. iPAD + DESKTOP

**동일 레이아웃; 입력 어포던스만 다름.**

- **iPad-touch:** Viewport cluster(bottom-right 엄지존)가 온스크린 undo/redo+fit+3D/plan+story stepper → 불변#4 필수에 핫키 불요; mode 탭+Share+hub 칩+아바타=큰 탭타깃; 레일은 얇은 엣지로 접혀 캔버스 최대; Share QR로 2번째 기기 동일 룸 온보딩. 반응형 collapse(C1): narrow/portrait서 아바타→"+N", hub 칩→"N models" — **단 0으로는 절대 안 됨**(주 기기서 moat 헤드라인 생존); 우패널 열면 인스펙터가 그 밑으로 접힘(우 컬럼 1개씩).
- **Desktop-CAD:** mode 핫키 1–4 + Cmd/Ctrl-K 명령 팔레트; **InputManager와 직교하는 키보드 핫키 LAYER**(C3)로 진짜 per-tool 키(W=wall, F=fit)를 불변#4 안 건드리고 ship(#4는 pen-vs-touch POINTER 분기 지배, 키보드는 캔버스 밖 바인딩). 마우스 Rhino 바인딩+RMB=Enter 유지; 인스펙터 keyboard-tabbable; 레일 dense 핀.

### 8. INVARIANT COMPLIANCE

**#3 (React 패널만; 렌더루프 DOM 없음):** 모든 신규 surface(top bar·hub strip·presence strip·mode 레일·인스펙터·viewport cluster·AI dock)=discrete store/presence-identity/selection/mode 변경에만 리렌더, 프레임당 아님. 캔버스=render-on-demand rAF. 렌더루프 분할 명시:
- 아바타 **PILE**=React(identity) / 아바타 **CURSOR**=imperative HUD(`hud/`);
- EditActions **strip**=React(selection) / 온캔버스 transform **gizmo**=engine;
- hub **칩**=React / federated **geometry**=engine/`ReferenceLayer`.
- 커서·dim-chip·라벨·코멘트핀·소프트락/선택 틴트·story ghosting·sketch ink 전부 imperative HUD 유지. 도킹 인스펙터(near-selection popover 아님)라 프레임당 앵커링 해저드 0 (C3 리스크 설계로 제거).

**#4 (pen=tool/touch=camera/팜리젝션):** 불변, `input/InputManager.ts` 격리. mode 전환=어떤 React chrome 마운트, 입력 분기와 직교 — pointer arbitration 안 건드림. 패널 런치·viewport 버튼=명시적 탭, 캔버스 제스처 아님 → pen-draw/pinch-camera와 충돌 불가. 2/3손가락=undo/redo·Sketch 펜 불변. 데스크톱 키보드 레이어 직교(캔버스 엘리먼트 밖 바인딩).

### 9. MIGRATION ORDERING

각 슬라이스 독립 shippable, 일관 앱 유지. 현 `App.tsx`: Toolbox · InfoBox · EditActions · Navigator · QuickOptions · AiPanel · LintPanel · VersionPanel · CommentPanel · DrawingPanel.

#### P0 — moat + safety (낮은 엔진 리스크, 대부분 reuse)
- **Slice 0 — state 위생(전부 upside, UI 없음):** `uiStore.ts`서 `setTool` 부작용(L116–125→균일 reset) 제거, lint/version 배타(L132–134→독립) 드롭, `activeMode: 'review'|'model'|'hub'|'drawing'` 추가. 사소·전체 언블록.
- **Slice 1 — Presence strip (P0-2 헤드라인):** 신규 `PresenceStrip.tsx`+`TopBar.tsx` 셸. 아바타 파일=`collab/presence.ts` 위 derived peer-identity selector; Share+QR; 연결점+rename. 연결/peer를 QuickOptions서 이전. *먼저 ship — moat이 최약→최강.*
- **Slice 2 — Hub strip + ingest SAFETY (P0-1 안전 절반, 순수 reuse):** 신규 `HubStrip.tsx`=`store.listFederationSources()` 칩+`SOURCE_BADGE`+eye-toggle+`+Add model`. 인접 두 업로드(`Navigator.tsx` L243–250, L266–273) 삭제→단일 overlay-default. `importFile`-replace+"JSON 가져오기 교체"(L226–229)를 ☰ Doc 메뉴 confirm 뒤로. 신규 지오 코드 0.

#### P1 — 구조 재구성 (React recomposition)
- **Slice 3 — mode 스켈레톤(dead 탭 없이):** `TopBar`에 4탭+`activeMode`; `App.tsx`=moat-frame+mode-swap. **모델 mode 실배선**(Toolbox→레일, InfoBox/EditActions→인스펙터)과 함께 착지; 협업/허브/도면 탭=disabled "곧".
- **Slice 4 — 모델 인스펙터 분할:** InfoBox 5역할 해체 — `InfoBoxEditors`→인스펙터 props, `InfoBoxTypeSelect`+`NavigatorTypeEditor`→인스펙터 types, `InfoBoxToolContext`→레일 도구옵션행, `EditActions`→인스펙터 transform strip.
- **Slice 5 — 협업·리뷰 mode:** `CommentPanel`(스레드)+`VersionPanel`+`LintPanel`→레일 섹션; 코멘트 도구 분리(핀만). 협업=default 랜딩+Share-first empty state.
- **Slice 6 — 허브 mode:** `useNavigatorFederation`+`useNavigatorIO`→허브 레일(소스관리·interop·커넥터 Pull/Push/PushBreps); align(projectOrigin)=인스펙터.
- **Slice 7 — Viewport cluster + QuickOptions 해체:** `viewMode`+`activeLevelId`(현재 Navigator L108–176 + QuickOptions 양쪽)를 단일 bottom-right 위젯으로; 온스크린 undo/redo/fit 추가. `QuickOptions.tsx` 삭제.
- **Slice 8 — AI dock ambient:** `AiPanel`을 collapsible 우 dock으로 re-parent; Sketch 무장을 안으로.

#### P2 — 최대 리스크 (마지막으로 연기)
- **Slice 9 — additive merge-as-ops 게이트 (P0-1 net-new):** 오버레이→native kind lift(`brep-lifting-2026.md` 스코프), lint-in-loop, diff, DocStore ops 1 undo 스텝 커밋. **← 최대 리스크.**
- **Slice 10 — 도면 mode + Sheet:** `DrawingPanel`을 도면 mode 안에 먼저 마운트(reuse). full sheet-as-canvas-mode(라이브 캔버스 공유)=**2번째 리스크**(Engine/SceneManager/CameraRig) — 절대 마지막, DrawingPanel-in-mode fallback.
- **Slice 11 — 데스크톱 핫키 레이어 + Cmd-K 팔레트**(InputManager 직교).

#### 최대 리스크 (플래그)
**additive merge-into-document-as-ops 게이트(Slice 9).** `FederationReconciler`/extractor는 오늘 `ReferenceLayer` *메시* 산출, DocStore ops 아님 — 머지 경로 어디도 reuse 아니고, 불변#2 위해 ops 경유하며 import-lifting fidelity 천장 안에 머물러야. 먼저 스파이크("lift되는것 표면화+residual+AI clean-up" 스코프). Slice-2 안전 우회는 이에 의존 안 함 → P0-1 *안전* 승리는 머지 게이트 전에 ship. 2번째: Sheet-as-canvas-mode(Slice 10) — 패널 recomposition 떠나 렌더파이프 건드리는 유일 항목; 마지막+DrawingPanel-in-mode fallback 뒤.
