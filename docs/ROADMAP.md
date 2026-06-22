# Figcad 로드맵 (repo 내 SoT)

> 버전관리되는 lean 상태판. 폴더에 보이고 git에 남고 compact 생존.
> **정체성 — 3축: 웹 · 실시간 · AI.** **웹**(브라우저, 설치 없음 / iPad Pencil + 데스크톱) · **실시간**(여러 툴 모델·도면 + 여러 사람을 한 화면에서 동시에) · **AI**(손그림→모델, 에이전트 편집). Rhino·CAD·Revit의 모델·도면을 **실시간으로 모아 같이 보고 빚는** 멀티툴 협업 허브 — IFC/DXF/.3dm 양방향 인터롭. 대조·sketch·조율은 거기서 파생. (정밀 모델링·납품도면 *제작*은 전문툴 몫, Figcad는 모으고·조율 — LOD 100~250 수준. "상류"·"핸드오프"=단방향 함의라 안 씀.)

## M15 — Cloudflare → Railway 이주 (Node 백엔드) ✅ 배포완료 (2026-06-22)
> 라이브: **https://lfthfigcad-production.up.railway.app**. CF DO 무료 duration 한도 초과(지속 WS=룸 24h 과금, 실시간 허브엔 구조적) → 내부툴은 Railway 정액이 적합. 플랜 `~/.claude/plans/docs-fuzzy-micali.md` ▶M15 · 메모리 `figcad-railway-migration` · 배포가이드 `docs/RAILWAY_DEPLOY.md`. **core/geometry/interop/UI 0변경**(전송+저장+배포만).
- **빌더 = Dockerfile**(node:22): nixpacks 4연속 실패(Node/pnpm 버전지옥·.NET 오판) → Dockerfile 결정적. 배포 검증 전부 green(빌드·서빙·라우트·**WSS 실시간**·**볼륨 /data 영속**·numReplicas=1).
- **사용자 남은 일**: AI 키 `railway variables --set ANTHROPIC_API_KEY=`(시크릿) + **리전 US 확인**(Anthropic 403 회피) · 커넥터 BASE=이 URL · CF 롤백용 유지.
- **핵심**: 이주가 "전송층 재작성" 아님 — `dev-node.mjs`가 이미 Node WS Yjs 동기화(클라 provider 호환). 순수 핸들러(apply/federation/version/agent=Web-standard)는 R2→BlobStore 추상화만 하면 Node 재사용.
- **P1 BlobStore**(R2BlobStore+DiskBlobStore, federation/version 파라미터화, 비-fork=CF 유지) · **P2 node-server.ts**(dev-node 승격+?op= 배선+룸 mutex+DiskBlobStore+esbuild 번들) · **P3 config/backend.ts**(클라 5곳 단일소스, 단일서비스 same-origin) · **P4 로컬검증**(멀티플레이어 e2e·Railway-mode 부팅·fed/version/origin/AI배선/영속) · **P5 Dockerfile+railway.json+배포가이드**.
- 검증: core 353·interop 41(+3)·server 13(+3)·tsc 0·web build·node 번들. Windows 경로버그 수정(DIST 절대화).
- **다음(사용자)**: AI 키/US 리전 확인 + 커넥터 BASE를 Railway URL로 변경. 미배포분 M12~M14.1은 M15 Railway 빌드에 포함 완료. CF는 롤백용 유지.

## M14 — 실사용 검증 (배포 + 조율 세션 + 갭 해결) 🔄 진행
> 전략문서 재정독 결론: 해자(중립+편집+실시간 멀티플레이어 ON federation)가 **미배포라 aspirational** · Qonic GA·Motif 압박. 사용자 결정 = **실사용 검증 우선**(빌드 최소·학습 최대). 플랜 `~/.claude/plans/docs-fuzzy-micali.md` ▶M14/M14.1 · 갭 캡처 `docs/realuse-validation.md`.
- **배포 ✅ (2026-06-21)**: `https://figcad.archivibe.workers.dev` Version `ed8fcb97`. M12+M13 전체. 스모크 green(root/asset·origin·pull·fed왕복 R2·ANTHROPIC secret·**AI end-to-end 403없음**). 멀티플레이어 동시작업 실확인.
- **실모델 검증 갭 4개 → 전부 해결 (M14.1, 2026-06-22)**:
  1. 위치 원점서 멀다 = 사용자 .rhp 옛버전이 근본 → `connectors/rhino/figcad-push.cs`(현 로직, .rhp 우회) recenter 원점 50m.
  2. 프레임이 라이노보다 단순 = 의도(편집가능 구조 추상, 버그 아님).
  3. **glTF 오버레이 north ~140m 어긋남 = FIXED** — 박스 실험 측정→Z 부호반전(`@figcad/interop/coords`), 4중 검증(측정·단위·통합 bbox 게이트·시각).
  4. 인식 커버리지 = 정상(구조 S-Slab 정확, 비구조 parking/ceiling/외피=Lane-2+오버레이).
