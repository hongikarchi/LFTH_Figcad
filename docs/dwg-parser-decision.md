# DWG 파서 결정 — libredwg(WASM) vs ODA(서버)

2026-06-26. 실파일 검증 중 libredwg 한계 드러남. ODA 서버 경로 평가 시작.

## 현재 = libredwg-web 0.7.7 (클라이언트 WASM)

- DWG를 **브라우저/Node에서 직접 파싱**(서버·라이선스 불필요, iPad 가능). 9.4MB wasm.
- 깨끗한/단순 DWG는 잘 됨: 벽·문스윙·블록전개·bulge·치수, frozen 레이어 존중.
- **블록 XCLIP은 읽음** (계단/에스컬레이터 18개 = SPATIAL_FILTER, 구현 커밋 `9eed846`).

## 한계 = xref XCLIP 못 읽음 (확정)

실파일(`260615...평면도.dwg`)에서 도로/토포 **xref가 CAD에서 XCLIP** 됐는데 Figcad선 통째로 들어옴. 원인:

- libredwg **C코어(WASM)가 SPATIAL_FILTER를 18개만 디코드** — raw 저수준 API로 확인: `dwg_get_num_objects`=341,291 중 `fixedtype=715`(SPATIAL_FILTER)=**정확히 18개** (전부 로컬 블록=계단류). xref XCLIP은 객체 리스트에 아예 없음.
- **JS 변환기 스킵 아님** (18 raw = 18 converted, `converter.js` 명시 변환). **C코어 디코드 실패** = `error code 68`(UNHANDLEDCLASS 4 + VALUEOUTOFBOUNDS 64).
- **JS 패치 불가** (디코더는 WASM 컴파일된 C). `@mlightcad/libredwg-converter` 3.7.14도 **같은 코어**(libredwg-web ^0.7.7 의존) → 동일 18개. 0.7.7이 최신.

= 블록 XCLIP = 단순해서 읽힘, **xref XCLIP = bound-xref 복잡 구조라 C코어가 드롭.** 사용자(도메인 전문가) AutoCAD서 도로/토포 XCLIP 확인함.

## 결정 = ODA File Converter (서버) 평가

xref XCLIP은 임의 영역(시트범위 ≠ 클립영역)이라 뷰포트 크롭으로 대체 불가. 제대로 풀려면 **완전한 DWG 디코더** 필요.

- **ODA File Converter = 무료** (standalone 변환기; 유료는 SDK). Linux 빌드 → Railway서 DWG→DXF.
- 경로: DWG 업로드 → 서버 ODA가 DXF 변환(클립 전부 보존) → 클라가 DXF 파싱.
- 트레이드오프: 클라전용 단순함 포기(서버 왕복), 대신 복잡 실파일 완전 정합.
- **하이브리드 가능**: libredwg 클라(빠른 미리보기) + ODA 서버(전체 정합 필요시).

## 롤백

- **태그 `libredwg-stable`** = ODA 실험 전 known-good libredwg 상태.
- ODA 실험 = 브랜치 `feat/oda-server`. master는 `libredwg-stable` 유지.
- 실패 시 `git reset --hard libredwg-stable`. 성공 시 머지.

## UPDATE (2026-06-26) — ODA 대부분 불필요. 진짜 원인 = 내 2-vert 버그

ODA 검증 중 반전. 사용자 `건축도면.dxf`로 비교:

- **건축도면 파일은 libredwg가 XCLIP 다 읽음** — raw=5=convert=5=DXF=5. 그 5개 = **현황대지(토포) ×2 + ESC ×3.** 즉 libredwg가 **읽히는 파일에선 road/topo XCLIP도 읽음.**
- 근데 내 XCLIP 구현이 토포를 안 잘랐음(62.6%→0). 원인 = **AutoCAD 직사각형 XCLIP은 대각 2점(verts=2)으로 저장**하는데 내 `clipSegmentPoly`가 n<3=클립없음 처리. ESC는 verts 4/8(폴리곤)이라 됐고 현황대지는 verts=2(직사각)라 무시됨. → **buildClipMap서 2점=4코너 확장** 수정.
- 수정 후: 건축도면 **62.6% 클립**(토포 잘림), bbox Y 622→104m, 렌더가 PDF 시트처럼 3개 평면. **road/topo XCLIP 작동.**

= **읽히는 파일(건축도면류)은 libredwg+수정으로 충분, ODA 불필요.** 

**ODA가 여전히 필요한 경우**: `평면도(260615).dwg` 같은 **복잡 bound-xref 파일** — libredwg C코어가 그 SPATIAL_FILTER를 아예 디코드 못 함(raw=18, 전부 로컬블록; 현황대지/REF xref 클립 0개). 이건 진짜 libredwg 한계. 그 파일류 정합 필요 시에만 ODA. = ODA는 **edge-case 백업**으로 강등, 기본은 libredwg.
