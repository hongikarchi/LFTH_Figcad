# 자율 개선 루프 요약 (2026-07-12, feat/loop-260712)

> 세션 진행 중 지속 갱신. 상세 감사 로그 = `LOOP_LEDGER.md`.
> 플랜: `~/.claude/plans/fable-fluffy-adleman.md` (사용자 승인 2026-07-12 — 스트림 A뷰·C걷기·E하드닝·F소품, §C 권장 디폴트 채택, B-P1 포함·즉시실행)

## TL;DR

자율 개선 루프 가동 중. loop-0 부트스트랩 완료: **스모크 통합 러너**(29종 자동 오케스트레이션, 전부 GREEN) + **apps/web 첫 단위테스트**(CameraRig 26케이스) + T0 게이트 606케이스. 이후 회차: 뷰 시스템(A-S1~S4) → AI ui-action → 걷기 v1.1 → 하드닝.

## 커밋 (feat/loop-260712 — master 미머지, 미배포)

| 커밋 | 내용 | 게이트 |
|---|---|---|
| `c0a84c0` | **web 첫 단위테스트** — vitest 부트스트랩 + CameraRig 28케이스(뷰 개편 안전망) + root test 편입 | T0 614 ✅ |
| `78887f7` | **스모크 통합 러너** — 29종 자동(백엔드 kind 프로브·인프라 실패 격리·flake 재시도) + dwg 2종 exit 규약 수리 | 29/29 ✅ + SKIP 경로 실증 |
| `92a3525` | **northScreenAngle 스테일 행렬 수정**(리뷰 발굴 제품 버그) + dimension 도구 죽은 코드 제거 | web 28 ✅ |
| `a120540` | **버전 blob GC + 커밋 레이트리밋** (repo 유일 명시 TODO 해소) | server 42 ✅ + miniflare 스모크 3종 |
| `9028837` | LOOP_LEDGER 신설 + 이 요약 | — |
| `8b2e651` | **폰 뷰포인트 시트** — 공유 뷰포인트 수신·탭 점프 ("N번 단면 봐주세요" 폰 수신) | mobile-smoke ✅ |
| `8179619` | **데스크톱 핫키 레이어** (Slice 11) — W벽 등 14키 + 1/2/3 모드, MODE_TOOLS 게이팅 | vitest+ux-smoke ✅ |
| `f5fc50d` | **입면 true ortho + full-sphere 오빗** (A-S1·S4, 8b) — 원근왜곡 소멸·아래서 보기·Btm·입면 라벨 정정. 리뷰 12건 확정 반영(critical: 입면 그레이징 1e20mm 커밋 경로 차단 · 입면 거울상 X반사 교정) | T0 632 + 스모크 11종 ✅ |

리뷰 요약: loop-0 리뷰(19에이전트) 확정 15 전부 수정 + 회차 1 리뷰(16에이전트) 확정 12 전부 수정. 뮤테이션 실증·수치 재현 기반(상세 LOOP_LEDGER).

## 아침 결정 대기 (당신 몫)

1. **master 머지 + 배포** — 루프 산출물 검토 후 ff-merge + `railway up`. (직전 미배포 커밋 8개도 함께 나감 — 재질 페인트 opacity strip 롤아웃 창 유의: 배포 후 열린 탭 새로고침 안내)
2. **AI 키 + US 리전** — 설정되면 `node apps/web/scripts/run-smokes.mjs --tags agent`로 실 AI 왕복 검증 즉시 가능 (agent-live-smoke는 키 없으면 SKIP).

## 알려진 한계 / 리뷰 수용 항목

- **입면 ortho 뷰포인트 = persp로 복원** — 뷰포인트 페이로드에 projection 미저장(구빌드 롤아웃 안전 우선). 각도·거리는 정확, 직교성만 소실. 페이로드 optional 필드 확장은 배포 창 결정 필요.
- **구빌드 혼재 창**: full-sphere(φ>π/2) 뷰포인트를 구빌드가 열면 클램프 복원(위에서 본 각도로 잘림) — 배포 후 열린 탭 새로고침 안내에 포함.
- **plan 진입 스윙**: 아래서 보던 중(φ>π/2) plan 진입 시 카메라가 수평을 지나 크게 회전 — 시각 확인 필요(문제 시 plan 진입만 스냅, 스펙 A3.4 지정 사항).
- **bottom(저면) 뷰도 X반사 적용** = 반사 천장 평면도(RCP) 관례와 부합하나 명시 결정 아님 — 아침에 한 번 봐 주세요.
- 걷기 모드에 **벽 충돌 없음**(v1 한계, 회차 5 예정) · 대형 모델 지면스냅 예산 초과 시 세션 OFF(BVH 회차 5).

## 검토 방법

```bash
git log master..feat/loop-260712 --oneline
corepack pnpm typecheck && corepack pnpm test          # T0: 606케이스
node apps/web/scripts/run-smokes.mjs --all             # 전 스모크 (vite/백엔드 자동 기동)
node apps/web/scripts/run-smokes.mjs --list            # 매니페스트 요약
```
