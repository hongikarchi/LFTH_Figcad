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
- Figcad 서버 도달 가능: 데브 `http://localhost:8787`(`node apps/server/dev.mjs`) / 프로덕션 `https://figcad.archivibe.workers.dev`.
- 룸(=Figcad 프로젝트 `?p=`)은 **Figcad 앱이 한 번 시드**해 둔 것이어야 함(레벨·타입 존재 — `create_type` capability 없음). Rhino는 그 레벨/타입 id를 재사용.

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
서버에 `wrangler secret put ROOM_KEY` 후 `cfg.Key` 설정. 커넥터 쓰기는 user-less·undo 불가(복구=Figcad 버전 복원).
