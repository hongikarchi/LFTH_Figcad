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

## ~~Task D-1 (이 저장소)~~ ✅ 완료 (커밋 a592be6) — Figcad 라이브쓰기 API

`apps/server/src/apply.ts` + Doc DO onRequest. **D2가 호출할 실제 계약**:
```
GET  {base}/parties/doc/{room}?op=pull[&key=KEY]
     → 200 DocSnapshot { meta, levels[], types[], elements[] }  (라이브 현재 상태)
POST {base}/parties/doc/{room}?op=apply[&key=KEY]
     body: { ops: [ { op: "create_wall", args: {...}, result?: any }, ... ] }
     → 200 { applied: number, failed: [{entry,error}], createdIds: string[] }
     op 이름·args = Capability Registry(packages/core/src/capabilities/catalog.ts, aiExposed).
     예: create_wall{levelId,typeId,a:[x,y],b:[x,y]} · create_slab{levelId,typeId,boundary:[[x,y]...]} · update_element · delete_element 등.
     좌표 mm 정수(float 관용). 변경은 접속 WS 클라 전원에 broadcast + onSave 영속(무인 룸도).
바운드: ops≤2000 · body≤2MB · arg배열≤4096. 게이트: ?key=ROOM_KEY(프로덕션 secret), isSafeRoom.
```
base 데브 = `http://localhost:8787` · 프로덕션 = `https://figcad.archivibe.workers.dev`. room = projectId(?p=).

## Task D-2 — Rhino 플러그인 [외부: .NET/Rhino 환경 필요]

```
목표: Rhino RhinoCommon .NET8 플러그인(Yak 패키지) "FigcadSync" — 위 D-1 계약 호출. 양방향:
- Pull: GET ?op=pull → DocSnapshot → 컨버터로 RhinoDoc.Objects.Add. 레이어=요소종류(Wall/Slab/Column...).
- Push: 선택/전체 Rhino 객체 → 컨버터로 ops 배열 → POST ?op=apply {ops}. 성공 시 Figcad 화면 즉시 갱신(WS).
스레드: RhinoApp.InvokeOnUiThread(HTTP 콜백→RhinoDoc 수정). HttpClient 재사용. base/room/key=플러그인 설정(EditBox).
컨버터(핵심 난이도=시맨틱 변환):
- Figcad→Rhino: 파라메트릭 무손실 우선 — 벽 중심선+두께→풋프린트 압출, 슬라브→압출, 기둥→압출.
  (.3dm export 경로가 이미 이 매핑 — packages/interop/src/rhino3dm.ts 참고). LOD 100~250.
- Rhino→Figcad: 제약 스키마 — "Wall" 레이어 선/폴리라인+UserText(두께)→create_wall, "Slab" 닫힌 곡선→create_slab.
  임의 brep/메시=스킵+카운트(무손실 역변환 불가, AI 시맨틱리프팅=v1.5). 관례 따른 것만.
검증: (1) Figcad 벽→Pull→Rhino 압출. (2) Rhino "Wall" 선→Push→Figcad 화면 벽(2클라면 둘 다 — D1 broadcast).
  (3) 임의 brep Push→스킵 카운트. 완전 무손실 왕복 불가(brep↔파라메트릭 본질 손실) 명시.
참고: Speckle ConvertToNative/ToSpeckle(백본 채택 X)·developer.rhino3d.com/guides/rhinocommon·Yak.
```

## Task E — 사용성 검증 [외부: 260416 파일 + 네이티브 툴]

```
목표: 실사용 검증 — 바탕화면 260416 MODELING.3dm(436MB, Rhino 열림). 에러·속도·안정성·네이티브 연동.

핵심 발견(선반영): 416MB는 브라우저 rhino3dm.js WASM 직접 import 불가(iPad WASM 탭 ~200-300MB). 또 현 .3dm import는 wall/slab/grid만 매핑(column/beam/stair/railing/roof/zone 스킵), 임의 파일=best-effort(open→wall·closed→slab) → 실파일 부분 import.

검증 항목: ① import — Rhino에서 소규모 subset export(또는 Task D connector 경로)로 import, 부분매핑·에러처리 확인 ② 속도 — 현실 규모 도면생성/2K 요소(데스크톱 60fps/40MB 기준) ③ 안정성 — undo·협업 전파·커밋 복원·fork·오버나이트 영속 ④ 네이티브 왕복 — IFC/.3dm/DXF export → Rhino/Revit/ArchiCAD 재오픈해 네이티브 요소로 들어가는지(IFC=파라메트릭 보존 유일, Revit IFC import 기본 DirectShape 고지). 

방법: 스크립트 E2E(apps/web/scripts) + 실기기(iPad) + 260416 subset. pass/fail 목표 = import 에러 0·네이티브 왕복 확인까지 반복. 발견 = 펀치리스트 → 다음 스프린트.
```
