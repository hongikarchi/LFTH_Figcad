# 실사용 검증 (M14) — 배포 + 조율 세션 + 갭 학습

> 목적: M13 허브를 실제 배포 + LFTH 실모델로 2명+ 실제 조율 → **해자(중립+편집+실시간 멀티플레이어 ON federation)가 진짜인지, 실제 빠진 게 뭔지** 학습. 다음 빌드 결정의 근거. (positioning: 미배포라 "aspirational" — 이걸 깨는 게 목적.)

## 배포 (✅ 2026-06-21)
- **URL**: https://figcad.archivibe.workers.dev · **Version**: `ed8fcb97-4c30-41e8-862e-30c14a60cbe8`
- M12+M13+M13.5+M13.6 전체 (기존 워커 업데이트 = 신규 용량 아님).
- **배포 스모크 전부 GREEN**: root/asset 200(fresh dist) · origin GET/POST · pull · fed-upload+fed-blob 왕복(R2) · ANTHROPIC secret set · **AI end-to-end**(NL→플랜 7ops→승인→적용, 403 없음=wnam DO) · 멀티플레이어 WS/DO(AI 적용으로 간접 입증).

## 조율 세션 시작 (사용자 — 실제 2명+)
1. **실모델 올리기** (Rhino, .rhp 설치됨 = deployed 타깃 기본):
   - `FigcadPushBreps` → 룸 id(예 `lfth-review`) → 프레임(기둥/벽/슬라브/보/계단/난간, recenter+origin) 자동 push.
   - (선택) 외피: Rhino `_Export` .glb → 브라우저 룸서 네비게이터 "연동 모델" 업로드 → glTF 오버레이.
2. **함께 열기**: 2+ 기기(iPad Pencil + 데스크톱)서 `https://figcad.archivibe.workers.dev/?p=lfth-review`.
3. **조율**: presence(커서)·코멘트·federation 토글·줌핏(F)·버전·AI 편집("벽 옮겨" 등)·치수·sketch.

## 갭 캡처 (세션 중/후 — 이게 M14 산출)
> 작동/파손/**진짜 빠진 것**. 솔직하게. 다음 빌드(ingest-PR·조율성숙·E·커넥터)의 근거.

### ✅ 작동 (해자 실재 확인된 것)
- _(세션 후 채움)_ 예: 2명 동시 같은 화면 / federation 오버레이 정합 / 코멘트 앵커 / AI 편집…

### ✗ 파손 (배포·실모델서 깨진 것)
- _(세션 후 채움)_ 예: 큰 모델 로드 느림 / 특정 라우트 에러 / 모바일 UX…

### 🕳 진짜 갭 (실제 조율에 빠진 것 = 다음 빌드 후보)
- _(세션 후 채움)_ 후보 렌즈:
  - **ingest=PR**: import가 staging 리뷰 없이 바로 들어감? 정리 단계 필요?
  - **조율 성숙**: federation 모델에 코멘트/마크업/클래시 가리킴 되나? 크로스모델 비교?
  - **대형파일**: 실모델이 436MB급이면 로드 되나(E 3D-Tiles 필요?)?
  - **커넥터**: 1회 import 말고 라이브-ish 재push 편한가? IFC/Revit 경로?
  - **편집-왕복**: 허브서 편집→원툴 반영이 실제 워크플로에 쓸 만한가?

### 결론 → 다음 재계획
- _(갭 종합 후)_ 다음 마일스톤 방향.

## 용량/운영 메모
- DO 무료 일일한도 — 세션 후 버스트 소진 시 매일 00:00 UTC 리셋. 헤드룸=Workers Paid $5(코드 0).
- 재배포 잦으면 용량 — 검증 세션은 1배포로 충분. 끝나면 그대로 두거나(다음 세션 재사용) 사용자 판단.
