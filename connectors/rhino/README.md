# Figcad ↔ Rhino 커넥터 (M10-D2)

Rhino와 Figcad(웹 BIM 모델러)를 **라이브 양방향 동기**. Figcad 서버의 라이브쓰기 API
(M10-D1: `?op=pull` / `?op=apply`)를 RhinoCommon C#에서 HTTP로 호출.

> **검증 상태**: 코어 컨버터(Pull/Push)는 **Rhino MCP로 배포된 D-1에 대고 라이브 왕복 검증 완료**
> (벽/슬라브 좌표 정확 재현 · 재-Pull 멱등 · Push createdIds writeback 무중복). `.rhp` 패키징
> (더블클릭 설치형 플러그인)은 **남은 셸 작업** — `.NET 8 SDK` + Visual Studio + Yak 필요(이 모노레포 밖).

## 무엇을 하나

| 방향 | 동작 |
|---|---|
| **Pull** (Figcad→Rhino) | `?op=pull` 스냅샷 → 레이어별 Rhino 곡선(벽 중심선+풋프린트·슬라브·기둥·그리드·보·지붕·존·커튼월). 각 객체에 `figcad:id` 스탬프. |
| **Push** (Rhino→Figcad) | `figcad:id` **없는**(=Rhino 작도) "Wall Axis" 선 → `create_wall`, "Slab" 닫힌곡선 → `create_slab` → `?op=apply`. 응답 `createdIds`를 객체에 되써 Figcad 소유로 전환. |

Push 변경은 D-1 broadcast로 **접속 중인 브라우저 클라에 즉시 반영**.

## 소유권 규칙 (왕복 무중복의 핵심)

`figcad:id` UserString = "Figcad가 소유". 
- **Pull**: figcad-owned 객체 전부 삭제 후 재그림 → 몇 번을 Pull해도 멱등(중복 안 쌓임).
- **Push**: 태그 없는 Rhino 작도 객체만 전송. `createdIds`를 되쓰면 다음 Pull이 그 객체를 "이미 있음"으로 인식 → Push-중복 없음.

→ 태그 없음=Rhino 소유, 태그 있음=Figcad 소유. 이 한 규칙이 양방향 중복을 막음.

## 단위·좌표

Figcad mm 정수 ↔ Rhino **mm 1:1** (스케일 없음). Pull/Push 모두 round.

## 사전 조건

- Rhino 8 (RhinoCommon — `System.Net.Http.HttpClient` 사용, 네트워크 허용).
- Figcad 서버 도달 가능: 데브 `http://localhost:8787`(`node apps/server/dev-node.mjs` 또는 `node apps/server/node-dist/server.mjs`) / 프로덕션 `https://lfthfigcad-production.up.railway.app`.
- 룸(=Figcad 프로젝트 `?p=`)은 **Figcad 앱이 한 번 시드**해 둔 것이어야 함(레벨·기본 타입 존재). v0.4부터 기둥/보/벽 타입은 실측 단면으로 **자동 생성**(`create_type`) — 슬라브/계단/난간 타입은 여전히 룸의 기존 타입 재사용.

## 실행 방법

### (1) Rhino 8 스크립트 에디터 (즉시, 빌드 불필요)
`_ScriptEditor` (또는 `_RunScript`) → C# → `FigcadConnector.cs` 전체 붙여넣고 하단에:
```csharp
var cfg = new Figcad.FigcadConfig {
    BaseUrl = "http://localhost:8787",   // 또는 프로덕션 URL
    Room    = "내-프로젝트-id",            // Figcad ?p= 값
    Key     = null                        // ROOM_KEY 설정 시 그 값
};
Rhino.RhinoApp.WriteLine(Figcad.FigcadConnector.Pull(Rhino.RhinoDoc.ActiveDoc, cfg));
// Push: Figcad.FigcadConnector.Push(Rhino.RhinoDoc.ActiveDoc, cfg)
```

