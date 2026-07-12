# Figcad 로드맵 (repo 내 SoT)

> 버전관리되는 lean 상태판. 폴더에 보이고 git에 남고 compact 생존. **현재 위치 + 다음 작업 + 불변 규칙 + 문서맵 + 백로그 + 함정**만 — 완료 마일스톤 상세는 `docs/HISTORY.md`.
> **정체성 — 3축: 웹 · 실시간 · AI.** **웹**(브라우저, 설치 없음 / iPad Pencil + 데스크톱) · **실시간**(여러 툴 모델·도면 + 여러 사람을 한 화면에서 동시에) · **AI**(손그림→모델, 에이전트 편집). Rhino·CAD·Revit의 모델·도면을 **실시간으로 모아 같이 보고 빚는** 멀티툴 협업 허브 — IFC/DXF/.3dm 양방향 인터롭. 대조·sketch·조율은 거기서 파생. (정밀 모델링·납품도면 *제작*은 전문툴 몫, Figcad는 모으고·조율 — LOD 100~250 수준. "상류"·"핸드오프"=단방향 함의라 안 씀.)

## 현재 상태 (Current)

- **Primary = Railway (라이브 배포중)**: **https://lfthfigcad-production.up.railway.app** (Node 백엔드, Dockerfile). 최신 배포 = **자율루프+재질페인트+커넥터v0.5/0.6 합본 (2026-07-13)**(라이브 `index-CXeS2w44.js`, master `8ad1672`, deployment `4ce48e84`, M18 이후 40커밋). **배포 직후 열린 구빌드 탭 전부 새로고침 필요**(재질 opacity·PDF page whole-entry LWW strip + φ>π/2 뷰포인트 클램프). CF(`figcad.archivibe.workers.dev`)는 rollback용. 배포가이드 `docs/RAILWAY_DEPLOY.md`. 배포 머신 = bluem 데스크톱(railway CLI 로그인됨, `railway up --detach`).
  - **M18 (2026-07-02)**: 3개 병행 스트림 합류 배포 — ① **메인 11항목**(줌선택 z·오빗 피벗=커서/선택·버전 3D 시각비교 diffOverlay·치수 생성표면 제거·스냅마커 공유·**asset kind 엔투라지**·뷰 기즈모 8a·연동모델 메뉴 portal 수정·드래그이동 제거·마크업→스케치) ② **임포트 읽기전용 상호작용**(정체성 관통: glTF/IFC/.3dm/room→userData+삼각형 range · 3D 피처 스냅 vertex>edge>face 원근보정 · 라벨 프리필 · 빽도면 끝점 스냅+그리기 13툴 트레이싱 · **AI 연동모델 매니페스트**+인젝션 가드) ③ **커넥터 v0.4**(파라메트릭 리프트: Section hsection/polygon·create_type·FigcadFit/Classify·패널 프리뷰). 리뷰 7건 수정. 검증 core 415·interop 108·server 35.
  - **M17 (2026-07-01)**: 야간 Phase 9(실시간 단면+절단선·굵은선·줄자 측정·fork정리) → 아침 배포 + 4추가: **Text 종류 생성 제거**(스키마·렌더 back-compat) · **단면 poché**(절단선 루프 스티칭+채움, sharpest-turn 비매니폴드 견고) · **공유 이름있는 뷰포인트**(카메라+클립 저장·전원공유·"N번 단면 봐주세요", ydoc viewpoints v6 채널). 각 기능 어드버서리얼 리뷰→수정.
  - **검증 루프 (2026-07-02, 미배포 3커밋)**: ① M18 브라우저 스모크 ✅ — 커밋된 스크립트 4종(`review-smoke` 줄자 3D 모서리·뷰포인트·버전 3D 비교·기즈모 / `section-smoke` 클립+절단선+poché 픽셀 / `ref-interact-smoke` refSnap vertex 0mm·라벨 프리필·빽도면 끝점 ±1mm·importsManifest 26pass / `agent-live-smoke` 키 설정 시 실 Claude 3시나리오). ② `/api/agent` **CORS 버그 수정**(데브 5173→8787 프리플라이트 실패 → "Failed to fetch"가 503 안내 가림). ③ 커넥터 v0.5(아래 G 참조).
  - **재질 페인트 (2026-07-03, 커밋됨·미배포)**: SketchUp/D5식 클릭 도색(색+투명도 v1) — 네이티브=**타입(패밀리)** 단위(type.color 재사용+opacity 렌더힌트 float) · 임포트=**.3dm Rhino 레이어/IFC ifcType/glTF 소스 전체**(신규 'materials' 채널: 결정적 키 U+001F LWW·undo 추적·스냅샷 4경로·커밋 canonical 미포함=의도). .3dm은 import 시 레이어-연속 정렬 → 페인트 시에만 geometry group+재질 배열 coalesce(미페인트=1 draw call 유지, faceIndex 정체성 무손상). 도구=모델 Toolbox+리뷰 ToolPalette(+리뷰 Inspector에 PaintContext), 스포이드(Alt/토글)·지우기·호버칩 33ms. AI 도구 4종(paint_type·paint_import_material·clear·list, 언더레이 소스 거부). 커넥터 재푸시 시 도색 이관(apply.ts fed-register). 어드버서리얼 리뷰 13건 확정→12 수정+1 수용: **롤아웃 창 한계 = 구빌드 탭이 타입 편집하면 opacity strip(whole-object LWW) — 배포 후 열린 탭 새로고침 안내**. 검증 core 427·interop 109·server 36·paint-smoke 17/17.
  - **사용자 남은 일**: AI 키 + **리전 US**(Anthropic 403 회피) — 키 설정 후 `node apps/web/scripts/agent-live-smoke.mjs` 즉시 실행 가능 · 커넥터 BASE = 이 Railway URL.
