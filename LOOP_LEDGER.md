# LOOP_LEDGER — feat/loop-260712 자율 개선 루프

> append-only. iteration당 1블록. 크래시 복구·아침 감사의 단일 소스.
> 플랜: `~/.claude/plans/fable-fluffy-adleman.md` · 결정 큐/요약: `MORNING_SUMMARY.md`

## loop-0 부트스트랩 (2026-07-12)

- **항목**: 스모크 통합 러너 + web vitest 부트스트랩 + 베이스라인 + 소품
- **산출**:
  - `apps/web/scripts/run-smokes.mjs` + `smoke-manifest.json` — 30종 등록(러너 관리 29 + optIn stress-2k), 제외 9종(수동/유틸/라이브 키). vite/백엔드(:8787 node·miniflare) 수명주기 자동, 외부 기동 재사용, flake 1회 재시도, JSON 요약.
  - `apps/web` vitest 부트스트랩 (`vitest.config.ts`·`test/setup.ts` 최소 window 스텁) + `test/camera-rig.test.ts` 26케이스 — CameraRig 현행동작 고정(A-S1~S4 개편 안전망).
  - root `pnpm test`에 web 편입 → T0 = 606케이스 (core 435·server 36·interop 109·web 26).
  - d2-smoke 스테일 수리 — 의도 제거된 도구(text M17·dimension M18) 생성 서피스 테스트 삭제, ops 레벨 back-compat 회귀 유지.
  - CommandPalette 죽은 명령('도구: 치수') → '측정(줄자)' 대체.
- **베이스라인 (매니페스트 수정 후)**: 러너 관리 29종 전부 GREEN. PRE-EXISTING-RED 0.
  - 러너가 드러낸 사실: `?op=` 라우트·버전 API·fed-upload·`/api/agent` = **miniflare(dev.mjs) 전용**(dev-node 503) → connector-e2e·ref-interact·review·section·dwg-e2e·agent-live·version-smoke는 miniflare 그룹. mobile-smoke는 WS 콘솔에러 단언 때문에 node 백엔드 필요.
- **게이트**: T0 typecheck ✅ · test 614/614 ✅ · 스모크 29/29 ✅
- **리뷰**: Workflow 3렌즈(runner-edge·test-validity·convention) → verify 19에이전트 = **제기 16 / 확정 15 / 기각 1** (기각: runScript 고아 시나리오 일부 — Windows 재현 불가 판정). 확정 전부 수정:
  - **제품**: `CameraRig.northScreenAngle` 스테일 matrixWorldInverse(무렌더러 1콜 스테일, three 소스 추적+수치 실증) → `updateMatrixWorld()` 추가 · dimension 도구 죽은 코드 3종 제거(ToolName union·InfoBox 분기·DimensionTool.ts — 팔레트 수정으로 마지막 setter 소멸 확인)
  - **러너**: 외부 8787 kind 프로브(`?op=pull` 판별 → miniflare 요구 미충족 시 SKIP+사유, `--strict-backend`로 FAIL 승격) · 인프라 기동 실패 = 스크립트 FAIL 처리 후 계속(JSON 요약 계약 유지, 실패 인프라 재시도 방지) · 서버 사망 시 상태 리셋(+교체 레이스 가드) · 타임아웃 킬 실패 8s 강제판정(행 방지) · 스모크 자식 cleanup 편입 · 포트 5173/8787 고정 명시
  - **스크립트**: dwg-e2e exit 규약 위반(실패도 exit 0 — 회귀 위장) 수정 · dwg-underlay 단언 전무 → visibleSegs+pageErrors 게이트化
  - **테스트**: 공허 단언 4건(뮤테이션 생존 실증 포함) → 방향·정확값 고정 (X-반사 부호·rotate 감도·WALK_EXIT 클램프 정확값·클램프 발동 시 위치 연속성·enterWalk yaw). 26→28케이스.
  - **기타**: d2 'text' 태그 제거(커버리지 환상) · README test 주석
- **재검증**: T0 614/614 ✅ · 대표 스모크 5종(none/node/miniflare 수명주기) ✅ · 외부 dev-node SKIP 경로 실증 ✅
- **결과**: DONE — `c0a84c0`(web vitest) `78887f7`(러너) `92a3525`(web fix) `9028837`(docs)

