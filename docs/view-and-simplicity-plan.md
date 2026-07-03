# 뷰 시스템 개편 + AI-first 단순화 설계안

> 2026-07-03. 사용자 피드백 2건에 대한 구현 설계 문서 (코드 무변경).
> ① "뷰 움직임이 구림 — Blender gizmo/전환 방식을 가져오고 건축 특화(단면·평면)를 얹자."
> ② "정보가 너무 많음 — 기능은 유지하되 simple하게. 뭔가 하고 싶으면 AI한테 말하면 되는 프로그램."
> 관련 문서: `positioning-vs-mcp.md`(입력 UI 가볍게 + AI 채널), `ROADMAP.md` M18(항목8a = 현 뷰 기즈모).

---

## A. Blender식 뷰 시스템 (기술 설계)

### A1. Blender 레퍼런스 분석 — 무엇을 가져오고 무엇을 버리나

Blender 2.8+ 뷰포트 내비게이션의 구체 동작:

| 동작 | Blender 명세 |
|---|---|
| **축 기즈모** (우상단) | 3축 색공 — X빨강·Y초록·Z파랑. +축 = 채운 공+라벨, −축 = 빈 공. 호버 시 배경 원 표시 |
| 축 공 **클릭** | 해당 정사영 뷰로 **부드럽게 회전**(Smooth View, 기본 ~200ms) + **orthographic 자동 전환**(Auto Perspective 기본 ON) |
| 같은 축 **재클릭** | 반대축으로 플립 (Front→Back) |
| 기즈모 **드래그** | 자유 오빗 (공 아닌 영역 포함 — 기즈모 전체가 오빗 핸들) |
| 마우스 | MMB 오빗 · Shift+MMB 팬 · 휠 줌 · Ctrl+MMB 드래그 줌 |
| 넘패드 | 1/3/7 = Front/Right/Top, Ctrl+넘패드 = 반대편, **5 = persp↔ortho 토글**, 2/4/6/8 = 15° 스텝 |
| **Auto Perspective** | 축 정렬 뷰 진입 시 ortho로, **오빗으로 벗어나면 persp 자동 복귀**. 단 사용자가 수동 ortho 토글한 상태면 유지 |
| 오빗 | 턴테이블 기본(월드 up 유지), **극점 통과 허용**(아래에서 올려다보기·뒤집힌 뷰 가능) |
| Quad View | Ctrl+Alt+Q — Top/Front/Right ortho 3 + persp 1 고정 분할 |

**채택 / 변형 / 버림 (웹·아이패드 제약 반영):**

- **채택**: 축-공 기즈모(클릭=축뷰, 재클릭=플립, 드래그=오빗) · Smooth View 트윈 · **Auto Perspective**(축뷰=ortho, 오빗 이탈=persp 복귀) · persp/ortho 명시 토글 1개.
- **변형**:
  - 넘패드 프리셋 → 없음(웹·아이패드). 기즈모 클릭 + 명령팔레트(Ctrl+K) + **AI 자연어**("동측 입면 보여줘")로 대체.
  - MMB 오빗 → **현행 RMB 오빗 유지**. 이유: InputManager가 이미 Rhino 의미론(RMB 무수식=오빗, Shift=팬, Ctrl=줌, RMB 클릭=Enter — `input/InputManager.ts:174-222`)이고 건축가에게 친숙. Blender에서 가져올 것은 *기즈모와 전환 품질*이지 마우스 바인딩이 아님.
  - 터치 = 카메라(불변④) 유지. 기즈모 터치 타깃 ≥40px.
- **버림(v1)**: Quad View(별도 렌더 패스 4개 — 성능 예산·모바일 부적합, v1.5 검토) · 트랙볼 오빗 · 카메라 오브젝트(넘패드0) · Blender fly/walk(자체 걷기 모드 이미 있음).

### A2. 현 Figcad 갭 (2026-07-03 코드 확인 결과)

파일: `apps/web/src/engine/CameraRig.ts` · `apps/web/src/ui/ViewGizmo.tsx` · `apps/web/index.html:819-850`.