- **M16 ✅ (2026-06-27~07-01, 상세 HISTORY ▶M16)**: 멀티포맷 ingest(image/PDF 래스터·**DWG/DXF 클라 WASM 언더레이**·.3dm SOLID) + sketch→markup + UI/UX iter-2(ModeTabs·HubStrip·AI dock) + AI 사진/음성 + **모바일 리뷰/뷰어 셸** + 클레이 렌더·단면(클립) + pull-latest + **야간 멀티에이전트 보안/품질 하드닝**(미인증 WS-DoS·body cap·.mjs MIME 등). **interop "DWG 배제" 규칙 뒤집힘** → 클라 WASM DWG 채택(아래 영역별 규칙 갱신요).
- **M14 실사용 검증 🔄**: 갭 4개 해결. 남은 = 사용자 조율 세션(2기기 동시편집·glTF 정합). 갭 캡처 = `docs/realuse-validation.md`.
- **M17 배포 완료 (master 78e3756 · 위 Primary 참조)**: 야간 Phase 9 + 아침 4항목 전부 라이브. 잔여 후속: poché 완전 DCEL 면추적(현재 sharpest-turn+guard=오채움 없음, 병리적 비매니폴드는 미채움) · 폰 뷰포인트 시트(수신측, 데이터는 이미 채널 공유) · 뷰포인트 라이브 프레즌스(옵션 B, 미채택).
  - ~~아침 결정 대기~~ 전부 해소(2026-07-02 확인): ① 배포됨 ② `create_text` AI 노출 컷 = **이미 구현돼 있었음**(catalog.ts에서 capability 주석 처리 — AI 도구는 27종) ③ 공유 뷰포인트 구현·배포됨 ④ poché 구현·배포됨.