## 선행: 회차 2 서버 파트 — blob GC + 커밋 레이트리밋 (loop-0 리뷰 대기 중 병행)

- **항목**: `version.ts:31 TODO(M6.5)` 해소 — repo 유일 명시 기술부채
- **구현**:
  - `BlobStore.delete?` 옵셔널 추가 (disk=unlink no-op 안전 · r2=bucket.delete · fakeStore) — 미구현 스토어는 GC 조용히 스킵.
  - `CommitLimits` 주입형 정책 (`DEFAULT_LIMITS`: maxLog 500 · rate 12/60s). log 잘림 시 잔존 타임라인이 참조하지 않는 해시만 best-effort 삭제(콘텐츠 주소 dedup 존중). 레이트리밋 = log 메타 ts 기반 무상태(재시작·다중 인스턴스 무관), 무변경 스킵은 미소모, 거부 시 blob 미기록 → 핸들러 429.
  - 클라(`versionClient.checked`)는 body.error를 그대로 표시 — 추가 배선 불필요.
- **검증물 신설**: version.test.ts +6 (GC·dedup 보존·delete 미구현 스킵·리밋·스킵 미소모·핸들러 429)
- **게이트**: server tsc ✅ · vitest 42/42 ✅ · 스모크 version/connector-e2e/review 3종 ✅ (miniflare 실경로)
- **결과**: DONE — `a120540`

## F-소품 2건 (회차 1 리뷰 대기 중 병행 — 파일 비충돌)

- **폰 뷰포인트 시트 (수신측)** — `8b2e651`. PhoneSheet 'viewpoint' + 바텀바 '📍 뷰' + ViewpointPanel 재사용(actions 배선 기존 관통). mobile-smoke: 공유 항목 렌더 + 탭 점프(distance/theta 정확값) 검증. 게이트: web tsc ✅ · mobile-smoke ✅.
- **데스크톱 핫키 레이어 (Slice 11)** — `8179619`. `input/hotkeys.ts` 신설(resolveHotkey 순수 분리), MODE_TOOLS 게이팅·리뷰 C=코멘트 오버라이드·1/2/3 모드, 가드(수정키·입력필드·IME·걷기·폰). hotkeys.test 5케이스 + ux-smoke 실 keydown 4단언. 게이트: web tsc ✅ · vitest 39/39 ✅ · ux-smoke ✅.
- **주의**: 이 2건의 adversarial 리뷰는 다음 스윕에 포함 (회차 1 리뷰가 CameraRig 파일 점유 중이라 순서 조정). Toolbox 툴팁에 핫키 힌트 표기는 후속 소품.

## 회차 1: A-S1 ortho 입면 + A-S4 full-sphere 오빗 (2026-07-12)

- **구현**: CameraRig `projection` 축 신설 — 입면 4방향+bottom = true ortho(8b), iso=원근, top=plan 경로. apply() 구면 배치 공유·프러스텀 tan(fov/2) 정합(persp↔ortho 배율 무봉합)·orbit=팬(Rhino 평행 뷰)·setMode/setPose/enterWalk persp 리셋. MAX_PHI π/2−0.02→π−0.05(4지점 단일 상수) = 아래서 올려다보기 + 입면 오빗 튐·뷰포인트 클램프 틀어짐 해소. ViewGizmo 라벨 정정(front=남측, §C-1)+Btm 버튼.
- **리뷰**: 3렌즈(math-geometry·consumer-impact·spec-conformance)×16에이전트 — **제기 13 / 확정 12 / 기각 1**(합격 요약 오분류). 확정 전부 수정:
  - **[critical] 입면 ortho 그레이징 히트** — φ=π/2 float 잔차(cos π/2≈6e-17)로 지면 레이가 t≈1e17m "교차" → 도구 2클릭에 1e20mm 요소가 zod(int 무상한) 통과, 공유 Y.Doc 오염. → Picker 이중 가드(|dir·n|<1e-9 + 히트 상한 1e5m), picker.test 3케이스.
  - **[major] setPivot 입면 누수** — RMB-down마다 피벗 재역산이 ortho.lookAt 축을 12° 기울여 축정렬 입면→사선 액소노 (S4 클램프 완화가 창 확대, 스펙 L66 위반). → `projection==='ortho'` 가드 + updateFrustum 방어 + 회귀 테스트.
  - **[major] 입면 4방향 동서 거울상** — 문서(x동·y북)→월드 매핑 det −1인데 plan만 교정 → 남측 입면서 동쪽이 화면 왼쪽(실세계·Rhino Front·자체 plan과 반대). 8a부터 잠재, S1이 "CAD급 입면" 격상하며 실질화. → **X반사를 입면 ortho에도 적용**(검증자 권고 디폴트): 프러스텀 반전 + pan dx 부호 + 스프라이트 상쇄 일반화(SceneManager.setMirrorComp — plan 전용이던 flip을 반사 상태 기반으로) + main 동기 헬퍼(syncMirrorComp) 4지점. chirality 테스트(front·plan 동일 방향) + review-smoke NDC 단언.
  - **[minor 4]** fitBounds ortho tan 공식(과줌아웃 1.30→1.15) · northScreenAngle front/back 퇴화 시 마지막 유효각 유지 · S4 스테일 주석 2곳 정정 · d2 태그(이전 배치서 처리).
