# Figcad 로드맵 (repo 내 SoT)

> 버전관리되는 lean 상태판. 폴더에 보이고 git에 남고 compact 생존.
> **정체성 — 3축: 웹 · 실시간 · AI.** **웹**(브라우저, 설치 없음 / iPad Pencil + 데스크톱) · **실시간**(여러 툴 모델·도면 + 여러 사람을 한 화면에서 동시에) · **AI**(손그림→모델, 에이전트 편집). Rhino·CAD·Revit의 모델·도면을 **실시간으로 모아 같이 보고 빚는** 멀티툴 협업 허브 — IFC/DXF/.3dm 양방향 인터롭. 대조·sketch·조율은 거기서 파생. (정밀 모델링·납품도면 *제작*은 전문툴 몫, Figcad는 모으고·조율 — LOD 100~250 수준. "상류"·"핸드오프"=단방향 함의라 안 씀.)

## 4대 불변 규칙
1. 지오메트리는 문서에 저장·동기화 안 함 — 파라미터에서 순수 함수 파생.
2. 모든 문서 변경은 DocStore ops 경유 (yjs import는 core·collab 밖 금지).
3. React/DOM은 렌더 루프 금지 — HUD는 명령형 DOM, React는 패널만.
4. 펜=도구, 터치=카메라 (팜 리젝션, InputManager 격리).
상세: `CLAUDE.md` + `.claude/rules/` (path-scoped).

## 문서 위치 (투명성)
- **이 파일** = repo 내 lean SoT (현재 위치 + 마일스톤 상태).
- 전체 히스토리 상세 플랜: `~/.claude/plans/figma-lazy-milner.md` (M0~M10).
- 현 작업(M12) 플랜: `~/.claude/plans/wondrous-hugging-pebble.md` (벤치마크→ADOPT 스프린트 + 자율 실행 하드게이트).
- 메모리 인덱스: `~/.claude/projects/C--Users-user-Documents-LFTH-Figcad/memory/MEMORY.md`.
- 영역별 규칙: `.claude/rules/*.md` (해당 경로 작업 시 로드).
- 외부 벤치마크: **`docs/hub-benchmark-review.md`** (유일·현행 — 협업·인터롭 플랫폼 Speckle·Onshape·Figma·Omniverse·3D Tiles 대비, 정체성=웹·실시간·AI 허브 기준 deep research 3패스). 구 조사 `modeling-tools-review.md`(저작기능 렌즈, off-identity)·`pascal-editor-review.md`는 **삭제됨** — 쓸 만한 부분(IFC Pset/Translator 인터롭 = §8 G5, pascal per-kind 레지스트리 = §5)은 hub-benchmark로 이관.

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

배포: https://figcad.archivibe.workers.dev

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
- 남은 = **goal prompt**(`docs/GOAL_PROMPT.md`): M10 connector(Task D, .NET) · 검증(Task E, 416MB·네이티브 툴). 둘 다 이 환경 밖.

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
| B lint-in-loop critic | AI 루프에 결정적 lint 자기수정(H3/H4) — `agent.ts` end-of-loop, AI-touched만, error 재프롬프트(≤2라운드), 외부 검증자만(LLM 판사 금지) | ✅ `f5112dc` |
| C F6 스파이크 | 읽기전용 레퍼런스 지오 채널(격리·개발플래그) + `docs/federation-design.md`(v1.5 전체 스펙) | ✅ `120b9cf` |

신규 의존성 0 · 스키마 0 · **미배포**(다음 배포는 사용자 승인 시 — B 서버변경 포함). 검증: core 245(+6)·tsc·build·reference-layer-smoke 4/4·멀티에이전트 리뷰(B 3건·C 2건 수정).

## v1.5 백로그 (감독 하 진행)
| 항목 | 판정 |
|---|---|
| BCF 이슈 왕복(G4) | 워크플로-게이트(외부사 openBIM 교환 실수요 시). 재료 보유(Comment·`ifcGuidFromId` 안정 GUID·viewpoint). 파일 `.bcfzip`=데스크톱 표준 |
| per-kind NodeDefinition 레지스트리(§5) | XL·High — silent if-chain 9파일. `def.positional`(move/rotate/transformCopy/footprint→1)부터 점진. **코어 taxonomy=감독 필수** |
| F6 전체 federation | C 설계문서가 스펙. F9 3D-Tiles HLOD(436MB 웹뷰 유일 검증답)와 페어 |
| F2 branch/merge | 스파이크 선행 — CRDT가 라이브 자동해결 → offline-divergent 버전에만 |
| G2 Cloud2BIM scan→BIM · G3 Speckle-Automate 룰QA(B 후속) · G5 IFC Pset 패스스루 · F5 파라 역-import · F7 USD 레인 · H2 멀티에이전트(입증 시만) | CONSIDER |

**REJECT (실수 빌드 금지):** H5 op 위 free-form 코드레이어(불변② 우회) · H6 메시bake 생성AI(불변① — ops/파라미터만) · pascal 플러그인 마켓(YAGNI, 소비자 0).
**미답 = 딥리서치 부적합(§6):** 생성/개념설계 AI(dim4 약한절반) · 경쟁지형 Arcol/Motif/Qonic/Forma(dim6) — 포지셔닝 맵+불변 엣지 렌즈 필요(3패스 다 생존 claim 0).
**KEEP (빌드 안 함):** F1 실시간코어(Yjs CRDT, Figma보다 앞섬) · F5 손실 비대칭=업계표준 · F8 wasm32 4GB→커넥터 경로 검증 · F4 Speckle 컨버터=우리 설계 옳음 검증 · F3 버전 diff=M11.5로 충족(3D 고스트만 v1.5).

## 함정 (반복비용 큰 것)
- wrangler.jsonc compat 2개: `no_websocket_standard_binary_type`·`nodejs_compat`.
- AI 라우트 = AgentRunner DO(locationHint wnam) — 직접 fetch는 HK egress→Anthropic 403.
- Cloudflare secret = bash `printf '%s' "$(tr -d '\r\n' < 파일)" | wrangler secret put`.
- Anthropic strict tool use 금지(grammar 400) — executeOp 런타임 검증으로 충분.
- 호스팅: DO 무료 일일한도 — 개발 E2E/AI 버스트로 소진, 매일 00:00 UTC 리셋. 헤드룸 필요시 Workers Paid $5(코드 0) 1순위.