### 다음 작업 (재계획 대상 — eyes-open)
- **자율 개선 루프 ✅ (2026-07-12, master 머지 `1732919`(24커밋) → **2026-07-13 배포됨**(위 Primary), 검토 = `MORNING_SUMMARY.md`·`LOOP_LEDGER.md`)**: ① **검증 인프라** — 스모크 통합 러너(`run-smokes.mjs` 29종 자동, miniflare 전용 라우트 실측 매니페스트) + apps/web 첫 vitest(71케이스: CameraRig·걷기 충돌 시뮬·기즈모·핫키·Picker) + root T0 = 665 ② **뷰 시스템 A-S1~S4 완주**(`view-and-simplicity-plan.md` A파트) — 입면 true ortho(8b)+거울상 X반사 교정·full-sphere 오빗(π−0.05)·포즈 트윈+Auto Perspective(§C-5 거리 절충)·축-공 기즈모(N/E/S/W·드래그 오빗) ③ **B-P1 AI ui-action 6종**("2층 평면 봐줘" — 순수 뷰=즉시/혼합=승인 후, category 'view') ④ **걷기 v1.1** — 벽 충돌(관통 2경로 실증·차단)·three-mesh-bvh·클립 인지 스냅 ⑤ 서버 blob GC+커밋 레이트리밋(M6.5 TODO 해소)·폰 뷰포인트 시트·데스크톱 핫키 14종. adversarial 리뷰 5라운드 87제기→81확정 수정(critical 3: 입면 그레이징 1e20mm 문서오염·기즈모 캡처 클릭 전멸·걷기 관통). ~~머지+배포~~ 완료(2026-07-13). **잔여 사용자 확인**: AI 키(ui-action 실왕복) · bottom=RCP 관례 · plan 진입 스윙 시각 확인 · Auto Perspective 도착 미러 팝. 남은 백로그 소품: poché DCEL·B-P0/P2(아이패드 감각 필요)·web 테스트 부채.
- **Presence 소품 리뷰 ✅ (2026-07-13, `8ad1672`)**: 루프 큐 잔여 리뷰 — 3렌즈×33에이전트, 제기 10/확정 10. 수정 6건: IME 가드 WebKit 무효(compositionend 선행 → 60ms 창 가드) · 아바타 재탭 커밋+닫기(Chromium 재오픈 루프/WebKit 무음 폐기) · import(qrcode) 실패 폴백(스테일 탭 404) · clipboard 비보안 컨텍스트 가드 · 팝오버 상호 배타 · [major] ux-smoke QR 공허 단언(투명 캔버스 통과 → 불투명 암+명 요구). + `b85a681` ref-interact DWG 픽스처 부재=SKIP 규약.
- **다음 메인 트랙 = 레벨 구조화 (계획 확정, `docs/level-structuring-plan.md`)**: G2 잔여 멀티레벨 배정. 리서치(5영역 맵+설계 2안+판정) 결론 = M1 리포트-온리 감지기 → M2 dedup 키 절대z 정규화(**서버 선배포 필수**) → M3 커넥터 v0.7 방출 → M4 스모크/문서 → M5(옵션) in-place 마이그레이션. 소유자 결정 7건은 계획서 참조(지반 datum·dedup 시맨틱·층 이름 관례 등).
- **G2 모델링 충실도 루프 ✅ (2026-07-03, 커넥터 v0.6 = `f1527ca`)**: **충실도 계측 신설**(FIDELITY 리포트 — 요소별 원본 brep bbox vs 파생 bbox, PASS ≤10mm/WARN ≤50/BAD >50/표현한계 분리) → 실모델 260629 **실제 push**(사본 headless — 원본 무접촉, 794 적용·실패 0) 측정 → z축 표현한계 27건 발견(슬라브 z 18.4m·계단 상승 고정) → **core 어휘 확장: slab.zOffset + stair.rise**(optional·back-compat, 스키마→derive→ops→AI→interop→lint 중복키→dedup vertKey 관통) + 커넥터 실측 방출 + TryStairFit 정점투영·면적비 자기검증(이형 계단 0.5~1m 오차 리프트 → bbox 폴백). **결과: 측정 782/782 PASS(전 kind Δ≤1mm)·BAD 0·표현한계 0**, 계단 20/32 파라 Δ0. 잔여 알려진 한계: 멀티레벨 배정(전부 1층, zOffset이 z는 보존 — 레벨 구조화는 별도 트랙)·이형 계단 12 bbox 폴백·난간=포스트 재구성 형상(위치·높이 정확).
- **G Brep 리프트 튜닝 ✅ (2026-07-02, 커넥터 v0.5)**: 골든 씬 하네스(`connectors/rhino/testlib/` DLL을 Rhino MCP로 로드 + `connector-golden.mjs` 18단언 + 2회 push dedup 검증)로 버그 3개 실증·수정 — 큐브 float 동점 beam 통과(aspect +1mm 엡실론) · 평판→폭2m 보 과분류(**타당성 상한** 보 폭≤1200·춤≤2500 / 기둥≤2000 / 벽≤1500, `figcad:kind`/레이어맵 명시 지정은 스킵) · H보 자기축 회전 함정. **stair/railing 파라메트릭**: 직선 계단 tread 검출(z-클러스터·등간격·선형 진행)→`create_type stair{width,riser}`+실주행축, 난간 실측 높이 타입(시드 의존 제거). 실파일 260629(5867객체) census: 계단 20/32 파라(w1250~1400·riser150/167)·곡선 12 bbox 폴백·col100/beam210/wall77 무손실. G 잔여: L-PARKING(매칭 kind 없음)·logo/glass = Lane-2 유지.
- **D .3dm 네이티브 한계**: Mesh 객체 .3dm만 지원. pure-Brep/블록 Rhino(예 260617=Instance687·Mesh0)=빈오버레이 → glTF 경로.
- **E 3D-Tiles HLOD**: 대형 신규 뷰어 서브시스템(436MB 스트리밍). 재계획서 결정. F6 전체 federation과 페어.
- **소품**: ROOM_KEY per-room=단일키 가정(문서화) · 곡선벽 re-import sagitta=v1.5(우리 export=폴리라인 자기왕복 무관).

