# Figcad 로드맵 (repo 내 SoT)

> 버전관리되는 lean 상태판. 폴더에 보이고 git에 남고 compact 생존. **현재 위치 + 다음 작업 + 불변 규칙 + 문서맵 + 백로그 + 함정**만 — 완료 마일스톤 상세는 `docs/HISTORY.md`.
> **정체성 — 3축: 웹 · 실시간 · AI.** **웹**(브라우저, 설치 없음 / iPad Pencil + 데스크톱) · **실시간**(여러 툴 모델·도면 + 여러 사람을 한 화면에서 동시에) · **AI**(손그림→모델, 에이전트 편집). Rhino·CAD·Revit의 모델·도면을 **실시간으로 모아 같이 보고 빚는** 멀티툴 협업 허브 — IFC/DXF/.3dm 양방향 인터롭. 대조·sketch·조율은 거기서 파생. (정밀 모델링·납품도면 *제작*은 전문툴 몫, Figcad는 모으고·조율 — LOD 100~250 수준. "상류"·"핸드오프"=단방향 함의라 안 씀.)

## 현재 상태 (Current)

- **Primary = Railway (라이브 배포중)**: **https://lfthfigcad-production.up.railway.app** (Node 백엔드, Dockerfile). 최신 배포 = **M16**(라이브 `index-BIHtcVP9.js`, master `c8670cf`). CF(`figcad.archivibe.workers.dev`)는 rollback용. 배포가이드 `docs/RAILWAY_DEPLOY.md`.
  - **사용자 남은 일**: AI 키 + **리전 US**(Anthropic 403 회피) · 커넥터 BASE = 이 Railway URL.
- **M16 ✅ (2026-06-27~07-01, 상세 HISTORY ▶M16)**: 멀티포맷 ingest(image/PDF 래스터·**DWG/DXF 클라 WASM 언더레이**·.3dm SOLID) + sketch→markup + UI/UX iter-2(ModeTabs·HubStrip·AI dock) + AI 사진/음성 + **모바일 리뷰/뷰어 셸** + 클레이 렌더·단면(클립) + pull-latest + **야간 멀티에이전트 보안/품질 하드닝**(미인증 WS-DoS·body cap·.mjs MIME 등). **interop "DWG 배제" 규칙 뒤집힘** → 클라 WASM DWG 채택(아래 영역별 규칙 갱신요).
- **M14 실사용 검증 🔄**: 갭 4개 해결. 남은 = 사용자 조율 세션(2기기 동시편집·glTF 정합). 갭 캡처 = `docs/realuse-validation.md`.
- **진행중(feat/prd-loop, 미배포)**: 기획자-개발자 자율 루프 — 폰 리뷰 동사·pull-latest 완료, 오버레이 3D 코멘트·섹션라인 등 진행.

### 다음 작업 (재계획 대상 — eyes-open)
- **G Brep 리프트 튜닝**: 로컬 end-to-end 실증 완료, **보 과분류 튜닝** 남음 (`docs/brep-lifting-2026.md`). G 잔여: L-PARKING(78=매칭 kind 없음)·logo/glass = Lane-2 유지. stair/railing 곡선 = bbox 근사(v1.5 파라).
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
