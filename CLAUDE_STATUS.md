# Claude Status

Claude owns this file.

## Current Task

**M14.1 완료 — Rhino↔Figcad 갭 4개 전부 해결·4중 검증.** 야간 무인. 작업트리 깨끗, 미배포(로컬 검증).

## 해결 (2026-06-22)
- **glTF 오버레이 정합 = FIXED** (메인 갭): north ~140m 어긋남 → 박스 실험 측정 → **Z 부호반전**(외부 glTF는 north=-Z, Figcad=+north). `@figcad/interop/coords gltfPositionsToFigcad`(순수+단위테스트) → extractGltf 경유. **4중 검증**: 박스측정·단위(interop41)·통합 bbox 게이트(실모델 오버레이 중심 변위 X0.7m·Z0.4m, 이전 140m)·시각(puppeteer cmp2=외피 프레임 위 정합). 커밋함.
- **위치 멀다** = 사용자 .rhp 옛버전 근본 → `connectors/rhino/figcad-push.cs`(현 로직 우회) recenter.
- **프레임 단순** = 의도(편집가능 구조 추상, 버그 아님).
- **인식 커버리지** = 정상(S-Slab 정확, parking/ceiling/외피=비구조 Lane-2+오버레이).

## 검증 게이트
core 353·interop 41(+3)·tsc clean·web build clean·reference-layer-smoke PASS. 회귀 0.

## 핵심 산출
- `docs/realuse-validation.md`: 갭 4개 해결 기록 + 측정-강제 교훈.
- 메모리 `figcad-world-coords-north`: Z=+north 규약 + 박스 실험법.
- `figcad-push.cs`·`figcad-vs-rhino.mjs` 도구.

## 다음 (사용자)
- **배포 시 오버레이 fix 적용**(현재 로컬만). 사용자 승인 시 `wrangler deploy`.
- 사용자 .rhp 재설치(새 빌드) 또는 figcad-push.cs로 실모델 push → 세션.
- 재계획 대상: E 3D-Tiles·ingest=PR·조율 성숙.

## 운영
- 로컬 8788 miniflare(검증룸 cmp2=프레임+정합오버레이). dist 재빌드시 재시작+좀비kill 필수.
- cmp_full.glb(72MB)·d_test.* gitignore.