- **(a) 입면이 원근으로 보임 — 확인됨.** `setView('front'|'back'|'left'|'right')`는 `mode='3d'` 유지 = perspective 카메라 그대로(`CameraRig.ts:101-124`). ortho 카메라는 존재하지만(`this.ortho`) **plan 모드 탑다운 전용**이고, 그마저 CAD 표준 방위를 위한 **X반사가 프러스텀에 하드코딩**(`updateFrustum`, `:417-421`) — 입면에 그대로 재사용 불가.
- **(b) 위로 못 봄 — 확인됨.** `MAX_PHI = π/2 − 0.02`(`:19`). 아래에서 올려다보기 불가. 부수 버그 2건도 확인:
  - `setView` 입면 프리셋은 φ=π/2를 **직접 대입해 클램프를 우회**(`:107-119`) → 입면에서 살짝 오빗하는 순간 `rotate()` 클램프(`:200`)가 φ를 0.02rad 끌어내려 시선이 튐.
  - `setPose`는 φ를 클램프(`:386`) → **입면 상태로 저장한 뷰포인트를 복원하면 미세하게 틀어짐**.
  - 참고: 걷기 모드는 pitch ±88° 자유(`MAX_WALK_PITCH`, `:21`) — 오빗만 제한된 상태.
- **(c) 전환 트윈 — 부분만 있음.** 트윈은 `setMode`(3d↔plan)의 **φ 단독 보간**뿐(0.3s ease-out cubic, `:143-151`). `setView` 프리셋은 **스냅**(`:117` "트윈 없음"), θ 보간·최단호 래핑 없음. 뷰포인트 점프(`setPose`)도 스냅.
- **(d) 기즈모 = 텍스트 버튼 6개 그리드 — 확인됨.** `ViewGizmo.tsx` = Top/Iso/Front/Back/Left/Right 2열 버튼(`position:fixed` 우상단). 축 공 아님, 현재 방위 표시 없음, 드래그 오빗 없음.
- **(부수 발견) 입면 명명 의심.** `ViewGizmo.tsx:11` Front = "북측 입면"인데 CameraRig 주석은 "남쪽에서 북을 바라봄" — 남쪽에서 보면 보이는 면은 **남측** 파사드. 라벨이 관례(보이는 면 기준)와 반대일 가능성 — S1에서 정정 (→ §C 결정1).
- **(부수 발견) CommandPalette에 죽은 명령.** `CommandPalette.tsx:63` '도구: 치수' — Toolbox에서 제거된(항목5) 도구가 팔레트에 잔존.

### A3. 설계

#### A3.1 CameraRig 개편 — `projection` 축 도입

`mode('3d'|'plan')`·`walking`과 직교하는 세 번째 상태 추가:

```ts
private projection: 'persp' | 'ortho' = 'persp';
private autoOrtho = false; // Auto Perspective 추적: 기즈모 축뷰가 켠 ortho인가
```

- `active` getter: `plan` 기존 경로 유지 + `projection==='ortho'`면 ortho 반환.
- `apply()`: ortho 카메라를 persp와 **동일한 구면 공식으로 배치**(현재는 탑다운 고정 `:439-442`). plan 전용 X반사·북향 up은 `mode==='plan'`일 때만.
- `updateFrustum()`: X반사를 plan 분기로 격리. ortho 반높이 = `distance·tan(fov/2)`로 정합(현 `distance*0.5`는 fov 55° 기준 우연히 ≈0.52라 거의 맞지만, 전환 무봉합을 위해 정확값 사용).
- `worldPerPixel()`(`:173-179`)·`pan()`(`:210-229`): ortho 활성 분기 추가. 입면 ortho 팬은 기존 3d 공식(θ/φ 기저) 재사용 — plan의 dx 반전은 X반사 전용이므로 미적용.
- `setPivot()`(`:249-266`): `mode!=='3d'` 가드는 유지하되 ortho 입면에서는 팬만 (Rhino 평행 뷰 의미론 `orbit()` `:185-191`과 일관 — 입면 ortho도 `orbit()`이 팬으로 분기하게 확장).

#### A3.2 축-공 기즈모 — 명령형 DOM HUD (불변③ 준수)

기즈모는 **매 카메라 변경마다 회전을 반영**해야 함 → React 불가(렌더 루프 금지). 두 후보 중 **명령형 DOM 채택**:

- ~~Three 씬 오버레이(setViewport 2차 렌더)~~ — 픽킹·호버·접근성 구현 비용 큼, 렌더 패스 추가.
- **명령형 DOM**(`hud/` 패턴): 공 6개 + 축 선 3개 = DOM 노드 ~10개. 카메라 쿼터니언으로 3축 단위벡터를 화면 투영 → `transform: translate(...)` + 깊이별 `z-index`/스케일/불투명도(−축 뒤쪽=흐리게). **갱신 훅은 이미 있음**: `main.ts:263-264`가 카메라 변경 시 `hud.reproject(rig.active)` + `updateViewportWidgets(...)`를 호출(render-on-demand) — 여기에 `axisGizmo.update(rig.active)` 한 줄 추가. rAF 상시 루프 없음, React 무관.

갱신 수학 (구현 스케치):

```ts
// hud/AxisGizmo.ts — update(cam: THREE.Camera), main.ts 카메라 변경 훅에서 호출
// 월드 3축을 카메라 뷰 공간으로: v = axis.clone().applyQuaternion(cam.quaternion.invert())
// 화면 오프셋 = (v.x·R, −v.y·R), 깊이 = v.z (양수=카메라 쪽=앞)
for (const a of this.axes) {          // axes = ±X/±Y/±Z 6개 {dir, el}
  const v = this._v.copy(a.dir).applyQuaternion(this._q); // _q = 카메라 쿼터니언 역
  a.el.style.transform = `translate(${v.x * R}px, ${-v.y * R}px) scale(${v.z > 0 ? 1 : 0.8})`;
  a.el.style.zIndex = String(100 + Math.round(v.z * 50)); // 앞쪽 공이 위
  a.el.style.opacity = v.z > 0 ? '1' : '0.45';             // 뒤쪽 = 흐리게 (Blender −축 관례)
}
```

노드 수 고정(6공+3선), 텍스처/캔버스 없음, 갱신은 카메라 변경 프레임만 — 성능 예산(힙·draw call) 무영향.

동작 배선:
- 공 클릭 → `actions.setView(preset)` (S3부터 트윈+auto-ortho). 현재 뷰와 같은 축이면 반대축.
- 공 아닌 영역 pointerdown+드래그 → `rig.rotate(dx,dy)` (InputManager 밖이지만 캔버스 입력 아님 — 불변④의 펜/터치 분기와 무관한 별도 위젯. 단 터치 드래그도 오빗으로 처리).
- 기즈모 하단에 미니 토글 1개: persp/ortho (Blender 넘패드5 대응).
- 걷기 중 숨김은 기존 CSS 유지(`index.html:2439` `body.walk-active .view-gizmo`) — 클래스명만 교체.

#### A3.3 Auto Perspective + 뷰 트윈

- **트윈 일반화**: 현 φ 단독 보간(`tick()`)을 포즈 트윈 `{theta, phi, distance, target}`으로 확장. θ는 **최단호 래핑**(±π 정규화) 필수 — 없으면 Left→Right가 한 바퀴 돎. `TWEEN_DURATION 0.3s` 유지.
- **Auto Perspective**: 축 공 클릭 → 포즈 트윈 → **완료 시점에 ortho 스왑**(`autoOrtho=true`). 트윈 중은 persp(plan 진입과 같은 패턴 `:79-81`). 이후 `rotate()` 호출(RMB 오빗·기즈모 드래그)이 들어오면 `autoOrtho`일 때만 persp 복귀 — 사용자가 토글로 켠 ortho는 유지(Blender 동일).
- persp↔ortho 스왑 시점의 크기 정합은 A3.1의 `tan(fov/2)` 프러스텀으로 무봉합.
- 뷰포인트 점프(`setPose`)에도 같은 트윈 적용 여부 → §C 결정5.

#### A3.4 Full-sphere 오빗 (φ 클램프 해제)