- **수용/큐**: 뷰포인트 ortho 투영 미저장(persp 복원 — 페이로드 확장은 롤아웃 결정) · 구빌드에 φ>π/2 뷰포인트 = 클램프 복원(롤아웃 창) · plan 진입 스윙(φ>π/2, 시각 확인) · bottom 반사=RCP 관례 채택 → 전부 MORNING_SUMMARY 결정 큐.
- **게이트**: T0 632/632 ✅ (web 46) · 스모크 11종 ✅ (review-smoke chirality·ortho 단언 라이브 통과)
- **결과**: DONE — `f5fc50d`

## 회차 2: A-S3 포즈 트윈 + Auto Perspective (2026-07-12)

- **구현**: 단일 트윈 구조(θ 최단호·φ·distance·target, forceComplete/swapToOrtho) — plan 진입과 프리셋/뷰포인트 비행 통합. Auto Perspective(축뷰=persp 비행→도착 ortho 스왑, rotate 시 autoOrtho만 persp 복귀). 뷰포인트 점프 §C-5 거리 절충. setProjection 신설(S2 대비). 렌더 티커 syncMirrorComp 멱등 동기.
- **스윕**: 매 4회차 도래 — `--all` 29/29 GREEN (T0 648 시점).
- **리뷰**: 3렌즈(tween-statemachine·consumer-timing·hotkey-phonesheet)×13에이전트 — **제기 10 / 확정 10 / 기각 0** (검증 통과 확인 항목 2건 포함). 수정:
  - [major] 같은 축뷰 재클릭 = persp 강등+X미러 왕복 플래시 → no-op 가드 (+회귀 테스트)
  - [major] 폰 바텀바 7버튼(선택 시) AI 클리핑 → CSS min-width:0+말줄임
  - [minor] 평면→걷기 진입 시 복원 트윈 t=0 킬 = 걷기 북향 굳음 → 끝값 채택 (+테스트)
  - [minor] 한글 IME서 핫키 14종 무반응 → e.code 폴백 hotkeyChar (+테스트) · 1/2/3 중복 등록 제거(CommandPalette)
  - [minor] ortho 스왑 프레임 HUD 1프레임 스테일 → apply서 updateMatrixWorld · plan 진입 비행 중 거울 텍스트 → syncMirrorComp 술어 = rig.isOrtho(실제 반사 상태) · review-smoke iso 트윈 동결 함정 → tick(2)
  - **수용**: Auto Perspective 도착 프레임 1회 미러 팝(상태 무손상 — 마스킹은 S2와 재평가, 주석 명시)
- **게이트**: T0 652/652 ✅ (web 58) · 스모크 6종 재검증 ✅
- **결과**: DONE — `d54dd0d`(S3) + `f0ae559`(리뷰 수정: 핫키·바텀바)

## 선행: 회차 4 B-P1 구현 (리뷰 대기 중 병행 — 커밋 전 리뷰 필수)