## 4대 불변 규칙
1. 지오메트리는 문서에 저장·동기화 안 함 — 파라미터에서 순수 함수 파생.
2. 모든 문서 변경은 DocStore ops 경유 (yjs import는 core·collab 밖 금지).
3. React/DOM은 렌더 루프 금지 — HUD는 명령형 DOM, React는 패널만.
4. 펜=도구, 터치=카메라 (팜 리젝션, InputManager 격리).
상세: `../CLAUDE.md` + `../.claude/rules/` (path-scoped).

## 문서 위치 (투명성)
- **이 파일** = repo 내 lean SoT (현재 위치 + 다음 작업 + 규칙 + 맵 + 백로그 + 함정).
- **완료 마일스톤 상세·배포 Version ID**: `docs/HISTORY.md` (M0~M9·M11~M13.6 + M14/M15 빌드 상세).
- 전체 히스토리 상세 플랜: `~/.claude/plans/figma-lazy-milner.md`(M0~M10) · `wondrous-hugging-pebble.md`(M11·M12) · `docs-fuzzy-micali.md`(M13·M14·M15).
- 메모리 인덱스: `~/.claude/projects/C--Users-user-Documents-LFTH-Figcad/memory/MEMORY.md`.
- 영역별 규칙: `.claude/rules/*.md` (해당 경로 작업 시 로드).
- 포지셔닝 결정: **`docs/positioning-vs-mcp.md`** (2026-06-18 — 결론: viewer 아님·모델러 아님 = **편집가능 중립 조율 허브**. 해자=실시간·웹·중립[AI는 table-stakes]. 모델링=*입력 UI 가볍게+파라메트릭 어휘 풍부+멀티모델 라이브 허브가 진짜 일감*. §8 인제스트=**PR primitive**, 동기화=툴↔허브 git + 사람↔허브 실시간).
- 외부 벤치마크: **`docs/hub-benchmark-review.md`** (협업·인터롭 플랫폼 Speckle·Onshape·Figma·Omniverse·3D Tiles 대비, 정체성 기준 deep research 3패스).
- 데이터구조 근본연구: **`docs/geometry-representation-study.md`** (3D 표현 통합. 결론 = Figcad는 recipe-tree-CRDT의 degenerate, 제안 = 3층 머지[movable-tree CRDT + field-LWW + post-merge lint critic]. **§9 운영결론**: F-rep 강등·AI-freeform=파라미터 편집·import=lift-what-maps+Lane-2 잔여+AI clean-up).

