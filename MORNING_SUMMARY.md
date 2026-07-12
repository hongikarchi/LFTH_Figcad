# 자율 개선 루프 요약 (2026-07-12, feat/loop-260712)

> 세션 진행 중 지속 갱신. 상세 감사 로그 = `LOOP_LEDGER.md`.
> 플랜: `~/.claude/plans/fable-fluffy-adleman.md` (사용자 승인 2026-07-12 — 스트림 A뷰·C걷기·E하드닝·F소품, §C 권장 디폴트 채택, B-P1 포함·즉시실행)

## TL;DR

자율 루프 **주요 회차 전부 완료** — 18커밋: 검증 인프라(러너 29종·web vitest 신설) + **뷰 시스템 A-S1~S4 완주**(입면 true ortho·full-sphere·포즈 트윈·축-공 기즈모 = `view-and-simplicity-plan.md` A파트 전체) + **AI ui-action 6종**(B-P1, "2층 평면 봐줘") + **걷기 v1.1**(벽 충돌·BVH) + 서버 blob GC + 폰 뷰포인트·핫키. T0 520→**665 테스트**, 스모크 29/29, adversarial 리뷰 5라운드(87건 제기 → 81건 확정 수정, critical 3 포함). 남은 백로그 = 소품(poché DCEL·PDF 다중페이지·Presence·web 테스트 부채).

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
| `d54dd0d` `f0ae559` | **포즈 트윈 + Auto Perspective** (A-S3) — 축뷰 최단호 비행→도착 ortho 스왑, §C-5 거리 기반 뷰포인트 비행. 리뷰 10건 수정(재클릭 플래시·IME 핫키·바텀바 클리핑·plan→걷기 방위 유실 등) | T0 652 + 스모크 6종 ✅ |
| `cb36906` | **AI ui-action 6종** (B-P1) — "2층 평면 봐줘"·"3번 단면"·"동측 입면" 자연어 뷰 제어. 순수 뷰=즉시, 문서 op 동반=승인 후 실행. 리뷰 15건 수정(clip 락스텝·idMap 재매핑·인젝션 프레이밍 등) | core 8케이스 + T0 659 ✅ |
| `77e10f6` `e4a33c0` | **걷기 v1.1** — 벽 충돌(관통 제로·접선 슬라이드)·three-mesh-bvh 가속·클립 인지 스냅. 한도 리셋 후 재검증 완료(13건 확정 반영 — 글랜싱·내부 데드락 관통 2경로 실증·차단) | 충돌 시뮬 9케이스 + walk-smoke ✅ |
| `d20e9e5` | **축-공 뷰 기즈모** (A-S2) — Blender식 방위 위젯(N/E/S/W/T/B·드래그 오빗·persp/ortho 토글·반대축 토글). 리뷰 16건 수정 — **critical: 실브라우저 공 클릭 전멸(포인터 캡처 재타게팅) 사전 차단** | 기즈모 5케이스 + 스모크 실마우스 ✅ |

리뷰 요약: loop-0 리뷰(19에이전트) 확정 15 전부 수정 + 회차 1 리뷰(16에이전트) 확정 12 전부 수정. 뮤테이션 실증·수치 재현 기반(상세 LOOP_LEDGER).

## 아침 결정 대기 (당신 몫)

1. **master 머지 + 배포** — 루프 산출물 검토 후 ff-merge + `railway up`. (직전 미배포 커밋 8개도 함께 나감 — 롤아웃 창 유의: **배포 후 열린 구빌드 탭 전부 새로고침 안내**. ① 재질 페인트 opacity strip ② 구빌드 탭이 PDF 소스 가시성 토글/클립 편집 시 underlay.page가 소거될 수 있음(whole-entry LWW write-back) — 둘 다 같은 클래스)
2. **AI 키 + US 리전** — 설정되면 `node apps/web/scripts/run-smokes.mjs --tags agent`로 실 AI 왕복 검증 즉시 가능 (agent-live-smoke는 키 없으면 SKIP). **신규 ui-action 6종의 실 왕복("2층 평면 봐줘")도 키 이후 검증 항목.**
3. **뷰포인트 projection 필드** — 입면 ortho 뷰포인트는 persp로 복원(페이로드 미확장 — 구빌드 안전). optional 필드 추가 여부는 배포 창 결정.
4. **Auto Perspective 도착 미러 팝** — 축뷰 비행 도착 프레임에 1회 좌우 반전 팝(상태 무손상, 리뷰 수용). 마스킹(크로스페이드/트윈 내 X스케일)은 S2 기즈모와 함께 재평가.

## 알려진 한계 / 리뷰 수용 항목

- **입면 ortho 뷰포인트 = persp로 복원** — 뷰포인트 페이로드에 projection 미저장(구빌드 롤아웃 안전 우선). 각도·거리는 정확, 직교성만 소실. 페이로드 optional 필드 확장은 배포 창 결정 필요.
- **구빌드 혼재 창**: full-sphere(φ>π/2) 뷰포인트를 구빌드가 열면 클램프 복원(위에서 본 각도로 잘림) — 배포 후 열린 탭 새로고침 안내에 포함.
- **plan 진입 스윙**: 아래서 보던 중(φ>π/2) plan 진입 시 카메라가 수평을 지나 크게 회전 — 시각 확인 필요(문제 시 plan 진입만 스냅, 스펙 A3.4 지정 사항).
- **bottom(저면) 뷰도 X반사 적용** = 반사 천장 평면도(RCP) 관례와 부합하나 명시 결정 아님 — 아침에 한 번 봐 주세요.
- 걷기 v1.1 잔여(미검증 리뷰 findings — LOOP_LEDGER 상세): 글랜싱 각도서 벽에 카메라 근접 가능(캡슐 아님의 한계) · 달리기 속도 계단 스터터 가능성 · 대형 단일 메시 BVH 빌드 1프레임 프리즈(1회) · 번들 +~40KB(three-mesh-bvh).
- **세션 한도 도달(18:50 KST 리셋)** — 걷기 리뷰 verify 패스가 중단됨. 리셋 후 루프가 재검증 이어갈 예정. 잔여 회차: S2 축-공 기즈모 · 소품(poché DCEL·PDF 다중페이지 등).

## 검토 방법

```bash
git log master..feat/loop-260712 --oneline
corepack pnpm typecheck && corepack pnpm test          # T0: 606케이스
node apps/web/scripts/run-smokes.mjs --all             # 전 스모크 (vite/백엔드 자동 기동)
node apps/web/scripts/run-smokes.mjs --list            # 매니페스트 요약
```
