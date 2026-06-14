# Figcad M11 잔여 작업 — /goal 프롬프트

> 사용 법: 아래 **각 Task를 별도 `/goal` 호출**로 실행 (단일 메가 프롬프트는 컨텍스트 드리프트로 실패 — Anthropic prompt-eng 가이드). 각 Task는 자체 검증·커밋으로 끝남.
>
> **완료**: ~~Task A 커튼월~~ ✅ · ~~Task B 라벨~~ ✅(커밋 bc45a73, 배포 d5daa8c2) · ~~Task C fork~~ ✅ · 도면생성(평면/단면/입면+DXF) · 존. 신규 kind 템플릿 = `git show 7c649e7`(존) / `git show 4503355`(커튼월, typed kind).
> **남음**: Task D connector(.NET/Rhino) · Task E 검증(416MB 파일). 둘 다 이 환경 밖(네이티브 툴 필요). + 라벨 배포(사용자 승인 1줄).

## 공통 컨텍스트 (모든 Task 앞에 둘 것)

```
프로젝트: Figcad — 웹 BIM 모델러 (C:\Users\user\Documents\LFTH_Figcad). 모노레포: packages/core(순수 TS) · packages/interop(IFC/.3dm/DXF) · apps/web(Three+React) · apps/server(Cloudflare Worker+DO).
현재: M11 Phase 0·1(도면 평면/단면/입면+해치+DXF)·Phase 2 존 완료·배포(8a082170). 상세 = docs/ROADMAP.md.

불변 규칙(위반=반려): ① 지오메트리는 파라미터에서 순수 파생(문서 저장 금지) ② 모든 변경 DocStore ops 경유(yjs import는 core·collab 밖 금지) ③ React 렌더루프 금지(HUD 명령형) ④ 펜=도구/터치=카메라. 단위 = mm 정수(ops 경계 quantize).

영역별 규칙: .claude/rules/{core-geometry,ops-store,interop,web-tools}.md. **신규 Element kind 추가 시 .claude/rules/core-geometry.md의 "silent if-chain 체크리스트" 전부 배선** (누락=조용한 버그). 참조 템플릿 = 존(Zone) 커밋 7c649e7 (git show 7c649e7로 정확한 배선 19파일 확인) + 기존 kind 5종(column/beam/stair/railing/roof).

cadence(필수): advisor(설계 전·완료 전) → 구현 → corepack pnpm -F @figcad/core test -- --run → corepack pnpm -r exec tsc --noEmit → 브라우저 스모크(apps/web/scripts) → 필요시 멀티에이전트 리뷰 → Phase 경계마다 git commit(말미 "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"). 빌드: corepack pnpm -F @figcad/web build. 배포: cd apps/server && corepack pnpm exec wrangler deploy (wrangler는 root 아닌 apps/server에서). push는 사용자 지시 시만.

함정: wrangler.jsonc compat 2개(no_websocket_standard_binary_type·nodejs_compat) · AI 라우트=AgentRunner DO(wnam) · secret=bash `printf '%s' "$(tr -d '\r\n' < f)" | wrangler secret put` · Anthropic strict tool use 금지(grammar 400) · 스모크는 vite만 띄우면 8787 WS 연결거부 정상(에러필터 제외).
```

---

## ~~Task A — 커튼월~~ ✅ 완료 (커밋 4503355, 배포 727fabc0) — typed kind 템플릿

## ~~Task B — 라벨 (Label)~~ ✅ 완료·배포 (커밋 bc45a73, Version d5daa8c2) — type-less kind, targetId 바인딩+template+leader.

```
목표: 새 kind 'label' — 요소 속성/존 면적을 자동 표기하는 주석(Revit 태그). 텍스트(TextElement)+치수 바인딩(DimBind, bindFor) 패턴 재사용.

데이터 모델: LabelElement { id, kind:'label', levelId, at:Pt(라벨 위치), targetId?(참조 요소 id), template: enum['name','area','custom'], customText?, leader?:boolean(지시선) }. 타입 없음(존/텍스트류).

파생 deriveLabel: targetId 해석 → template별 텍스트 산출(name=요소 이름/타입명, area=존이면 polygonArea(존 boundary)/1e6+"㎡", custom=customText). labels 채널(style:'text') + leader면 at→타깃 중심 선(edges). 고아(타깃 삭제)=customText 또는 "—" fallback, 연쇄삭제 금지(lint orphan 경고). resolveDimAnchor류 헬퍼로 타깃 추종.

배선: 존과 동일 체크리스트(타입 없음) — schema·deriveLabel·DeriveCache·store(createLabel+update[at 양자화]+move[at]+transformCopy[at, 바인딩은 유지 or 해제]+rotate)·select footprint(point at)·capability create_label(aiExposed — "이 존 면적 라벨")·lint(KIND_LABEL+orphan)·diff·web LabelTool(클릭+타깃 픽, TextTool/CommentTool 클론)·InfoBox(template/customText/leader)·deriveDrawing 평면(라벨 텍스트). interop=주석류 스킵(의도).

검증: core 테스트(template별 텍스트·존 면적 추종·고아 fallback) → tsc → 스모크 → 커밋 "M11 Phase 2 (라벨): Label 요소". Toolbox '레이블' 활성.
```