- `MAX_PHI = π − 0.05`로 완화(극점 특이점만 회피). 수정 지점: `rotate()` `:200`, `setPose()` `:386`, `setPivot()` 가드 `:260`, `walkToOrbit()` `:356`. → (b)의 부수 버그 2건(입면 오빗 튐·뷰포인트 미세 틀어짐)이 함께 해소되고, `exitWalk` 역산도 수평 시선(φ=π/2)이 유효해져 위치보존 성질이 개선됨.
- **모드 상호작용**:
  - plan: 진입 트윈은 `phiTo=MIN_PHI` 그대로. φ>π/2(아래서 보던 중) 상태에서 plan 진입 시 카메라가 크게 스윙 — 시각 확인 필요(문제 시 plan 진입만 스냅).
  - walk: `walkToOrbit` 클램프 완화 외 무변경(pitch는 원래 자유).
  - `pan()` 3d 공식은 θ/φ 기저 유도라 φ>π/2에서도 수학적으로 성립 — 스모크로 검증(core 밖이라 단위 테스트 없음).
- 아래에서 볼 때 렌더 이슈(스프라이트 컬링은 plan X반사 건으로 이미 DoubleSide 수정됨 — 회전은 무관, 낮은 리스크. 슬라브 밑면 재질/조명은 확인 필요).

#### A3.5 건축 특화 통합 — Blender에 없는 것

| 개념 | 설계 |
|---|---|
| **평면(스토리)** | 기즈모 Top 공 클릭 = 기존 `setMode('plan')` 경로 유지(직교 탑다운 + 북향 스냅 + 스토리 컨텍스트 + X반사 — CAD 평면도 의미론). Blender의 "단순 top ortho"와 다름을 유지할지 → §C 결정2. 스토리 스테퍼(ViewportCluster)는 그대로 — 기즈모는 방위만, 층은 스테퍼/AI |
| **입면 4방향** | 축 공 4개가 그 자체로 입면(S1부터 true ortho). 라벨은 건축 방위(§C 결정1) |
| **단면(클립)** | 클립 활성 상태에서 기즈모는 정상 동작(클립은 렌더러 `clippingPlanes`, 카메라와 직교). 축뷰 + 클립 = 사실상 단면도 뷰 — "단면 보기" 조합을 뷰포인트로 저장하는 기존 M17 경로(`saveViewpoint`)가 이미 카메라+클립을 함께 저장하므로 추가 작업 없음 |
| **단면 뷰포인트** | ViewpointPanel·AI(§B3 `ui_jump_viewpoint`)에서 점프 — S3 트윈 적용 시 "3번 단면 봐주세요"가 부드럽게 날아감 |
| **bottom 뷰** | `ViewPreset`에 `bottom` 추가(φ=π−0.05) — 천장·보 하부 검토용. S4 의존 |

#### A3.6 구현 슬라이스 · 파일 · 리스크

| 슬라이스 | 내용 | 파일 |
|---|---|---|
| **S1 — ortho 입면 (=로드맵 8b)** | `projection` 상태 + 입면 프리셋 true ortho + X반사 plan 격리 + worldPerPixel/pan/orbit ortho 분기 + 입면 라벨 정정 | `engine/CameraRig.ts` · `ui/ViewGizmo.tsx`(라벨) · `scripts/review-smoke.mjs`(Front 단언에 `ortho===true` 추가) |
| **S2 — 축-공 기즈모** | 명령형 DOM 위젯 신규, 기존 텍스트 그리드 대체, persp/ortho 토글, 드래그 오빗 | 신규 `hud/AxisGizmo.ts` · `main.ts`(263행 인접 update 훅 + setView 배선) · `ui/App.tsx`(ViewGizmo 제거) · `index.html`(CSS 교체) · `review-smoke.mjs`(DOM 셀렉터 재작성) |
| **S3 — Auto Perspective + 트윈** | 포즈 트윈(θ 최단호) + autoOrtho + rotate 시 persp 복귀 + 프러스텀 tan(fov/2) 정합 | `CameraRig.ts` · `review-smoke.mjs`(전환 후 단언에 트윈 대기 삽입) |
| **S4 — full-orbit + bottom** | MAX_PHI 완화 4지점 + `bottom` 프리셋 + plan/walk 정합 확인 | `CameraRig.ts` · `ViewGizmo`/`AxisGizmo`(bottom) |