- **세션**: 사용자 — `figcad-push.cs`/새 .rhp로 push + glTF 오버레이 정합 + 2기기 조율.
- **미룸(재계획)**: E 3D-Tiles · ingest=PR · 조율 워크플로 성숙. **오버레이 fix는 M15 Railway 배포에 포함**.

## 4대 불변 규칙
1. 지오메트리는 문서에 저장·동기화 안 함 — 파라미터에서 순수 함수 파생.
2. 모든 문서 변경은 DocStore ops 경유 (yjs import는 core·collab 밖 금지).
3. React/DOM은 렌더 루프 금지 — HUD는 명령형 DOM, React는 패널만.
4. 펜=도구, 터치=카메라 (팜 리젝션, InputManager 격리).
상세: `../CLAUDE.md` + `../.claude/rules/` (path-scoped).

## 문서 위치 (투명성)
- **이 파일** = repo 내 lean SoT (현재 위치 + 마일스톤 상태).
- 전체 히스토리 상세 플랜: `~/.claude/plans/figma-lazy-milner.md` (M0~M10).
- 현 작업(M12) 플랜: `~/.claude/plans/wondrous-hugging-pebble.md` (벤치마크→ADOPT 스프린트 + 자율 실행 하드게이트).
- 메모리 인덱스: `~/.claude/projects/C--Users-user-Documents-LFTH-Figcad/memory/MEMORY.md`.
- 영역별 규칙: `.claude/rules/*.md` (해당 경로 작업 시 로드).
- 포지셔닝 결정: **`docs/positioning-vs-mcp.md`** (2026-06-18 — MCP 시대 가치·모델링 범위·인제스트/동기화. 결론: viewer 아님·모델러 아님 = **편집가능 중립 조율 허브**. 해자=실시간·웹·중립[AI는 table-stakes]. 모델링=*입력 UI 가볍게+파라메트릭 어휘 풍부+멀티모델 라이브 허브가 진짜 일감*. 가치갭=ReferenceLayer dev-flag UI 미배선. §8 인제스트=**PR primitive**[import→staging AI clean-up→merge, 커넥터는 메타데이터 통과], 동기화=**툴↔허브 git + 사람↔허브 실시간**, Speckle backbone=검증·파이프위 editable로 이김·stream API ingest 옵션).
- 외부 벤치마크: **`docs/hub-benchmark-review.md`** (유일·현행 — 협업·인터롭 플랫폼 Speckle·Onshape·Figma·Omniverse·3D Tiles 대비, 정체성=웹·실시간·AI 허브 기준 deep research 3패스). 구 조사 modeling-tools-review(저작기능 렌즈, off-identity)·pascal-editor-review는 **삭제됨** — 쓸 만한 부분(IFC Pset/Translator 인터롭 = §8 G5, pascal per-kind 레지스트리 = §5)은 hub-benchmark로 이관.
- 데이터구조 근본연구: **`docs/geometry-representation-study.md`** (3D 표현 통합 — 3패스 딥리서치 + F-rep fetch. 결론 = Figcad는 recipe-tree-CRDT의 degenerate, 제안 = 3층 머지[movable-tree CRDT + field-LWW + post-merge lint critic]. **§8 = 라운드트립 정밀화**[parametric 2종·손실은 약한커널-편집-되올리기·"최고수준 recipe 저장" 규칙]. **§9 = 운영 결론**[**F-rep 강등**=이기는 축 없음(인터롭서 B-rep에 짐 — 지배 엔드포인트가 B-rep 커널)·**AI-freeform=파라미터 편집**(곡선 어휘)·**import=lift-what-maps+Lane-2 잔여+AI clean-up**]. **빌드 4개**: 머지 lint(=hub-benchmark §9, 첫 빌드)·Lane-2 원본 보관·파라메트릭 곡선 어휘·AI clean-up 패스. F6 federation·`federation-design.md`와 페어).

