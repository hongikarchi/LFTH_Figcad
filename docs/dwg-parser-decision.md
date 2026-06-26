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