### (2) `.rhp` 플러그인 (배포형 — 남은 셸 작업)
Visual Studio + RhinoCommon NuGet으로 `FigcadConnector.cs`를 클래스 라이브러리에 포함,
하단 주석의 `FigcadPullCommand`/`FigcadPushCommand` 스텁을 활성화해 `Rhino.Commands.Command`로 빌드 →
`_FigcadPull` / `_FigcadPush` 명령. Yak으로 패키징·배포. HTTP 콜백이 UI 스레드 밖이면
`RhinoApp.InvokeOnUiThread`로 doc 수정 마샬.

## 범위·한계 (v1)

- **Pull(넓게)**: wall·slab·column·grid·beam·roof·zone·curtainwall(베이스라인). opening/dimension/text/label/stair/railing = v1 스킵.
- **Push(좁게)**: wall·slab만. 그 외 레이어·임의 brep/메시 = **스킵+카운트**(무손실 역변환 불가 — Rhino brep→파라메트릭 벽은 AI 시맨틱 리프팅=v1.5).
- 완전 무손실 왕복 불가(brep↔파라메트릭은 본질적 손실) — 관례(레이어·UserText) 따른 것만.
- 컨버터 매핑은 `.3dm` export(`packages/interop/src/rhino3dm.ts`)와 동일 — 단일 진실원.

## 보안

D-1 `?op=apply`는 `?key=ROOM_KEY` 게이트(설정 시) + 작업예산 DoS 방어. 프로덕션에서 게이트하려면
Railway `ROOM_KEY` 변수 설정 후 `cfg.Key` 설정. Cloudflare rollback에서는 `wrangler secret put ROOM_KEY` 사용. 커넥터 쓰기는 user-less·undo 불가(복구=Figcad 버전 복원).

## v0.2 — 패널 · 레이어 매핑 · preview · 클린업 · Lane-2 통과

`FigcadPanel` 명령으로 도킹 패널(WinForms, Windows). 명령줄 대신 GUI 왕복 + Speckle식 기능.