## 완료 (M0~M9)
| M | 내용 | 상태 |
|---|---|---|
| M0 | 스캐폴드·Three 뷰포트·Worker+DO 스텁 | ✅ |
| M1~1.6 | core(스키마/스토어/파생/스냅)·벽 그리기/편집·마이터 조인·Rhino/ArchiCAD UI | ✅ |
| M2 | 멀티플레이어(Yjs·presence·소프트락·사용자별 undo) | ✅ |
| M3/3.5 | 문/창/슬라브/그리드/레벨 + 편집도구 7종 | ✅ |
| M4 | AI 모드(드라이런+승인+applyOpLog, /api/agent SSE) | ✅ |
| M5/5.5 | lint 8종 + PWA·JSON·타입편집·2K 스트레스 | ✅ |
| M6 | git식 버전관리(커밋=해시 blob→R2, diff/복원) | ✅ |
| M7 | interop(IFC 파라메트릭·.3dm 지오·DXF 2D) | ✅ |
| M8 | Capability Registry·드래그선택·아이콘·구조요소(기둥/보/계단/난간/지붕)·주석(치수/텍스트) | ✅ |
| M9-A | AI 스케치→모델(Pencil 손그림→vision→승인) | ✅ |
| M9-B | 협업 코멘트(요소앵커 스레드, LWW) | ✅ |
| M9-C | MCP 프로그래머블 API | ↩️ 구현 후 YAGNI 제거 (소비자 0; 메커니즘은 M10 ?op=apply로) |

과거 Cloudflare 배포: https://figcad.archivibe.workers.dev (현 primary는 M15 Railway)

## M11.5 — UX 폴리시 (사용성 7건) ✅ 배포 `73eef3be`
실사용 피드백 수정. 상세 = `~/.claude/plans/wondrous-hugging-pebble.md`.
- [5] 폴리곤 미리보기(슬라브/지붕/존) 펜 탭 stale 수정 · [2] 하단바 스토리 스위처(3D 유지) · [3] 줌버튼 제거 · [1] 네비게이터 2D뷰 클릭=도면열림(Revit Project Browser 관례) · [4] 색상 구조화 버전 diff(초록/빨강/호박) — 커밋 `9a6e655`.
- [6] 커튼월 유리 패널(반투명 자식 메시) `4405f10` · [7] 객체 정점 편집(슬라브/지붕/존 그립)+커튼월 핸들·이동 `b1163ce`.
- 검증: core 239·interop 30·tsc·build·ux-smoke(7항목 도구 직접 구동). 6·7 멀티에이전트 리뷰 4건 수정. **배포 완료** `73eef3be`(M10-D1 동반).

## 완료 (M11) — 잔여 기능 + 도면생성 + 검증 ✅
> 자율 구현, Phase 경계마다 커밋 + cadence(core 테스트·tsc·스모크·E2E·멀티에이전트 리뷰).

| Phase | 내용 | 상태 |
|---|---|---|
| **0** | 문서/컨텍스트 일관성(이 파일·rules·compact 지침) | ✅ |
| **1** | 도면생성 평면+단면+입면 + 해치 (정체성 핵심) | ✅ 배포 b9f0f98f |
| **2** | 요소: 존 ✅ · 커튼월 ✅ · 라벨 ✅ | ✅ 완료 (라벨=goal 자율 run) |
| **3** | M6.5 fork (스냅샷→새 룸) | ✅ 완료 |
| 4 | M10 connector — D-1 라이브쓰기 ✅ · D-2 Rhino 커넥터 코어 ✅(MCP 검증, `.rhp` 셸만 남음) | 양방향 왕복 동작 |
| 5 | 검증 (260416 MODELING.3dm 436MB) — 커넥터로 실증 ✅ | `docs/VALIDATION_260416.md` |

