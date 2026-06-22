# 실사용 검증 (M14) — 배포 + 조율 세션 + 갭 학습

> **Archive:** 2026-06-21 Cloudflare 배포 검증 기록. 현재 primary 운영 URL은 M15 Railway `https://lfthfigcad-production.up.railway.app`.

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
- **멀티플레이어(여러 명 동시 작업) = 정상** (배포서 실확인 2026-06-21) — 해자 핵심이 aspirational 아님 입증.
- AI 편집(배포): "3m 방 만들어" → 작동(사용자 실확인).
- 빈 룸 로드·실시간 연결·전체 도구/타입 = 정상.
- _(세션 더 진행하며 채움)_ federation 오버레이 정합 / 코멘트 앵커 / iPad 펜 …

### ✗ 파손 / 갭 (실모델 조율서 발견 — 2026-06-21)
- **(해결) 원점서 너무 멀다**: 근본원인 = 사용자 설치 .rhp가 **옛버전**(projectOrigin 안 씀·beam 353 garbage·X -2M). 현재 로직으로 푸시하면 recenter(원점 50m)+G2 인식(beam 130). → **fix = `connectors/rhino/figcad-push.cs`**(현재 로직, Rhino _ScriptEditor/MCP서 실행 = 옛 .rhp 우회). 또는 새 .rhp 재설치(bin/Release, Rhino 재시작 후 첫 명령서 로드).
- **(설계상 정상) 라이노랑 다르게 보임 = 구조 프레임**: 인식 = 편집가능 *구조 추상*(기둥·보·벽·슬라브·계단·난간 중심선+타입단면). 라이노 풀 솔리드보다 본질적으로 성김. 곡면 외피 = 자유형 → Lane-2(파라 인식 불가). 진짜 시각일치 = **glTF 오버레이**(아래 이슈).
- **(해결 ✅ 2026-06-22) glTF 오버레이 ↔ 프레임 정합**: Rhino .glb 오버레이가 north축 ~140m 어긋남. 근본 = 외부 glTF(Z-up 툴 export)는 GLTFLoader 로드 시 **north=-Z**(표준 Y-up 우수좌표), Figcad world=**north=+Z** → 거울반전. **박스 실험으로 측정 확정**(알려진 박스 → glb → GLTFLoader world = Z만 부호반전, swap·scale 없음). fix = `@figcad/interop/coords gltfPositionsToFigcad`(Z negate, 순수+단위테스트), extractGltf 경유. **4중 검증**: 박스측정·단위테스트(interop 41)·통합 bbox 게이트(실모델 오버레이 중심 변위 X0.7m·Z0.4m)·시각(puppeteer = 외피 프레임 위 정합). 커밋 `8c…`.
- **(정상 — 갭 아님) 인식 커버리지**: 슬라브 10 = 구조 슬라브(S-Slab) 정확. 라이노 "다른 바닥" = L-PARKING(주차데크·flat39)·I-ceiling(천장)·외피 = **비구조** → Lane-2(설계대로), 오버레이가 다 보여줌. L-PARKING→slab 매핑은 오류(혼합)라 안 함.
- **교훈(검증 방법)**: 좌표버그는 **측정으로 강제**(박스 실험)가 정답 — 추측 3회는 툴링(miniflare staleness·`__figcad` tree-shake)과 싸우다 실패. node 게이트(브라우저 우회) = 신뢰 검증. 시각은 보조.

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
