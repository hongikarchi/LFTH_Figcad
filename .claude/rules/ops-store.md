---
paths:
  - "packages/core/src/store.ts"
  - "packages/core/src/**"
description: DocStore ops·협업 의미론·스냅샷 일관성
---

# DocStore ops 규칙

## 불변 (규칙 2)
모든 문서 변경은 DocStore ops 경유. 앱 코드에서 Y.Map 직접 쓰기 금지 — undo origin·zod 검증·연쇄 삭제가 전부 ops에 있다. **yjs import는 core·collab 밖 금지.**

## 협업 의미론
- 필드 단위 LWW (요소 = 중첩 Y.Map, 각 키 독립 LWW 단위). 같은 키 경합만 LWW.
- **삭제가 편집을 이김** (Y.Map entry 제거). 벽 삭제 시 호스트 개구부 같은 transaction 연쇄 삭제, reconciler는 고아 방어적 스킵.
- undo = 자기 변경만 (`LOCAL_ORIGIN` trackedOrigins). 마이그레이션 origin 제외.
- 새 ops = 단일 `transact` = undo 1스텝.
- 드래그 = ~20-30Hz 스로틀 직접 기록, pointerup에 정확값 1회.

## 경계 처리
- 좌표·치수는 ops 경계에서 `quantize`(mm 정수). AI 좌표는 `z.preprocess(Math.round)` (float 관용 — 1500.5 거부 회귀 방지).
- store zod = 최종 방어선 (capability params zod 통과 후에도).

## 비요소 채널 (comments·views 등)
- 건물요소 아닌 채널은 별도 평면 id맵(`ydoc.getMap('comments')` 등), 엔트리별 LWW.
- 빈-change emit 가드 우회 필요 시 `notifyAll()` (요소 재파생 스킵, 패널만 갱신).
- **snapshot 4경로 관통**: snapshot/snapshotOf/fromSnapshot/importSnapshot 전부에 새 채널 포함. importSnapshot은 `undefined(커밋복원)=보존 vs present(JSON백업)=교체` 구분 (코멘트 영구삭제 critical 버그 교훈).
- schemaVersion 올릴 때 migrate 빈맵 시드 + 테스트.

## 커밋·영속 (M6)
- 커밋 = canonical JSON SHA-256 blob → R2. Doc DO가 커밋 권위(룸 HTTP `?op=`). 커밋 경로 = `serializeCommit`(log RMW 직렬화).
- canonical 비교는 키 순서 불변(라운드트립 가짜 변경 방지).
