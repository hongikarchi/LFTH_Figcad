# Figcad Rhino 플러그인 (.rhp / .yak)

`FigcadConnector.cs`(커넥터 코어)를 **설치형 Rhino 플러그인**으로 감싼 것. 스크립트 붙여넣기 대신 명령으로 실행.
대상: **Rhino 8 / Windows**. (Mac·Rhino 7은 TFM·RhinoCommon 버전 조정 필요.)

> ⚠️ 이 스캐폴드는 Figcad 빌드 환경(JS/Cloudflare)에서 **컴파일 검증 안 됨** — 아래는 너의 Windows + Visual Studio/.NET SDK에서 빌드. RhinoCommon 버전·TFM은 설치된 Rhino에 맞게 조정 가능.

## A. .rhp 빌드 (가장 단순)
필요: Visual Studio 2022 (또는 .NET 7 SDK) + 인터넷(NuGet RhinoCommon).
```powershell
cd connectors\rhino\plugin
dotnet build -c Release
# 결과: bin\Release\net7.0-windows\Figcad.rhp
```
또는 VS 2022로 `FigcadPlugin.csproj` 열고 빌드(Release).

## B. 설치 (테스트 — 드래그)
빌드된 **`Figcad.rhp`를 Rhino 8 창에 드래그&드롭** → "이 플러그인을 항상 로드" 선택.
(또는 Rhino `_PlugInManager` → Install → Figcad.rhp 지정.)

## C. 애드온 패키지 (.yak — 클릭 설치/배포)
"그냥 설치되는 애드온"으로 만들려면 Yak 패키지:
```powershell
# Figcad.rhp + manifest.yml 을 한 폴더에 두고:
copy bin\Release\net7.0-windows\Figcad.rhp .
& "C:\Program Files\Rhino 8\System\Yak.exe" build
#  → Figcad-0.1.0-rh8_0-win.yak 생성
```
설치(로컬): `& "C:\Program Files\Rhino 8\System\Yak.exe" install Figcad-0.1.0-rh8_0-win.yak`
또는 Rhino **Tools > Package Manager**서 검색·설치(공개 서버에 올리려면 `yak push` — 로그인 필요).
사내 배포만이면 .yak 파일 공유 → 각자 `yak install <파일>` 또는 Package Manager > Install from file.

## D. 사용 (설치 후 Rhino 명령줄)
- **`FigcadPull`** — Figcad 룸 → Rhino (벽·슬라브·기둥·그리드 등 재현).
- **`FigcadPush`** — Rhino "Wall Axis" 곡선·"Slab" 닫힌곡선 → Figcad.
- **`FigcadPushBreps`** — **Brep 기계적 리프트**(M13-G): 압출/실린더 → 기둥·벽·슬라브·보 인식 → Figcad ops + 충실도 보고("기둥 N·벽 M…·잔여 K").
각 명령이 **룸 id**(브라우저 주소 `?p=` 값)를 물어봄. 로컬 서버 대상이면 `FigcadPlugin.cs`의 `DefaultBaseUrl`을 `http://localhost:8787`로.

## 한계 (G 인식 — in-code 문서화)
- **section/thickness = 기존 Figcad 타입서 근사** (커넥터에 create_type 없음). 위치·footprint·높이·축만 인식 → 단면은 룸의 column/wall 타입. import 후 clean-up서 정밀화 = v1.5.
- **`FigcadPushBreps`는 figcad:id writeback 없음**(블록 내부 지오) → 재실행 시 중복. **새 빈 룸에 1회 import** 권장(연속 sync 아님 — ingest=PR 모델).
- **분류 임계**(기둥 foot≤1200·벽≤600·슬라브 span>3000 mm)는 한 모델 기준 — 오분류 있으면 `FigcadConnector.cs RecognizeBrep`에서 조정.
- 적중률 측정·설계 근거: `docs/brep-lifting-2026.md`.
