# Claude Status

Claude owns this file. Update it every 10-15 minutes while working.

## Current Task

**M13.6 마무리 완료 — M13 핵심 전부 끝.** 작업트리 깨끗, 미배포. 사용자 다음 = 정리 후 재계획(E 3D-Tiles·배포는 재계획 대상).

## 완료 (이번 라운드 M13.6, 커밋·게이트그린)
- **커넥터 Pull +origin**(`4dfdf42`): 라운드트립 무손실 완성(MCP 원좌표 정확 복원).
- **.rhp 재빌드**: bin/Release/Figcad.rhp = Pull+origin·G2·recenter·계단난간 전부. Rhino 등록=새 빌드.
- **G 잔여 계단·난간**(`c6251a8`): MCP 계단47·난간26 전부. L-PARKING/logo/glass=Lane-2.
- **D .3dm 네이티브**: import3dmMeshes(Mesh객체 Z-up→Y-up)+extract3dm+Navigator. 게이트 rhino-meshes 3.
- 리뷰 후속: wasm 누수 .delete · .3dm 빈오버레이 throw/warn.
- 검증: core 353·interop **38**·server 10·tsc·web build·dotnet build clean.

## M13 전체 (누적, 미배포)
A 허브·B 병합lint·C 곡선벽·C5 곡선interop·F R2페이로드·G(레이어인식+계단난간)·줌익스텐트·projectOrigin 양방향·Codex 5건·Pull+origin·.rhp·D .3dm. ~45 커밋.

## 재계획 대상 (이번 범위 밖)
- **E 3D-Tiles HLOD**(436MB 대형 뷰어 서브시스템).
- **배포**(F=서버변경, 로컬 우선 — Cloudflare 용량).
- G 잔여(L-PARKING 등 Lane-2)·stair 곡선 근사·ROOM_KEY per-room = v1.5.

## 로컬 서버
- 8788 miniflare = M13 dist+R2+F+origin. 검증룸: rt1(326)·g3test(계단난간)·g13final·g2test.
- ⚠️ dist 재빌드 후 miniflare 재시작 필수(에셋 staleness=흰화면) + 좀비 프로세스 전부 kill.
- ⚠️ d_test.3dm(147MB, Rhino 현재파일) gitignore됨 — Rhino 닫으면 삭제 가능.

## Codex 협업
- Codex 모니터링 중단됨(2026-06-19). 내 reviewer 서브에이전트+테스트가 게이트. M13.5·M13.6 각 reviewer 1패스.