- core: category 'view' + ui_* 6종(catalog — run=이름→id 해소·정규화만, store 무접촉) + isViewCapability + ApplyResult.idMap 노출. capabilities-view.test 8케이스.
- server: agent.ts 디스패치 view 분기 — uiActions[] 수집(opIndex 포함)+'ui' 스트림 이벤트+done 3경로 동봉. 시스템 프롬프트에 사용 기준(남발 금지·명시 요청 시만) 추가.
- web: agentClient(UiActionEntry·onUiAction·done 파싱) + uiActionExecutor 신설(walkActive 가드·idMap 재매핑) + AiPanel(순수 뷰 응답=즉시 실행 / 혼합=승인 후 실행·거부 시 폐기) + App actions 전달.
- **실행 정책(설계 확정)**: 혼합 응답(문서 op 동반)의 뷰 액션은 applyOpLog **후** idMap 재매핑 실행 — "만들고 봐줘" 순서·드라이런 id·fit 새 bbox 문제 해소. 순수 뷰 응답만 즉시(§C-3).
- 게이트: T0 652 ✅(core 443 포함) · ai-panel/agent-live 스모크 ✅. **실 AI 왕복 검증은 키 필요(아침 큐)**.
- **리뷰(회차 4 확정)**: 3렌즈(contract-safety·flow-edge·schema-regression)×18에이전트 — **제기 15 / 확정 15 / 기각 0**. 전부 수정:
  - [major] ui_set_clip이 uiStore.clip 락스텝 누락 — ClipControl 위젯 불능 + saveViewpoint가 stale clip을 문서 채널에 영속(비영속 계약 위반) → setClipState 선행
  - [major] ui_set_story idMap 재매핑 누락 — "2층 만들고 봐줘"의 드라이런 레벨 id 미해소 → idMap 경유
  - [minor 13] executor 전체 try/catch(승인 카드 잔존→opLog 이중 적용 방어) · throw 이름 목록 JSON 프레이밍+프롬프트 데이터-가드 확장(인젝션) · 승인 카드에 🎬 동반 뷰 액션 표시 · critic 라운드 uiActions dedupe · ?op=apply 응답서 idMap(Map→{}) 제외 · ui_focus [] 정규화 · 프롬프트 '승인 카드 없이' 문구 정합 · strict 주석 카운트 · 스냅샷 불변 테스트에 store-조회 2종 추가 등
- **결과**: DONE — `cb36906` (회차 4로 승격 완료)

## 선행: 회차 5 걷기 v1.1 구현 (B-P1 리뷰 대기 중 병행 — 커밋 전 리뷰 진행 중)