**현재 위치: M10 커넥터 양방향 작동 + 416MB 실파일 검증까지 완료.** D-1 배포 `73eef3be`. D-2 커넥터 코어(`connectors/rhino/`, Rhino MCP 라이브 검증) · Task E(436MB→커넥터로 4초 read+1.5초 push, `docs/VALIDATION_260416.md`). 남음 = `.rhp` 패키징(.NET 밖) · v1.5(brep 시맨틱 리프팅·IFC 갭 등).
- Phase 1 ✅: 평면(절단/투영/해치 even-odd) + 단면(cut (u,z)) + 입면(박스매싱 painter HLR) + DXF + views(schemaVersion 3). 멀티에이전트 리뷰 1건(해치) 수정.
- Phase 2 ✅: 존(IfcSpace, 면적/부피) + 커튼월(UV 멀리언 그리드) + **라벨**(Revit 태그 — targetId 바인딩+template[name/area/custom]+leader, 타깃 추종/고아 fallback). 신규 kind 완전 배선(커밋 7c649e7 존 = **템플릿**). interop=주석류 의도적 스킵(텍스트는 drawing DXF 경유).
- Phase 3 ✅: fork(클라 주도 — 한 버전 스냅샷→새 룸. 서버 DO storage 격리라 클라 importSnapshot).
- 라벨 ✅(`bc45a73`, 배포 `d5daa8c2`): Revit 태그 — targetId 바인딩+template(name/area/custom)+leader, 타깃 추종/고아 fallback. 멀티에이전트 리뷰 4건 수정(major 1=평면 솔리드박스 고스팅 가드).
- 남은 당시 목표는 M10 connector(Task D, .NET) · 검증(Task E, 416MB·네이티브 툴)이었고, 이후 M13~M15에서 별도 진행/검증됨.

### Phase 요지 (상세는 wondrous-hugging-pebble.md)
- **1 도면생성**: 3사 공식 합의 = 단면=절단면∩지오메트리(굵은선+poché) + 투영(가는선) / 입면=정사영+은선제거. 우리는 edges/footprint 소유 → 절단면∩메시·정사영 직접 계산, 은선제거=depth-sort. `views` 맵(파생, 미저장) + `deriveDrawing` + `hatch`(라인패턴). 1a 평면+해치→1b 단면→1c 입면.
- **2 요소**: curtainwall(UV그리드+멀리언 extrudeProfile 재사용), zone(수동 boundary+면적/체적, IfcSpace), label(text 확장 — 바인딩+템플릿+지시선). new-kind 체크리스트(`.claude/rules/core-geometry.md`).
- **3 fork**: `?op=fork` = 커밋 스냅샷→새 룸(importSnapshot 재사용). branch/merge/허브UI=v1.5.
- **4 connector**: 결정적 — Rhino 플러그인 + `?op=apply`(라이브쓰기) + 컨버터. MCP 아님. AI 시맨틱리프팅(brep→파라메트릭)=v1.5.
- **5 검증**: 260416=436MB → 브라우저 통짜 import 불가(WASM 캡), subset/connector 경로로. 현 .3dm import는 wall/slab/grid만(나머지 스킵 = 갭). 에러·속도·안정성·네이티브 왕복.

## M12 — 벤치마크 ADOPT 스프린트 (`hub-benchmark-review.md` → 실행)
> 3패스 조사 채택거리를 정체성 게이트로 실행. 자율 야간 빌드(하드게이트 = 플랜 파일). **재평가: BCF=v1.5 강등**(LFTH는 전원 Figcad 내 조율, 크로스툴 이슈교환 실수요 약함) · **F6=정체성 핵심이나 야간엔 스파이크만**(전체=v1.5).

