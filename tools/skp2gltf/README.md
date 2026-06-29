# skp2gltf — SketchUp .skp → glTF 변환기

SketchUp `.skp`는 브라우저용 WASM 파서가 없다(독점 포맷). 대신 **공식 SketchUp C SDK**(`SketchUpAPI.dll`)
+ CPython 바인딩(`sketchup.cpXXX.pyd`)으로 .skp를 읽고 면을 **테셀레이션**해 glb로 변환 → Figcad
"+연동 모델"에 glTF로 업로드(이미 지원)하면 **솔리드 오버레이**로 보인다.

라이노 커넥터(`FigcadPushBreps`)와 동일한 "외부툴 → 중립포맷(glTF) → Figcad" 사상의 구체 구현.
(Rhino .3dm은 rhino3dm이 면 테셀 불가라 와이어프레임뿐 — SketchUp은 SDK가 솔리드 메시를 준다.)

## 준비

1. **Python 3.11 또는 3.13** (바인딩 `.pyd`의 CPython ABI와 일치해야 함):
   ```
   uv python install 3.13
   ```
2. **SketchUp SDK 파일** 한 폴더에:
   - `SketchUpAPI.dll`
   - `sketchup.cp311-win_amd64.pyd` 또는 `sketchup.cp313-win_amd64.pyd`
   - 출처: SketchUp 공식 SDK 다운로드, 또는 Blender `sketchup_importer` 애드온 폴더에 동봉.
   - ⚠️ SDK 바이너리는 SketchUp 라이선스 — 이 리포에 커밋하지 않음(사용자 제공).

## 사용

```
py -3.13 skp2glb.py <in.skp> <out.glb> <sdk_dir> [max_tris]
# 또는 SKETCHUP_SDK_DIR 환경변수로 sdk_dir 생략
```

예:
```
py -3.13 skp2glb.py "model.skp" "model.glb" "C:\path\to\sketchup_importer"
```

그 다음 `model.glb`를 Figcad **+연동 모델 → 파일 업로드**로 올리면 솔리드 read-only 오버레이로 표시된다.

## 검증 (실파일)

- 견본주택 `260616_입면 스터디.skp` (218MB) → 1.45M 삼각형 → 49.8MB glb, 16.7s. Figcad import ready(솔리드).
- `260617_입면 스터디.skp` (264MB) → 1.69M 삼각형 → 57.9MB glb, 25.4s.

## 한계

- **머티리얼/텍스처 미보존** — 단색 read-only 오버레이(Figcad federation은 단색). 면 형상만.
- **대형 절단** — `max_tris`(기본 2,000,000) 초과 시 절단(브라우저 glb 로드·메모리 가드). 필요시 SketchUp에서 단순화/부분 export.
- **좌표** — SU Z-up 인치 → glTF Y-up 미터(`x, z, -y` × 0.0254). 컴포넌트 인스턴스/그룹 변환 재귀.
- **로컬 전용** — SDK가 Windows 네이티브 DLL이라 브라우저/Railway(Linux) 직접 실행 불가. 로컬 CLI 변환 → 업로드.

## 후속 (옵션)

- 머티리얼/색 보존(glTF materials + per-primitive).
- Figcad 서버측 자동 변환(SketchUp SDK Linux 버전 + Railway) — 현재는 로컬 변환.
- `.skp` 업로드 시 Figcad UI가 이 변환 안내(현재는 "플러그인/변환 경로" 알럿).
