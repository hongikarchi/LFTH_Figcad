# Level Structuring (Multi-Level Assignment) — Implementation Plan

> Track: G2 residual — connector v0.6 flattens every lifted element onto one level ('1층'); real model 260629 = 794 elements on one story, absolute z preserved only via `slab.zOffset`/`stair.rise`/`baseOffset`.
> Goal: detect stories from geometry z-distribution, create Level entities, assign elements per story, re-base z params to each level's elevation — so per-story plan views and `ui_set_story` ("2층 평면 봐줘") work on imported models.
> Provenance: 5-area code map + 2 independent designs (connector-first A / model-first B) + judge merge, 8 agents, 2026-07-13. All file:line citations verified by the judge pass.

## Key verified facts (what makes this cheap)

- Geometry derivation is uniformly `level.elevation`-based (deriveWall.ts:68, deriveOthers.ts:16, deriveStructure.ts:149/215/357). Re-basing = pure param transform: `newOffset = oldOffset − (newElev − oldElev)`.
- All 6 connector emit sites already compute `z − ctx.LevelElev` (FigcadConnector.cs:844/852/903/951/977/1010) — per-item level swap auto-rebases. The single-level assumption is one `break` (FigcadConnector.cs:619, TestHarness.cs:324-329).
- IFC import is the working multi-level reference: one Level per IfcBuildingStorey, `height = next.elevation − this.elevation` (top default 3000), order by elevation (ifcImport.ts:83-88).
- `add_level` op already exists and is aiExposed (catalog.ts:792); applyOpLog idMap chaining supports "create level then reference its id".
- Plan-mode ghosting keys off `entry.levelId` (SceneManager.ts:436-467) — multi-story plan works for free once assignment is correct.
- `ui_set_story` resolves exact-id → exact-name → substring (catalog.ts:1150-1159).

## Known hazards (why slicing matters)

- **Re-push dedup key embeds levelId + relative offsets** (connectorDedup.ts:58-75, server-side only, opt-in `?dedup=1`): a room pushed flat then re-pushed structured would dedup-miss and duplicate every element. Must normalize keys before emission changes ship.
- `add_level` is never deduped (CREATE_KIND lacks it) — connector must resolve-or-create by elevation match, not blindly emit.
- `deleteLevel` cascade-deletes all elements on the level (store.ts:553-561) — restructure flows must never delete-then-reassign.
- Verified core bug (fix opportunistically in M1): `update_element` description advertises `baseOffset`, but schema `properties` whitelists neither `baseOffset` nor `levelId` (catalog.ts:854-880, additionalProperties:false).

## Slices

