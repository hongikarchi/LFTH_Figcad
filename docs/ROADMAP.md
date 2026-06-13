# Figcad 로드맵 (repo 내 SoT)

> 버전관리되는 lean 상태판. 폴더에 보이고 git에 남고 compact 생존.
> **정체성**: AI 기반 실시간 협업 "상류 설계·조율 허브 + 멀티툴 인터롭 오케스트레이터". 메인도면=CAD·납품BIM=Revit·파라메트릭=Rhino/GH의 *상류*(LOD 100~250)를 소장님(iPad Pencil)+실무자(데스크톱)가 실시간 같이 빚고 IFC/DXF/.3dm으로 핸드오프.

## 4대 불변 규칙
1. 지오메트리는 문서에 저장·동기화 안 함 — 파라미터에서 순수 함수 파생.
2. 모든 문서 변경은 DocStore ops 경유 (yjs import는 core·collab 밖 금지).
3. React/DOM은 렌더 루프 금지 — HUD는 명령형 DOM, React는 패널만.
4. 펜=도구, 터치=카메라 (팜 리젝션, InputManager 격리).
상세: `CLAUDE.md` + `.claude/rules/` (path-scoped).

## 문서 위치 (투명성)
- **이 파일** = repo 내 lean SoT (현재 위치 + 마일스톤 상태).
- 전체 히스토리 상세 플랜: `~/.claude/plans/figma-lazy-milner.md` (M0~M10).
- 현 작업(M11) 플랜: `~/.claude/plans/wondrous-hugging-pebble.md`.
- 메모리 인덱스: `~/.claude/projects/C--Users-user-Documents-LFTH-Figcad/memory/MEMORY.md`.
- 영역별 규칙: `.claude/rules/*.md` (해당 경로 작업 시 로드).

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

## 진행 중 (M11) — 잔여 기능 완성 + 도면생성 + 검증
> 실행: 자율 구현, Phase 경계마다 커밋 + cadence(core 테스트·tsc·스모크·E2E·멀티에이전트 리뷰). `/goal`은 Phase 5 검증 꼬리에서만.

| Phase | 내용 | 상태 |
|---|---|---|
| **0** | 문서/컨텍스트 일관성(이 파일·rules·compact 지침) | ✅ |
| **1** | 도면생성 평면+단면+입면 + 해치 (정체성 핵심) | ✅ 배포 b9f0f98f |
| **2** | 요소: 존 ✅ · 커튼월·라벨 → goal prompt | ▶️ 존 완료·배포, 커튼월/라벨 goal prompt |
| 3 | M6.5 fork (스냅샷→새 룸) | ⬜ goal prompt |
| 4 | M10 connector (?op=apply + Rhino RhinoCommon 플러그인) | ⬜ goal prompt(.NET 환경 밖) |
| 5 | 검증 (260416 MODELING.3dm + 사용성) | ⬜ goal prompt(416MB·네이티브 툴) |

**현재 위치: 자율 run 종료 — goal prompt 핸드오프.** 배포 `8a082170`(Phase 1 도면 + Zone).
- Phase 1 ✅: 평면(절단/투영/해치 even-odd) + 단면(cut (u,z)) + 입면(박스매싱 painter HLR) + DXF + views(schemaVersion 3). 멀티에이전트 리뷰 1건(해치) 수정.
- Phase 2 존 ✅: Zone(IfcSpace 대응, 면적/부피, DXF/.3dm export). 커밋 7c649e7 = 신규 kind 완전 배선 **템플릿**.
- 남은 커튼월·라벨·fork·connector·validation = **goal prompt**(`docs/GOAL_PROMPT.md`). 커튼월/라벨/fork는 이 환경서 빌드 가능(Zone 템플릿)·Phase 4·5는 .NET/416MB 외부 필요.

### Phase 요지 (상세는 wondrous-hugging-pebble.md)
- **1 도면생성**: 3사 공식 합의 = 단면=절단면∩지오메트리(굵은선+poché) + 투영(가는선) / 입면=정사영+은선제거. 우리는 edges/footprint 소유 → 절단면∩메시·정사영 직접 계산, 은선제거=depth-sort. `views` 맵(파생, 미저장) + `deriveDrawing` + `hatch`(라인패턴). 1a 평면+해치→1b 단면→1c 입면.
- **2 요소**: curtainwall(UV그리드+멀리언 extrudeProfile 재사용), zone(수동 boundary+면적/체적, IfcSpace), label(text 확장 — 바인딩+템플릿+지시선). new-kind 체크리스트(`.claude/rules/core-geometry.md`).
- **3 fork**: `?op=fork` = 커밋 스냅샷→새 룸(importSnapshot 재사용). branch/merge/허브UI=v1.5.
- **4 connector**: 결정적 — Rhino 플러그인 + `?op=apply`(라이브쓰기) + 컨버터. MCP 아님. AI 시맨틱리프팅(brep→파라메트릭)=v1.5.
- **5 검증**: 260416=436MB → 브라우저 통짜 import 불가(WASM 캡), subset/connector 경로로. 현 .3dm import는 wall/slab/grid만(나머지 스킵 = 갭). 에러·속도·안정성·네이티브 왕복.

## 함정 (반복비용 큰 것)
- wrangler.jsonc compat 2개: `no_websocket_standard_binary_type`·`nodejs_compat`.
- AI 라우트 = AgentRunner DO(locationHint wnam) — 직접 fetch는 HK egress→Anthropic 403.
- Cloudflare secret = bash `printf '%s' "$(tr -d '\r\n' < 파일)" | wrangler secret put`.
- Anthropic strict tool use 금지(grammar 400) — executeOp 런타임 검증으로 충분.
- 호스팅: DO 무료 일일한도 — 개발 E2E/AI 버스트로 소진, 매일 00:00 UTC 리셋. 헤드룸 필요시 Workers Paid $5(코드 0) 1순위.