## v1.5 백로그 (감독 하 진행)
| 항목 | 판정 |
|---|---|
| BCF 이슈 왕복(G4) | 워크플로-게이트(외부사 openBIM 교환 실수요 시). 재료 보유(Comment·`ifcGuidFromId` 안정 GUID·viewpoint). 파일 `.bcfzip`=데스크톱 표준 |
| per-kind NodeDefinition 레지스트리(§5) | XL·High — silent if-chain(`.claude/rules/core-geometry.md` 10단계 체크리스트). **KIND_LABEL ✅**(`9301d3c`) · **def.positional ✅ S1~S3**(`4071276`+`67b1430`, `POSITIONAL` 선언+golden/enumerated 가드 → move/rotate/transformCopy/footprint 단일소스 dispatch, FULLY EQUIVALENT). 남은 슬라이스 후보: `def.derive`(geometry/index 디스패처)·`def.ifc/rhino/dxf`(interop)·`def.lint`(dup-key) — 각 감독 하 |
| F6 전체 federation | M12-C 설계문서(`federation-design.md`)가 스펙. F9 3D-Tiles HLOD(436MB 웹뷰 유일 검증답)와 페어 |
| F2 branch/merge | 스파이크 선행 — CRDT가 라이브 자동해결 → offline-divergent 버전에만 |
| G2 Cloud2BIM scan→BIM · G3 Speckle-Automate 룰QA(M12-B 후속) · G5 IFC Pset 패스스루 · **F5 파라 역-import(기둥+보 ✅ `f13b771`, 남은 kind=기하베이크 skip)** · F7 USD 레인 · H2 멀티에이전트(입증 시만) | CONSIDER |

**REJECT (실수 빌드 금지):** H5 op 위 free-form 코드레이어(불변② 우회) · H6 메시bake 생성AI(불변① — ops/파라미터만) · pascal 플러그인 마켓(YAGNI, 소비자 0).
**미답 = 딥리서치 부적합:** 생성/개념설계 AI(약한절반) · 경쟁지형 Arcol/Motif/Qonic/Forma — 포지셔닝 맵+불변 엣지 렌즈 필요.
**KEEP (빌드 안 함):** F1 실시간코어(Yjs CRDT, Figma보다 앞섬) · F5 손실 비대칭=업계표준 · F8 wasm32 4GB→커넥터 경로 검증 · F4 Speckle 컨버터=우리 설계 옳음 검증 · F3 버전 diff=M11.5로 충족(3D 고스트만 v1.5).

## 함정 (반복비용 큰 것)
- **Railway primary**: `DATA_DIR=/data`, `numReplicas=1`, Dockerfile 빌드. AI는 `ANTHROPIC_API_KEY` + US 리전.
- **Cloudflare rollback**: `wrangler.jsonc` compat 2개(`no_websocket_standard_binary_type`·`nodejs_compat`) + bash `wrangler secret put`. DO 무료 일일한도는 지속 WS에 부적합(Primary가 Railway라 회피).
- **Anthropic strict tool use 금지**(grammar 400) — executeOp 런타임 검증으로 충분.
- **로컬 데브**: dist 재빌드 후 miniflare(dev.mjs) **반드시 재시작**(에셋 staleness → 흰화면) + 좀비 프로세스 kill. dev = vite :5173 + 백엔드 :8787(`config/backend.ts` DEV 기대포트).