리스크:
- **review-smoke 파손 확정**: `apps/web/scripts/review-smoke.mjs:205-240`이 `.view-gizmo button` textContent('Top'/'Front')로 클릭하고 φ(Top≈0.05, Front=π/2)·ortho를 단언 — S1(단언 값)·S2(셀렉터)·S3(스냅→트윈 타이밍)마다 갱신 필요. 각 슬라이스 PR에 스모크 갱신 포함.
- **walk 정합**: `main.ts` setView(`:599-602`)에 walkActive 가드 없음(현재는 기즈모가 CSS로 숨어 진입 경로가 없을 뿐) — S2에서 명시 가드 추가, §B3 AI 경유 호출도 동일 가드 공유.
- 트윈 중 입력 경합(오빗 시작 시 트윈 킬 = 기존 `tweenT=1` 패턴 재사용)·plan 트윈과 포즈 트윈의 공존은 트윈 상태를 단일 구조로 통합해 해소.
- SceneManager `setViewContext`가 plan에서 하는 부수효과(스프라이트 flip 등)가 ortho 입면에 새는지 — **확인 필요**(입면은 viewMode '3d' 유지 설계라 원칙상 무관).

---

## B. AI-first 단순화 (UX 설계)

### B1. 현 정보 인벤토리 (데스크톱, 코드 확인)

기본 랜딩(review 모드) 상시 노출:

| 표면 | 요소 수 |
|---|---|
| TopBar | ☰ Doc 메뉴 + 브랜드 + 룸코드 + **모드탭 3** + HubStrip(+모델 버튼 + 소스칩 N) + PresenceStrip(✦AI 토글·검사 배지(조건부)·연결점·아바타 ≤5·공유) ≈ **12+** |
| 좌 WorkRail | 리뷰 도구 팔레트 **5 버튼**(select/measure/paint/comment/sketch — `MODE_TOOLS.review`는 7개지만 `ToolPalette.tsx` TOOL_META에 sketch-pen·label 항목이 없어 2개 조용히 미렌더, 의도 확인 필요) + 온보딩 문구 + **CommentPanel + ViewpointPanel + VersionPanel 3패널 상시 스택** |
| 우 Inspector | ReviewInspector (+조건부 InfoBox) |
| 우하단 ViewportCluster | undo·redo·전체맞춤·선택맞춤·3D/평면·단면·걷기·스토리 스테퍼 = **9 버튼 + 라벨** |
| 우상단 ViewGizmo | **6 버튼** |
| HUD | 스케일바 + 방위표 |

합계 ≈ **40개 요소가 정지 상태에서 노출**. 모델 모드는 Toolbox 19버튼 + ProjectMap + InfoBox 스트립 + EditActions + TypesSection으로 **55개+**. AI dock은 기본 닫힘(`aiOpen:false`) — **정체성("말로 하는 프로그램")과 정확히 반대인 배치**: 가장 많은 것이 버튼, 가장 숨은 것이 AI.

### B2. 원칙 — "기본 화면 = 캔버스 + 최소 조작 + AI 입력창"

기능 제거 없음. **접기(demote) / 승격(promote)** 재배치만:

- **1급 유지(항상 보임)**: 선택(select) · 카메라(축 기즈모 + 축소된 클러스터) · **AI 입력창** · 공유/presence · 모드탭.
- **접기(1클릭 뒤)**: 리뷰 3패널 → 아코디언(1개만 펼침, 기본 코멘트) · Toolbox → 아이콘 전용(라벨은 title, 아이패드는 롱프레스 툴팁) · TypesSection → disclosure · HubStrip 소스칩 → "모델 N" 필 1개(클릭 시 확장) · ViewportCluster에서 undo/redo 제거(단축키 + Doc 메뉴; 아이패드는 유지 — 디바이스 분기).
- **AI 뒤로(입력 없이 말로)**: 타입 변경·배열/대칭/회전 파라미터·레벨 추가·재질 등 InfoBox/EditActions의 롱테일 — UI는 남기되 기본 접힘, AI가 대행.
- **Figma quick actions(Cmd+/)와의 관계**: Figcad엔 이미 `CommandPalette.tsx`(Ctrl+K, 정적 명령 ~23개)가 있음. Figma의 교훈 = 팔레트는 *알고 있는 명령의 가속기*, 자연어 AI는 *명령을 모를 때의 입구*. 최종형은 **한 입력창에서 둘 다**(P2): 앞부분 매칭되면 로컬 명령 즉시 실행, 매칭 없으면 그대로 AI 프롬프트로.

