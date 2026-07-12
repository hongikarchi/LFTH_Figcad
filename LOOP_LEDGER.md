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