| 항목 | 내용 | 상태 |
|---|---|---|
| A 문서 | 벤치마크 → SoT 반영 (이 섹션) | ✅ `2514766` |
| B lint-in-loop critic | AI 루프에 결정적 lint 자기수정(H3/H4) — `agent.ts` end-of-loop(`critiqueOpLog`, core `ai.ts`), AI-touched만, error 재프롬프트(≤2라운드), 외부 검증자만(LLM 판사 금지) | ✅ `f5112dc` |
| C F6 스파이크 | 읽기전용 레퍼런스 지오 채널(격리·개발플래그, `ReferenceLayer.ts`) + `docs/federation-design.md`(v1.5 전체 스펙) | ✅ `120b9cf` |
| iter1 F5 역-import | IFC/.3dm 파라 역-import — 기둥+보(깨끗한 파라메트릭만) | ✅ `f13b771` |
| iter2 KIND_LABEL | lint·diff 공유 라벨 schema.ts 단일소스화 (§5 per-kind 레지스트리 첫 슬라이스) | ✅ `9301d3c` |
| def.positional S1 | `POSITIONAL` 레지스트리 선언 + golden/enumerated 안전망 (순수 additive, 동작변경 0) | ✅ `4071276` |
| def.positional S2+S3 | move/rotate/transformCopy/footprint를 `POSITIONAL` 단일소스 dispatch로 (4 손-중복 제거, 특수훅 명시 유지). audit+멀티리뷰=FULLY EQUIVALENT, core 320 0변동 | ✅ `67b1430` |

신규 의존성 0 · 스키마 0 · 당시 **미배포**(이후 M15 Railway 빌드에 포함). 검증: core 245(+6)·tsc·build·reference-layer-smoke 4/4·멀티에이전트 리뷰(B 3건·C 2건 수정).

## M13 — 멀티모델 라이브 허브 (정체성 피벗) 🔄 진행
> `positioning-vs-mcp.md` 피벗 실행: 모델링 깊이 그만, **멀티모델 라이브 federation 허브**를 켠다(정체성 핵심 미빌드분). 플랜 = `~/.claude/plans/docs-fuzzy-micali.md`. 자율 풀푸시(빌드 A→E + 연구 R1~R4 병렬) · **미배포**(승인 게이트).

| Track | 내용 | 상태 |
|---|---|---|
| **A 허브** | federation Y.Map 채널(comments/views 패턴, snapshot 4경로, SCHEMA v3→4) + ReferenceLayer 프로덕션 승격 + FederationReconciler(명령형, gen-guard, sig early-out) + 추출기 figcad-room(derive 재사용)·glTF(GLTFLoader)·IFC(web-ifc StreamAllMeshes, 미터·Y-up 라운드트립 게이트) + Navigator "연동 모델" UI | ✅ `24bb355`·`2d9e0bb`·`bde6046` 등 (core 328·interop 33·tsc·build, 리뷰 2건 수정) |
| B 병합 lint 알림 | flag-not-block — DocChange.remote + findingsOn + LintPanel 배너 | ✅ (core 330, 버그 1 테스트가 잡아 수정) |
| C 곡선 벽 어휘 | sagitta 호 중심선 (AI 천장) — 직선경로 바이트 무변경 격리, robustness | ✅ (core 346, 멀티리뷰) |
| C5 곡선 interop | IFC/.3dm/DXF 곡률 보존 export(dense 폴리라인) — arc-export-loss footgun 닫음 | ✅ (interop 35) |
| F federation 페이로드 | 서버 R2(COMMITS) 업로드/blob 라우트(보안 프리픽스 가드) + Navigator glTF/IFC 업로드 → 협업자 공유. **첫 서버변경** | ✅ (server 10) |
| **G Brep 기계적 리프트** | 적중률 측정(실모델 77~94%, 구조요소~100%) → FigcadConnector.PushBreps(cap-pair 인식→기둥/벽/슬라브/보 ops, InstanceXform 재귀, store-original) + .rhp/.yak 플러그인. **로컬 end-to-end 실증**(Rhino→프레임479+glTF오버레이 정합). | 🔶 실증완료·**튜닝 필요(보 과분류)** `docs/brep-lifting-2026.md` |
| M13 줌 익스텐트 | 3D 뷰 fitBounds(요소+레퍼런스, 그리드 제외)+'F'키+federation 자동맞춤 — import/federation 빈화면 해결 | ✅ `b5dd312`·`2cde809` |
| M13 projectOrigin | recenter+기억 라운드트립 무손실(Revit Base Point) — DocMeta.projectOrigin(v5)·rebaseSnapshot(±1 단일경계)·서버 ?op=origin·interop export 복원·federation 오버레이 정합·커넥터 PushBreps recenter. MCP 검증(원점 1959m→42m, origin 기억) | ✅ (core 350·라운드트립 테스트) |
| **D·E** | .3dm 네이티브·3D-Tiles | ⬜ 다음 |
| R1 머지 스파이크 | coordination-free 머지 = 무효 잦으나(~100%) lint 100% 검출 → 경로A 조건부 생존·**M13-B 필수**·서버권위 불필요 | ✅ `docs/merge-spike-results.md` |
| R2 brep SOTA | ML 미성숙(전부 합성벤치) — G1 DEFER 정당. 기계적 sub-case→G로 실현 | ✅ `docs/brep-lifting-2026.md` |
| R4 경쟁+생성AI | `competitive-landscape.md`(Motif·Qonic 위협)·`generative-ai-scope.md`(ingest clean-up=ADOPT·mesh-bake REJECT) | ✅ |