- **벽 충돌**: moveWithCollision — 수평 변위를 눈높이+허리(-0.9m) 2레이 검사(반경 0.35m), 벽이면 허용 거리까지 직진+잔여 접선 슬라이드(2회 반복=코너). 법선 |y|≥0.7=바닥/램프 통과. 수직(Q/E)은 기존 경로.
- **BVH**: three-mesh-bvh 0.9.11 추가(사용자 승인) — engine/bvh.ts 전역 배선(boundsTree 있는 지오메트리만 가속 = Picker 무영향), 걷기 진입 시 20k-tri 이상 메시 점진 빌드(프레임당 1개, 지오메트리 캐시=재진입 재사용). 예산 킬스위치는 안전망 유지.
- **클립 인지**: 스냅·충돌 히트를 renderer.clippingPlanes로 필터 — 단면으로 잘린 슬래브 착지/잘린 벽 충돌 제거.
- **보이드 정책**: 착지면 없으면 현 높이 유지(추락 없음 — 발코니·보이드 검토 우선, 주석 명문화).
- CameraRig: walkDeltaWorld/walkMoveWorld 신설.
- **검증물**: walk-collision.test 7케이스(헤드리스 three 실 레이캐스트 시뮬 — 정지·슬라이드·바닥 통과·클립 양방향·보이드·기저 패리티) + walk-smoke 브라우저 벽 충돌 케이스(실 store 벽 → 홀드 전진 → 관통 없음).
- **리뷰(중단됨)**: adversarial verify 패스가 **세션 한도(18:50 KST 리셋)로 14/16 에이전트 실패** — 리뷰어 2명의 findings만 확보, 전부 미검증. **명백 4건 인라인 자가검증 후 반영**: ①스프라이트 있는 루트 레이캐스트 TypeError(raycaster.camera 지정) ②nearestWallHit Line threshold 미적용(생성자 상시 0) ③킬스위치가 BVH 빌드 전 발화 = 자기모순(큐 소진 전 유예) ④DoubleSide 매몰 데드락(distance<0.08 탈출 허용).
- **미검증 잔여 findings (리셋 후 재검증 또는 아침 판단)**: 글랜싱 각도 클리어런스 붕괴(카psule 아님의 근본 한계 — v1.2 후보: 법선 방향 디페너트레이션 패스) · 허리 레이 vs 계단 등반 고속(달리기) 스터터 가능성(보행속도는 기하 분석상 안전 — 계단 케이스 스모크 추가 후보) · 45° 램프 경계 마진 0.57° · computeBoundsTree 동기 1프레임 프리즈(대형 단일 메시 수백 ms 1회 — 수용 or 워커화) · bvh.ts 정적 번들 +~30-45KB gz(걷기 미사용자도 로드 — dynamic import 후보) · '힙 할당 0' 주석 뉘앙스(intersectObjects 자체 할당은 기존 스냅 레이와 동일).
- **게이트**: web tsc ✅ · web vitest 65 ✅ · walk-smoke(충돌 포함) ✅
- **결과**: DONE — `77e10f6` (미검증 findings는 위 큐)
- **재검증 (한도 리셋 후 resume, 20 에이전트 — 제기 17 / 확정 13 / stale·기각 4)**: 확정분 수정 = `e4a33c0`
  - [major] 글랜싱 클리어런스 붕괴 — θ=85°서 R·cosθ≈3cm + 0.08 탈출구 오발 = **실제 관통 실증** → 수직 기준 allowed 환산 + 법선 푸시아웃 1발
  - [major] DoubleSide 내부 데드락 — 0.08 탈출구는 0.08~0.35 밴드 미구제·신규 트랩 실증 → 내부 백페이스(원시 법선·dir>0 && d<R) 비차단으로 대체
  - [minor] 45° 램프 고속 침수→관통·추락 → 스냅 lag>1m 시 수평 1프레임 유보
  - [minor] 계단 라이저 스터터(달리기 한정·자기치유·등반 ~4m/s 캡) → 의도 수용+주석
  - **수용(v1.2 후보)**: computeBoundsTree 동기 1프레임 프리즈(대형 단일 메시 1회 — 워커화 후보) · three-mesh-bvh 정적 번들 +~30-45KB gz(dynamic import 후보) · 계단 전용 스모크 케이스 부재
  - stale 기각 2건 = 커밋 전 인라인 수정(스프라이트 camera·Line threshold) 유효 확인. 회귀 테스트 +2(글랜싱·내부 탈출) = walk-collision 9케이스.

## 회차 3: A-S2 축-공 기즈모 (2026-07-12 야간)

- **구현**: `hud/AxisGizmo.ts` — 명령형 DOM(불변③), 공 6개(N/E/S/W/T/B) + 축선 + ⬒ persp/ortho + ⌂ iso. 쿼터니언 투영 배치(무변화 스킵), 드래그=오빗, 정착 재클릭=반대축(gizmoPresetFor 순수 분리·VIEW_PRESET_ANGLES 단일 소스). ViewGizmo.tsx 삭제(주의: 삭제가 e4a33c0 걷기 커밋에 휩쓸림 — 히스토리 흠, 기능 무해).
- **리뷰**: 2렌즈(widget-correctness·integration-a11y)×18에이전트 — **제기 16 / 확정 16 / 기각 0**. 전부 수정:
  - **[critical] 포인터 캡처 재타게팅 = 실브라우저 공 클릭 전멸** — setPointerCapture 후 pointerup.target이 orb로 재타깃(스펙). 합성 dispatchEvent 스모크는 캡처 파이프라인을 우회해 이 버그를 통과시킴(교훈: 위젯 입력 스모크는 실 CDP 입력 필수) → down 시점 target 기록 + 스모크 실마우스 전환.
  - [major] ortho X반사 미보정 — plan(방위가 가장 중요한 모드)에서 E/W 공이 씬과 정반대 → isOrtho 화면 x 미러 + E공 부호 단언.
  - [minor 14] pointercancel/pointerId(유령 오빗 27°·멀티터치 지터) · 밖에서 시작한 프레스 오발 · plan 트윈 중 T 더블탭→bottom · 각도표 리터럴 복제 · 걷기 중 티커 낭비 · 지평선 공 노이즈 · ⬒ plan 침묵 no-op → 비활성 · 접근성 회귀(div 공 → role/tabIndex/aria/키보드) 등.