> **상태 (2026-07-14)**: M1~M4 구현+리뷰 완료·미배포. 커밋 = M1+M2 TS `0caeaa0`, C#/문서 `7f2038b`, 토큰 substring `b33ddcc`, **S2/S3 리뷰 수정 `b9c762b`**.
> **리뷰 완료**: S1(TS) 제기 13/확정 5, S2/S3(C#) 제기 11/확정 7(opus 36에이전트) — 전부 수정. 주요: 지붕 강등 오탐(실층 붕괴)·병합 캐스케이드·census≠emission 앵커셋·add_level order 충돌·구서버 부분착지 중복. dotnet test 14→16.
> **검증 그린**: typecheck · vitest 688 · dotnet test 16/16 · story-smoke · 스모크 28/29(comment-e2e = 환경 flaky, 레벨 트랙 무관).
> **deferred 게이트(사용자 Rhino 세션)** = GoldenMultiPush ×2 · StoryCensusToFile(260629 파일 필요) · 배포(서버 M2 먼저 — 구서버는 전 요소 스킵). 오너 결정 7건 중 M1 census 필요분(datum·이름 관례)은 실모델 census 후 확정 — 현재 코드는 절대표고 유지·'N층' 오름차순 디폴트.

### M1 — Report-only story detector (telemetry, zero product change)
- In connector `ClassifyForPush`: anchors = slab top-z (area-weighted primary) + wall/column base-z; beams excluded. Gap-split clustering + weighted median + min-support threshold; roof-slab demotion rule.
- Output = story census in push report (no ops change). Panel shows census; FIDELITY re-run on 260629 copy must stay 782/782 PASS (byte-identical ops).
- Core side-fix: add `baseOffset` + `levelId` to `update_element` schema.
- **Gate**: owner reviews census vs manual count of 260629 before M3 ships naming/datum.

### M2 — Dedup key normalization (server, deploy BEFORE connector M3)
- Keep `?dedup=1` (no new param — old server + new connector degrades to v1 dedup, strictly better than silent OFF).
- Fold **kind-aware absolute z** into vertKey: base kinds `elev+(baseOffset??0)`; slab `elev+(zOffset??0)`; beam explicit-zOffset only, absent → level-bound sentinel (default is `level.height−vHalf`, not 0); roof includes `level.height`; unresolvable levelId → v1 key fallback.
- Add `level-band-mismatch` lint (info severity) — cheap detector for flat-pushed rooms.
- **Gate**: vitest — same-abs-z cross-level match, stacked walls distinct, beam sentinel, v1 fallback; legacy-room re-push produces 0 duplicates.

### M3 — Connector multi-level emission (v0.7)
- POST-A ensure-levels: match existing levels by elevation ±250mm (reuse — never mutate matched level's name/height); create missing via `add_level` with `{LEVELID:k}` tokens substituted **before** POST-C so dedup keys see real ids (apply.ts:474 comment contract).
- Per-element `ResolveLevel(anchorZ, kind)` over a level table (stairs assigned by base elevation, measured rise kept; no per-item ctx mutation).
- Panel toggle "층 자동 구조화" — OFF = byte-identical v0.6 output (instrumented check).
- **Gates**: 3-story golden scene (connector-golden.mjs); second push = 0 new levels + full dedup; FIDELITY 782/782 on fresh room; legacy flat-room re-push = 0 duplicates.

### M4 — E2E smoke + docs
- `story-smoke.mjs`: add_level '2층' + rebased ops → `ui_set_story` resolves → activeLevelId + plan ghosting assert → re-POST = full dedup.
- README: detection rules/thresholds, POST-A contract, legacy-room guidance, **server-before-connector rollout order** (no version handshake exists), refresh-tabs advisory.
- ROADMAP G2 residual update.

### M5 (optional, owner-gated) — In-place reconcile of legacy flat rooms
- `assign_level` capability (kind-aware rebase, single transact, AI-exposed — standalone value: "이 벽들 2층으로 옮겨줘") + `&reconcile=level` rewriting abs-key matches into assign_level ops (ids/paint/comments stable).
- Fund only if a real flat production room needs in-place migration (the 260629 measurement was on a headless copy — verify demand first). Otherwise fresh-room re-push suffices; M2 already prevents duplication.

## Owner decisions (blocking points)

1. **Ground datum** (blocks M3 naming): 260629's lowest story ≈ EL 18,400 — keep absolute elevations ('1층'@18400) vs z-recenter alongside projectOrigin (changes v0.6 absolute-z round-trip contract). Decide from M1 census.
2. **`dedup=1` in-place semantic change** (M2): touches idempotency of every connector push; needs sign-off + enforced server-first rollout.
3. **Story naming convention**: '2층'/'B1층' vs '지하1층'; collision suffix; whitespace-normalized `ui_set_story` matching.
4. **Legacy flat rooms**: fresh re-push (M1–M4 only) vs in-place reconcile (M5).
5. **Roof rule**: demote top slab-only cluster to ceiling vs 'R층' level — revisit after M1 census.
6. **deleteLevel cascade exposure** with auto-created levels: accept with UI confirm vs guard connector-owned levels.
7. Out-of-scope follow-ups: viewpoints don't carry levelId (shared '3층 평면' won't restore story); IFC-import vs connector level matching should eventually share one resolve-or-create helper.