| 기능 | 설명 |
|---|---|
| **저장된 룸** (복붙 제거) | 룸 id·서버 URL·ROOM_KEY를 `PlugIn.Settings`에 영속. 명령줄도 저장된 룸을 기본값(엔터=재사용). 최근 룸 드롭다운. |
| **레이어 → kind 매핑** | "레이어 스캔"으로 표 채우고 각 레이어에 kind(column/wall/slab/beam/stair/railing/**ignore**) 지정. 자동 `KindFromLayer`를 override. 객체별 `figcad:kind` UserString은 **최우선**. `ignore` = 명시적 잔여. "매핑 저장" = 룸별 영속. |
| **Preview** (비파괴) | push 전 무엇이 리프트되는지(kind별 색) vs 잔여(회색)를 bbox 오버레이로. `ClassifyForPush` 공유 = preview가 Push 결과를 못 속임. 서버 무변경(로컬 계산). |
| **Pre-push 클린업** (결정적, 비-AI) | 중복 삭제(기하 해시+`GeometryEquals`) · 근축 직교화(≤tol°) · 끝점 그리드 용접(정수 mm — 서버 마이터 조인 충족). 검사→적용, 단일 undo. **모드 A**(라이노 원본 수정) / **모드 B**(push 데이터만 — clean→PushBreps→`_Undo`, 원본 유지). |
| **Lane-2 통과** | `FigcadPushBreps`의 자유곡면/미인식 잔여를 **버리지 않고** coarse 메시 `.3dm` blob으로 업로드(`?op=fed-upload`) + federation 소스 등록(`?op=fed-register`) → Figcad에서 읽기전용 오버레이. 재푸시 시 교체(멱등). 원본 좌표 export(reconciler가 `-origin` 재적용해 리프트 요소와 정렬). |

**빌드/설치**: `cd connectors/rhino/plugin && dotnet build -c Release` → `bin/Release/Figcad.rhp` → Rhino 8에 드래그. 명령: `FigcadPanel`·`FigcadPull`·`FigcadPush`·`FigcadPushBreps`.

**패널 UI = WinForms**(현 `net7.0-windows`/Windows). 크로스플랫폼 Eto 이식 = 후속(Mac 필요 시 TFM `net7.0`+Eto).

**⚠️ 로컬 데브 서버 정정**: op API(`?op=pull|apply|origin|fed-register`)는 `apps/server/dev.mjs`(miniflare :8787)가 서빙 — `dev-node.mjs`는 `/parties/`를 **503**(WS-sync 전용). 로컬 테스트는 `node apps/server/dev.mjs`. 프로덕션(Railway/`node.ts`)은 정상 서빙. 패널 BaseUrl을 `http://localhost:8787`로.

**서버 신규**: `?op=fed-register`(federation 소스 등록, `apply.ts`) — `?op=origin` 패턴 복제. `ref` 검증(이 룸 fed-blob URL만 — SSRF 방어). node.ts·cloudflare.ts 라우팅 parity. 유닛테스트 `apps/server/test/connector-fedregister.test.ts`.

## v0.3 — 네이티브 UI + 3D Pull + 아이솔레이트

- **패널 = Eto.Forms**(WinForms→재작성): 라이노 자체 패널과 동일 툴킷 → **자동 다크/라이트 테마**(네이티브 룩). 탭 **아이콘**(브랜드 `figcad.png` 임베드). 룸 id/서버 URL/Room key **인라인 도움말**.
- **Pull = 3D 솔리드**(#8): Figcad 파라미터(중심선·두께·높이·단면)에서 솔리드 **재생성**(커브 아님). wall=footprint×height↑ · column=단면×height↑ · slab/roof=경계×thickness · beam=축정렬 박스 · stair/railing/curtainwall=박스 근사(보고에 "근사 N"). grid/zone=참조 커브 유지. **가져온 객체 선택 상태**(#7). `Extrusion`/`Box`, 법선 바깥 정규화.
- **클린업 "문제만 보기"**(#6): 검사 후 문제 객체(중복·라인수정) 빼고 **나머지 잠금**(figcad 소유·이미 잠긴 것 제외) + 문제 선택. **복원** 버튼으로 정확 해제. "근축 직교화" → **"선 직각 맞추기"**로 개명.
- **빌드 주의**: Rhino가 `.rhp`를 로드 중이면 `bin/Release` 잠김 → 재빌드 전 플러그인 언로드(또는 Rhino 종료). `Eto.Forms` 2.8.x는 `ExcludeAssets="runtime"`(Rhino 제공). `net7.0-windows` 유지(Eto Win 백엔드=WinForms). Mac은 TFM `net7.0`로 별도 슬라이스.

## v0.4 — Push 통합 + 파라메트릭 형상충실 리프트 (단면 실측·타입 자동 생성)

**Push가 하나로 통합**: 패널 "Push" 버튼 / `FigcadPush` 명령 = `PushAll` — ① 커브 레인("Wall Axis" 선·"Slab" 닫힌곡선, 기존 Push) → ② 브렙 리프트(레이어=kind, 파라미터=`FigcadFit` 실측) → ③ Lane-2 잔여 오버레이 → **충실도 보고 1장**:

```
Push 충실도 보고: [커브] 벽N·슬라브M | [브렙] 기둥a·벽b·슬라브c·보d (타입 신규t·재사용u)
  · 근사x(계단bbox…·슬라브개구…·슬라브z…) · Lane-2 잔여k(자유곡면…·기울…·열린브렙…·메시…) · 중복스킵dd · 적용A·실패F
```

잔여 0이면 보고 끝에 ` → 잔여 0 — 이전 Lane-2 오버레이가 있으면 수동 삭제 필요` 꼬리표(replace=lane2가 안 돌아 이전 푸시 오버레이가 남을 수 있음 — 정직 보고).

`FigcadPushBreps`는 **레거시 별칭**(브렙 레인만 실행)으로 유지.

| 변경 | 내용 |
|---|---|
| **단면 실측** | bbox 추상화 폐지. cap-pair 프리즘 추출(`FigcadFit.FitPrisms`) → 단면 분류 rect/circle/**hsection(H형강)**/**polygon(임의)**. 압연형강 필렛(r호)은 예리한 코너 복원으로 명명 단면 승격, 부피 게이트 실패 시 충실 폴리곤 폴백(2단 중재). |
| **타입 자동 생성** | 스냅샷 타입을 canonical key(`r:300x600`·`c:500`·`h:300x500x10x15`·`p:{n}:{fnv1a}`·벽 `t:200`)로 인덱스 → 미매치만 `create_type` **POST-B**(dedup 없음, createdIds op-order로 typeId 해석) → 요소 ops **POST-C**(`&dedup=1`). 재푸시 = 타입 키 매치 → create_type 0개(멱등). 이름 예: `H-500×300`·`RB-300×600`·`C-400×400`·`Ø500`·`PL-8pt`·`W-200`. **구서버**(create_type 미지원) = 기존 first-type 근사 폴백 + "서버 구버전" 보고. |
| **축 충실** | 보 = 실축 평면 투영(**대각 보존**, 축정렬 스냅 폐지) + `zOffset` = 축중앙 − 레벨 elevation. 기둥 = 축 평면점 + `height` = 프리즘 길이 + `baseOffset` = 축하단 − elevation(종전 raw-Z 버그 수정 — 단 `create_column`이 아직 baseOffset 미노출이라 ≠0이면 "근사"로 정직 카운트). 벽 = 평면 rect-핏(임의 회전 지원) → 장변 미드라인 중심선 + 두께=단변 + height/baseOffset. 슬라브 = cap 외곽 폴리곤 + `thicknessOverride` = 프리즘 두께(종전 타입두께 무시 버그 수정). |
| **정직 게이트** | 조용한 bbox 폴백 없음 — 각도(수직 cos2°/수평 sin2°)·단면 분류·부피(`부피 오차 %` 패널 1~10, 기본 3) 실패 = Lane-2 + FailReason 카운트. 경사 보(평행육면체)는 aspect 가드(축길이 > 단면 최대변)가 차단. 계단/난간 bbox·슬라브 개구 무시·**슬라브 z 유실**(상단면 z ≠ 레벨 elevation ±1mm — core 슬라브=상면 고정, z 파라미터 없음) = `근사`로 카운트(preview 주황). |
| **origin 단일화** | `PushAll`이 projectOrigin을 **1회** 해석(룸 기존 origin 재사용, 없으면 전체 모델 extent min corner 산출+POST)해 **커브·브렙 두 레인이 같은 origin을 차감** — 측량좌표 모델에서 커브 레인 요소만 +origin 오프셋되던 비대칭 수정. 레거시 `Push`(커브 전용)는 종전 raw 좌표 거동 유지. |
| **Lane-2 확대** | **열린 brep·메시도 조용히 버리지 않음** — 잔여 오버레이 동승 + `열린브렙/메시` 카운트(preview 회색). 명시적 `ignore`만 카운트된 드롭. |
| **Pull 패리티** | `SectionRing`에 hsection 12점(core `deriveStructure.ts` 순서 그대로)+polygon verbatim. 보 = `AddBeamPrism`(임의 단면 축 압출, p=축우측 수평 n=(dir.y,−dir.x)·q=+Z — core `deriveBeam` 매핑과 부호 일치, rect도 같은 경로). 보 기본 높이 = 천장 − sectionVHalf(단면별). |

**패널**: Push 버튼 1개 + `부피 오차 %` 스테퍼(영속). Preview: 근사=주황 추가.