### B3. AI ui-action 도구군 — "3번 단면 보여줘"

현 AI 도구 = **31 capabilities 전부 aiExposed**(`packages/core/src/capabilities/catalog.ts` — get_document + 문서 편집 30종). **뷰·UI 조작 도구는 0개** — "2층 평면 봐줘"가 불가능. 신규 도구군 설계:

| 도구 | 파라미터 | 발화 예 |
|---|---|---|
| `ui_set_view` | preset: top/front/back/left/right/iso/bottom | "동측 입면 보여줘" |
| `ui_set_view_mode` | '3d' \| 'plan' | "평면으로" |
| `ui_set_story` | level id 또는 이름 | "2층 평면 봐줘" (plan+스토리 동시) |
| `ui_jump_viewpoint` | viewpoint id/이름/번호 | "3번 단면 보여줘" |
| `ui_set_clip` | {axis,t,flip} 또는 off | "허리 높이에서 잘라줘" |
| `ui_focus` | element ids (없으면 전체맞춤) | "그 벽 화면에 잡아줘" |

**문서 op와의 분리 (핵심 계약)**:
- **비영속·비undo·비브로드캐스트**: DocStore ops 아님(불변② 대상 아님 — 문서를 안 건드림). opLog에 안 들어가고 `applyOpLog` 안 거침. undo 스택 무영향, 내 카메라만 움직임(협업자 화면 불변 — 공유가 필요하면 기존 뷰포인트 저장 경로 사용).
- **서버**: `agent.ts` 도구 디스패치에서 `ui_` prefix는 `runCapability` 대신 상태 ack 문자열만 반환(드라이런 store 무접촉), 스트림에 별도 태그로 전달. 필요한 참조 데이터(뷰포인트 목록·레벨)는 이미 snapshot에 있어 서버가 id 해소 가능.
- **클라이언트**: 신규 `apps/web/src/ai/uiActionExecutor.ts`가 `ViewActions`+`uiStore`로 매핑. **스트리밍 도착 즉시 실행**(계획 승인 카드 비대상 — 파괴 불가능하고 되돌리기 = 다시 보면 됨). walkActive 가드는 A3.6과 공유.
- **가드**: 임포트 매니페스트 인젝션 이스케이프(M18)는 그대로 적용. 도구 6개 추가 = 총 37개 — strict tool use 금지 유지(기존 함정), `registry.ts:30-33`의 system+tools ephemeral 캐시가 1회 무효화됨(비용 1회성).

**"2층 평면 봐줘" end-to-end 시퀀스**:

1. AiPanel `send()` → `runAgent({snapshot, transcript, …})` — snapshot에 levels 포함(기존).
2. 서버 에이전트가 `ui_set_story({level: "2층"})` tool_use → agent.ts가 snapshot에서 이름→id 해소, `{ok, level: "2층(id)"}` ack 반환(드라이런 store 무접촉) + 스트림에 `uiAction` 이벤트 push.
3. 클라 agentClient가 `onUiAction(entry)` 콜백 → `uiActionExecutor`: `uiStore.setActiveLevel(id)` + `setViewMode('plan')` (walkActive면 거부 + notice). 기존 `main.ts` subscribe가 rig.setMode·setViewContext 처리 — **신규 카메라 경로 없음, 전부 기존 배선 재사용**.
4. 채팅에 실행 알림 1줄("→ 2층 평면으로 전환") — plan 카드 없음, opLog 없음, undo 무영향.

### B4. 단계별 적용