**불변①**: 외부 모델 = 별도표현(ReferenceLayer, Y.Doc 미진입), 채널엔 ref만. **store-original**: 좌표 안 옮김 → 라운드트립 무손실 by construction(부지좌표 ~1.96km도 jitter 0, fitView가 카메라 담당). **A4 게이트**: snapshot→derive bbox+vertex 정합.

## M13.5 — G 인식 v2(레이어-시맨틱) + Codex 리뷰 5건 ✅ (2026-06-21)
| 항목 | 내용 | 상태 |
|---|---|---|
| **G2 레이어-시맨틱** | 순수 지오가 H형강서 fragile → **레이어 full-path가 kind**(S-Column=기둥·S-Connection=보·A-Wall=벽·S-Slab=슬라브), 지오는 params. 오분류 0. MCP 실증 기둥109·보130·벽77·슬라브10(이전 보 353 garbage→130 정확). dotnet build 통과. | ✅ `2152d16` |
| Codex #1 High | ROOM_KEY federation pull — fetch 시 로컬 ?key=(ref 미저장) | ✅ `f3a3767` |
| Codex #2 High | 곡선 벽 개구부 차단(createOpening/updateElement throw)+lint(arc-wall-opening, import backstop)+OpeningTool 거부 | ✅ `f3a3767`·`2323a56` |
| Codex #4 Med | fitView 숨긴 소스 제외 — visibleBounds(root.visible+per-source) | ✅ `f3a3767`·`2323a56` |
| Codex #5 Low | reload sig에 sourceType(stale loader 방지) | ✅ `f3a3767` |
| 리뷰 후속 | KindFromLayer 토큰매칭(부분문자열 오탐)·visibleBounds root 가드·updateElement 곡선화 가드 | ✅ `2323a56` |

검증: core **353**·tsc·web build·C# 컴파일 clean. 멀티에이전트 리뷰 1패스(3건 수정). 당시 미배포, 이후 M15 Railway 빌드에 포함.

## M13.6 — 마무리 (Pull+origin·.rhp·계단난간·.3dm네이티브) ✅ (2026-06-21)
| 항목 | 내용 | 상태 |
|---|---|---|
| 커넥터 Pull +origin | ?op=origin GET 후 전 좌표 +origin → 원 부지좌표 복원. 라운드트립 무손실(MCP 원좌표 정확 복원) | ✅ `4dfdf42` |
| .rhp 재빌드 | bin/Release/Figcad.rhp 갱신(Pull+origin·G2·recenter·계단난간). Rhino 등록=새 빌드(명령 시 lazy-load) | ✅ |
| G 잔여 계단·난간 | KindFromLayer+RecognizeByLayer stair/railing(MCP 계단47·난간26 전부). L-PARKING/logo/glass=Lane-2 | ✅ `c6251a8` |
| D .3dm 네이티브 | import3dmMeshes(Mesh객체 Z-up→Y-up)+extract3dm+'3dm'등록+Navigator. 게이트 rhino-meshes 3 | ✅ (interop 38) |
| 리뷰 후속 | wasm 누수(.delete)·.3dm 빈오버레이 throw/warn | ✅ |

검증: core 353·interop **38**·server 10·tsc·web build·dotnet build clean. 멀티리뷰 1패스(3건). 당시 **미배포**, 이후 M15 Railway 빌드에 포함.
**D 한계(정직)**: Mesh 객체 .3dm만(SketchUp·메시모델). pure-Brep/블록 Rhino(260617=Instance687·Mesh0)=빈오버레이→glTF 경로.