## ~~Task C — fork~~ ✅ 완료 (커밋 f4e1fbc) — 클라 주도(서버 DO storage 격리), VersionPanel fork 버튼

## Task D — Rhino↔Figcad connector [외부: .NET/Rhino 환경 필요]

```
목표: 결정적 connector(MCP 아님) — Rhino sync 버튼 ↔ Figcad. 2레이어. 상세 설계 = ~/.claude/plans/figma-lazy-milner.md의 M10 섹션 + 메모리 figcad-mcp-programmable-api.md.

D1 (이 저장소): Figcad 라이브쓰기 API. apps/server/src Doc DO에 ?op=apply (POST oplog) — `new DocStore(this.document)` → runCapability/executeOp → 성공 후 await onSave(). M9-C에서 검증된 메커니즘(broadcast 스파이크: 서버측 this.document 변경이 접속 WS 클라 전파됨) 재도입하되 JSON-RPC/MCP 없이 평범한 oplog POST. 입력 바운드(배열≤2000·count≤1000·body≤2MB) + ?key 게이트 + 전용 origin. **소비자(D2) 직전에만 구현(YAGNI).**

D2 (외부 .NET): Rhino RhinoCommon .NET8 플러그인(Yak 패키지). Sync 명령 → HttpClient로 ?op=pull(snapshot 읽기)/?op=apply(쓰기). RhinoDoc 이벤트 자동 push=v1.5. RhinoApp.InvokeOnUiThread(스레드 마샬). 컨버터: Figcad→Rhino(파라메트릭 벽→풋프린트 brep, 무손실급, .3dm export 경로 재사용) / Rhino→Figcad(제약 스키마 — "Wall" 레이어 곡선+속성→WallElement만, 임의 brep=참조/AI 시맨틱리프팅 v1.5). 기대치: 완전 무손실 왕복 불가(brep↔파라메트릭 본질적 손실) — 관례 따른 것만.

검증: D1=2클라 전파 E2E(miniflare dev.mjs). D2=Rhino에서 Sync→Figcad 화면 갱신 라운드트립. Speckle 패턴 참고(ConvertToNative/ToSpeckle), 백본 채택 X.
```

## Task E — 사용성 검증 [외부: 260416 파일 + 네이티브 툴]

```
목표: 실사용 검증 — 바탕화면 260416 MODELING.3dm(436MB, Rhino 열림). 에러·속도·안정성·네이티브 연동.

핵심 발견(선반영): 416MB는 브라우저 rhino3dm.js WASM 직접 import 불가(iPad WASM 탭 ~200-300MB). 또 현 .3dm import는 wall/slab/grid만 매핑(column/beam/stair/railing/roof/zone 스킵), 임의 파일=best-effort(open→wall·closed→slab) → 실파일 부분 import.

검증 항목: ① import — Rhino에서 소규모 subset export(또는 Task D connector 경로)로 import, 부분매핑·에러처리 확인 ② 속도 — 현실 규모 도면생성/2K 요소(데스크톱 60fps/40MB 기준) ③ 안정성 — undo·협업 전파·커밋 복원·fork·오버나이트 영속 ④ 네이티브 왕복 — IFC/.3dm/DXF export → Rhino/Revit/ArchiCAD 재오픈해 네이티브 요소로 들어가는지(IFC=파라메트릭 보존 유일, Revit IFC import 기본 DirectShape 고지). 

방법: 스크립트 E2E(apps/web/scripts) + 실기기(iPad) + 260416 subset. pass/fail 목표 = import 에러 0·네이티브 왕복 확인까지 반복. 발견 = 펀치리스트 → 다음 스프린트.
```