- **게이트**: T0 665 ✅ (web 71) · 스모크 4종(review-smoke 실마우스 경로) ✅
- **결과**: DONE — `d20e9e5`

## 회차 6: F 소품 배치 1 (2026-07-12 야간)

- **PDF 다중 페이지** — `8bd3b03`: underlay.page optional(구빌드 strip→1페이지 강등, clip/opacity 선례) + setUnderlayPage op + renderPdfPage(클램프·pageCount) + 리컨실러 페이지 변경=재렌더(요청 페이지 기준 감지 — 클램프 재로드 루프 방지, 자가 발견) + HubManage ‹n/N› 스테퍼. 검증 = pdf-page-smoke 신설(2페이지 픽스처 자체 생성 — 로드·전환·클램프 라이브).
- **Toolbox 핫키 힌트** — `d412975`: hotkeyForTool 역매핑(오버라이드에 밀린 키 생략).
- **.gitattributes** — `24e5f7?`: PDF 픽스처 CRLF 변환 = xref 오프셋 파손 위험 자가 발견 → pdf/dwg/3dm/glb binary 명시.
- **주의**: 이 소품 3건의 adversarial 리뷰는 다음 스윕에 배치(전부 라이브 스모크 검증 완료 상태).
- **잔여 큐**: poché 완전 DCEL(M — 알고리즘, 새 컨텍스트 권장) · Presence 인라인 rename+Share QR(S) · web 테스트 부채(ToolController/InputManager) · B-P0/P2(아이패드 감각 = 감독 필요).

## 회차 6 계속: Presence 소품 + 배치 1 리뷰 확정 (2026-07-12 심야)

- **Presence 인라인 rename + 공유 QR** — `d252a01`: prompt→인라인 입력(IME 조합 가드), 공유 팝오버 = QR(qrcode 동적 import — 번들 무영향)+URL 복사. ux-smoke rename·QR 암픽셀 검증(플레이크 1건 = self 아바타 대기 누락 → waitForSelector 수정, 2회 연속 안정). **리뷰는 다음 배치**.
- **배치 1 리뷰 확정** — 2렌즈×14에이전트, **제기 12 / 확정 11 / 기각 1**(픽스처 CRLF 창 — 반박됨). 수정 = `f68d58f`:
  - [major] **로드 인플라이트 page 변경 영구 유실** — rasterPageReq를 완료 시점 live 기준으로 기록 + reconcile이 loading 중 sig만 소비 → '전원 같은 페이지' 조용히 파손 → 렌더에 넘긴 요청 기준 기록 + completion-time 재검(즉시 재로드).
  - [minor 10] 스테퍼 기준 단일화(pageOf) · fed-register 유래 underlay 없는 pdf 스테퍼 비노출 · 재로드 중 pageCount 보존(언마운트 방지) · pdfClient 로딩 실패 destroy 누수 · hotkeyForTool MODE_TOOLS 게이트+ToolPalette 힌트 일관 · setUnderlayPage core 3케이스·스냅샷 라운드트립 · 구빌드 write-back page 소거 = 수용+롤아웃 노트(재질 페인트 opacity와 동일 클래스).
- 게이트: T0 668(core 446) ✅ · pdf-page/ux 스모크 ✅
- **잔여 큐(갱신)**: Presence 소품 리뷰(다음 배치) · poché 완전 DCEL(새 컨텍스트 권장) · web 테스트 부채 · B-P0/P2(감독 필요).