| 단계 | 내용 | 파일 | 리스크 |
|---|---|---|---|
| **P0 — 기본 접힘·밀도 감축** | B2의 접기 전부 + **AI 입력창 승격**: 하단 중앙 상시 앰비언트 입력 바(1줄, 포커스/응답 시 현 dock으로 확장 — AiPanel 마운트 유지라 히스토리 보존) + CommandPalette 죽은 명령 정리 | `ui/WorkRail.tsx`(아코디언) · `ui/Toolbox.tsx`·`ToolPalette.tsx`(아이콘 모드) · `ui/HubStrip.tsx`(필 접힘) · `ui/ViewportCluster.tsx` · `ui/AiPanel.tsx`+`index.html`(입력 바) · `ui/CommandPalette.tsx` | 낮음 — 전부 React 패널층, 엔진 무접촉. 아이패드 hover 부재로 아이콘 전용 시 학습 비용(title 불충분 → 롱프레스 툴팁 필요). lint-panel·ai-panel 스모크 셀렉터 영향 확인 필요 |
| **P1 — AI ui-action** | B3 도구 6종 + 즉시 실행 경로 | 신규 `core/src/capabilities/uiActions.ts`(정의+zod) · `server/src/handlers/agent.ts` · `web/src/ai/agentClient.ts`(스트림 타입) · `web/src/ai/uiActionExecutor.ts`(신규) · `ui/App.tsx`(AiPanel에 actions 전달 — 현재 미전달) · core 테스트 + `ai-panel-smoke.mjs` | 중간 — 에이전트 루프 프로토콜 변경(스트림 태그). 모델이 문서 편집 중 불필요한 뷰 전환을 남발하지 않게 시스템 프롬프트에 사용 기준 명시 |
| **P2 — 입력창 단일화** | Ctrl+K 팔레트와 AI 입력 바 통합: 타이핑 → 로컬 명령 fuzzy 매치 목록 + "AI에게: …" 항목이 항상 마지막. Enter = 최상위 실행 | `ui/CommandPalette.tsx` ↔ `ui/AiPanel.tsx` 통합 | 중간 — P0·P1 완료 후. 로컬 명령(무료·즉시)과 AI 호출(과금·지연)의 구분 표기가 UX 핵심 |

### B5. 검증 계획 (슬라이스 공통)

- 타입/단위: `corepack pnpm typecheck` · `corepack pnpm -F @figcad/core test -- --run`(P1 uiActions zod·id 해소).
- 브라우저 스모크: `node apps/web/scripts/review-smoke.mjs`(A 각 슬라이스마다 갱신 — A3.6 리스크) · `node apps/web/scripts/ai-panel-smoke.mjs`(P1 — ui-action 스트림 이벤트 단언 추가) · `node apps/web/scripts/lint-panel-smoke.mjs`(P0 셀렉터 회귀).
- 수동(아이패드 필수): S1 입면에서 원근 왜곡 소멸 확인 → S2 기즈모 터치 드래그 오빗 → S4 아래에서 올려다보기 + plan 전환 스윙 시각 확인 → P0 접힘 상태에서 신규 사용자 시나리오(코멘트 남기기·모델 1개 올리기)가 1클릭 내인지.

---

## C. 결정 필요 항목 (사용자 확인)

1. **기즈모 축 라벨**: Blender식 XYZ 색공 그대로 vs 건축 방위(N/E/S/W + Top/Bottom)? 문서 좌표(x동·y북)와 Three(Z북) 표기가 달라 XYZ는 혼란 소지 — **N/E/S/W 권장**. 이때 입면 명명도 함께 확정 필요(A2 부수 발견: 현 Front="북측 입면" 라벨이 관례상 남측 입면일 가능성).
2. **Top 공 클릭의 의미**: 기존 plan 모드(북향 스냅+스토리 컨텍스트+평면도 의미론)로 진입 vs Blender식 단순 탑다운 ortho(현 방위 유지)? 전자는 CAD 관례, 후자는 Blender 충실 — **plan 진입 유지 권장**(건축 특화가 우선).
3. **AI ui-action 실행 게이트**: 뷰 액션은 승인 카드 없이 항상 즉시 실행(권장) vs auto mode에서만?
4. **P0 기본 접힘 강도**: 리뷰 랜딩에서 좌레일 자체를 접을지(캔버스+AI바만) vs 아코디언 1패널은 남길지. 아이패드 실사용 감각 필요.
5. **뷰포인트 점프에도 트윈 적용?** "3번 단면 봐주세요" 시 부드럽게 날아가기(맥락 유지에 유리) vs 즉시 스냅(현행, 빠름). 원거리 점프는 트윈이 오히려 어지러울 수 있음 — 거리 기반 자동 스냅 절충안 있음.

**권장 착수 순서**: A-S1(8b, 입면 원근 왜곡 = 가장 체감 큰 결함) → A-S2+S3(기즈모+트윈 = 피드백 ①의 본체) → B-P0(밀도) → A-S4 → B-P1(ui-action) → B-P2.