### M13 남은 일 (재계획 대상 — eyes-open)
- **E 3D-Tiles HLOD**: 대형 신규 뷰어 서브시스템(436MB 스트리밍). 재계획서 결정.
- **배포**: M12+M13은 이후 M15 Railway 빌드에 포함 완료. Cloudflare `wrangler deploy`는 rollback 경로.
- **G 잔여**: L-PARKING(78=매칭kind 없음)·logo/glass=Lane-2 유지. stair/railing 곡선=bbox 근사(v1.5 파라).
- **소품**: ROOM_KEY per-room=단일키 가정(문서화) · 곡선벽 re-import sagitta=v1.5(우리 export=폴리라인 자기왕복 무관).
- **로컬 데브 함정**: dist 재빌드 후 miniflare(dev.mjs) **반드시 재시작**(에셋 staleness → 흰화면) + 좀비 프로세스 kill.

## v1.5 백로그 (감독 하 진행)
| 항목 | 판정 |
|---|---|
| BCF 이슈 왕복(G4) | 워크플로-게이트(외부사 openBIM 교환 실수요 시). 재료 보유(Comment·`ifcGuidFromId` 안정 GUID·viewpoint). 파일 `.bcfzip`=데스크톱 표준 |
| per-kind NodeDefinition 레지스트리(§5) | XL·High — silent if-chain(`.claude/rules/core-geometry.md` 10단계 체크리스트). **KIND_LABEL ✅**(`9301d3c`) · **def.positional ✅ S1~S3**(`4071276`+`67b1430`, `POSITIONAL` 선언+golden/enumerated 가드 → move/rotate/transformCopy/footprint 단일소스 dispatch, FULLY EQUIVALENT). 남은 슬라이스 후보: `def.derive`(geometry/index 디스패처)·`def.ifc/rhino/dxf`(interop)·`def.lint`(dup-key) — 각 감독 하 |
| F6 전체 federation | C 설계문서가 스펙. F9 3D-Tiles HLOD(436MB 웹뷰 유일 검증답)와 페어 |
| F2 branch/merge | 스파이크 선행 — CRDT가 라이브 자동해결 → offline-divergent 버전에만 |
| G2 Cloud2BIM scan→BIM · G3 Speckle-Automate 룰QA(B 후속) · G5 IFC Pset 패스스루 · **F5 파라 역-import(기둥+보 ✅ `f13b771`, 남은 kind=기하베이크 skip)** · F7 USD 레인 · H2 멀티에이전트(입증 시만) | CONSIDER |

**REJECT (실수 빌드 금지):** H5 op 위 free-form 코드레이어(불변② 우회) · H6 메시bake 생성AI(불변① — ops/파라미터만) · pascal 플러그인 마켓(YAGNI, 소비자 0).
**미답 = 딥리서치 부적합(§6):** 생성/개념설계 AI(dim4 약한절반) · 경쟁지형 Arcol/Motif/Qonic/Forma(dim6) — 포지셔닝 맵+불변 엣지 렌즈 필요(3패스 다 생존 claim 0).
**KEEP (빌드 안 함):** F1 실시간코어(Yjs CRDT, Figma보다 앞섬) · F5 손실 비대칭=업계표준 · F8 wasm32 4GB→커넥터 경로 검증 · F4 Speckle 컨버터=우리 설계 옳음 검증 · F3 버전 diff=M11.5로 충족(3D 고스트만 v1.5).

## 함정 (반복비용 큰 것)
- Railway primary: `DATA_DIR=/data`, `numReplicas=1`, Dockerfile 빌드. AI는 `ANTHROPIC_API_KEY` + US 리전.
- Cloudflare rollback: `wrangler.jsonc` compat 2개(`no_websocket_standard_binary_type`·`nodejs_compat`) + bash `wrangler secret put`.
- Anthropic strict tool use 금지(grammar 400) — executeOp 런타임 검증으로 충분.
- Cloudflare rollback 사용 시: DO 무료 일일한도는 지속 WS에 부적합. Primary는 Railway라 이 비용 함정 회피.
