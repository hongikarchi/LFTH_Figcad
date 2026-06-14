# Pascal Editor → Figcad: improvement review

> Analysis of [pascalorg/editor](https://github.com/pascalorg/editor) (single-player consumer home-design editor: R3F + WebGPU, Zustand + IndexedDB + Zundo, three-bvh-csg) mined for transferable improvements to Figcad (collaborative upstream BIM hub: vanilla Three render-on-demand, Yjs + Cloudflare DO, parametric, mm-integer, LOD 100–250).
> Produced by a multi-agent compare → adversarial-verify → synthesize workflow. Findings cite actual file:line evidence; off-identity / invariant-violating ideas were rejected. **Untracked analysis doc — keep or delete freely.**

## 1. TL;DR

Pascal is a single-player consumer home-design editor; ~80% of its surface (materials/paint/themes, walkthrough, WebGPU, 11 roof-vent kinds, furniture catalog, R3F `useFrame` geometry systems) is either off Figcad's LOD 100-250 identity or would violate Figcad's render-loop/ops invariants if copied. **Exactly one Pascal idea is genuinely worth taking: its per-`kind` `NodeDefinition` registry** (`packages/nodes/src/<kind>/definition.ts` + `packages/core/src/registry/`), where each kind is a self-contained folder whose `def.*` fields are read by *central* systems (geometry dispatch, cascade resolver, floorplan layer) instead of by a 13-arm if-chain. Figcad's real pain — the "new Element kind" 10-step silent if-chain in `.claude/rules/core-geometry.md` — is the same problem Pascal already solved. Critically, **Figcad already has a registry, but it is keyed by *operation*** (`packages/core/src/capabilities/` — `create_wall`/`move`/… for AI tools + executeOp), **not by *kind***; the per-kind logic is still scattered if-chains. The transferable move is to add a per-*kind* dispatch table that the central executor and derive-cache *consult* (a data table, never a bypass of ops). Secondary, higher-ROI-first win: **close the IFC/.3dm import asymmetry** (export covers 10+ kinds, import restores only wall/slab/grid/openings). Everything else is rejected (see §3). Figcad already does collab, ops-discipline, parametric derivation, real construction-drawing generation, and offline persistence far beyond anything Pascal has (see §4).

---

## 2. Prioritized recommendations

### ⭐ HEADLINE — Per-`kind` NodeDefinition dispatch table (extend, don't reinvent, the registry)

**The problem.** Adding a new Element kind today requires touching ~10 sites, several of which are parallel `el.kind === '…'` if-chains that the compiler does not force you to update completely (the checklist warns "누락 = 조용한 버그"). The concrete chains:

- `packages/core/src/geometry/index.ts:173–285` — 13-arm `DeriveCache.derive` dispatch.
- `packages/core/src/store.ts` — duplicated kind-taxonomy arms for move (`:1148–1190`), rotate (`:1206–1240`), transformCopy (`:1052–1146`), validate/quantize (`:816–895`).
- `packages/core/src/select.ts:147–186` — `elementFootprint` taxonomy.
- `packages/core/src/lint.ts:69` `KIND_LABEL` **and** the duplicate `KIND_LABEL` in `packages/core/src/diff.ts`.
- Per-kind interop arms in `packages/interop/src/{ifcExport,ifcImport,rhino3dm,dxf}.ts`.

**Frame it correctly (avoids the "already exists" trap).** Figcad's `packages/core/src/capabilities/registry.ts` is a registry keyed by **op id** (`create_wall`, `move`), consumed by AI/executeOp/UI — that is real and good, and **step 6 of the checklist already routes through it**. What's missing is the *orthogonal* axis: a registry keyed by **kind** that carries per-kind derivation/footprint/label/relations/interop, exactly like Pascal's `NodeDefinition` (`packages/core/src/registry/types.ts`, `registry.ts`). Pascal proves the central-vs-data split works: its `cascadeDirty`/`collectDescendants` (`packages/core/src/registry/relations-resolver.ts`) is one central walk that reads each kind's `def.relations.{hosts,cascadeDelete}` as **data** — the policy stays central, only the declaration moves into the kind folder.

**Which of the 10 steps collapse into a `def.*` lookup (central code reads the table):**

| Step | Today | Collapses to |
|---|---|---|
| **2 + 3** derive + deriveKey + DeriveCache arm | `deriveX.ts` + 13-arm if-chain at `index.ts:173–285` | `def.derive(ctx)` + `def.deriveKey`; the dispatch becomes `registry.get(el.kind).derive(ctx)`. The cache memo, and the **cross-element dependency gathering** (`findJoin`, `hostedOpenings`, binding resolution at `index.ts:266–284`) **stay central**. |
| **5** footprint + move/rotate/transformCopy geometric arms | 4 separate kind-taxonomies in `select.ts` + `store.ts` | **ONE `def.positional` declaration** (`segment`{a,b} / `polygon`{boundary} / `point`{at}) feeds all four central operations. **This is the single cleanest win** — it kills four duplicated taxonomies at once. |
| **7 + 8** `KIND_LABEL` (×2) + dup-check label | `lint.ts:69`, `diff.ts` | one `def.label` (Pascal's `def.presentation.label`). |
| **9** per-kind interop map | arms in 4 interop files | `def.ifc` / `def.dxf` / `def.rhino` contribution (Pascal's `def.mcp`-style per-kind descriptors). Links to the import-completeness item below. |
| **10** Tool / panel / palette / icon | `web-tools.md` chain | `def.tool` (lazy `() => import`) / `def.presentation` / `def.toolHints`, exactly as Pascal's `wall/definition.ts:79,115`. |

**Which steps MUST stay central (cite Rule 2 + Rule 1):**

- **Step 4 store policy** — zod-at-boundary, `quantize` (mm-integer), undo-origin (`LOCAL_ORIGIN`), `transact` = 1 undo step. These are Rule 2; they live in `store.ts` and a registry must never let app code bypass them.
- **Cascade *execution* + delete-wins** (`store.ts:896–910`): the wall→opening cascade becomes *data* (`def.relations.cascadeDelete`, like Pascal), but the walk + `transact` stay central, mirroring `relations-resolver.ts`.
- **DeriveCache memo + cross-element dependency gathering** — see step 2/3 row. Pascal's own `wall/definition.ts` Stage B is *deferred* precisely because wall geometry needs cross-element miter data that doesn't fit the generic `(node, ctx) => Group` shape — direct evidence that dependency-gathering must stay central. Don't overpromise here.
- **Step 1 the `Element` discriminated union** — a compile-time TS union cannot be runtime-registered. It stays hand-written.

**Honesty guard.** A runtime table trades away the if-chains' one virtue: TS exhaustiveness (`never`-checks). Pascal pays for this with `as unknown as AnyNodeDefinition` casts in `nodes/src/index.ts` — which fight Figcad's `strict`. Mitigate by keeping the `Element` union authoritative and asserting at registration that every union member has a registered def (a single test, not per-call casts). **Reject Pascal's plugin-marketplace half** (`loadPlugin`/`setPluginDiscovery`/`apiVersion` gating in `registry.ts:193–240`): Figcad is an internal LFTH tool with zero third-party plugin consumers — same YAGNI lesson as the removed MCP API. Take the internal dispatch table only.

- **Invariant constraint:** Rule 2 (registry is a table the central ops-executor reads; ops/zod/undo/cascade stay in `store.ts`) + Rule 1 (`def.derive` must remain a pure param→mesh function, output stays client-local cache).
- **Effort: XL.** Do it kind-by-kind behind the existing union, exactly like Pascal's staged A–E migration — not a big-bang rewrite. Start with `def.positional` (step 5) since it's the highest collapse-per-line.
- **Impact: High.** Directly removes the most expensive recurring cost in the codebase (the silent-if-chain bug class) and makes Phase 2/future kinds cheap.

---

### #2 — Close the IFC / .3dm import round-trip asymmetry (do this FIRST)

**The problem.** Export is comprehensive but import is lossy. `ifcImport.ts:9–14` restores only wall/slab/door+window; `rhino3dm.ts:24–28` restores only Wall-axis/Slab/Grid and **skips column/beam/stair/railing/roof/curtainwall/zone with skip-and-count**. For a tool whose identity is "multi-tool interop **orchestrator** … hand off to IFC/DXF/.3dm," a one-way bridge is a real weakness — and it directly blocks the Phase 5 validation goal (round-tripping the real `260416 MODELING.3dm`).

**What to change.** Add inverse importers for the kinds that already have a clean **parametric inverse** (all of column/beam/stair/railing/roof/curtainwall/zone are *exported from parameters*, so the inverse is mechanical). Reuse the existing `skipped` counter for anything without one.

- **Files:** `packages/interop/src/ifcImport.ts`, `packages/interop/src/rhino3dm.ts` (+ `dxf.ts` if 2D blocks carry kind hints).
- **Invariant constraint:** Rule 1 — import must reconstruct *parameters* (centerline/profile/boundary/height) and call `store.create*` ops, **never** inject geometry. B-rep/mesh skip-and-count is **correct, not a bug** (arbitrary brep→params is the deferred v1.5 AI semantic-lift). Rule 2 — import writes only through DocStore ops.
- **Effort: M.** Per-kind, additive; each kind is the same shape as the existing wall/slab importer.
- **Impact: Medium-High.** Unblocks the Phase 5 validation goal without waiting on the XL registry refactor. **This is the better impact/effort *first* move.** It is also the *same* per-kind work the registry's `def.ifc`/`def.rhino` will eventually own — build it import-first, then fold the maps into the registry in #1.

---

## 3. Considered and rejected

| Feature (Pascal) | Reason |
|---|---|
| three-bvh-csg for openings | **LOD, not invariant.** `deriveWall.ts:48` deliberately uses earcut holes ("CSG 불필요"); rectangular openings need no boolean at LOD 100-250. Pascal's CSG is only chimney/dormer roof-penetration = below LOD. (Note: CSG-as-pure-derivation would *not* violate Rule 1 — the reject is scope, not legality.) |
| `loadPlugin` / `setPluginDiscovery` / `apiVersion` plugin marketplace | Off-identity / YAGNI. Internal LFTH tool, zero third-party consumers — same lesson as the removed MCP API. Take the internal dispatch table from #1, not the marketplace shell. |
| Materials / paint mode / 13 presets / themes | Off-identity (consumer eye-candy, below LOD 100-250). |
| Walkthrough / street-view | Off-identity. |
| WebGPU / R3F `useFrame` geometry "systems" | Violates Rule 3 (geometry in render loop) + Rule 4 isolation; Figcad is vanilla Three render-on-demand. |
| 11 roof-vent kinds, furniture catalog, `item`/`shelf` | Off-identity (below LOD 100-250). |
| Per-node `floorplan.ts` (2D editing-layer footprint) | **Already exists** as `elementFootprint` in `select.ts` — and is a per-kind `def.positional` candidate under #1. Not to be confused with Figcad's `deriveDrawing.ts` (real cut/projection/section/elevation+HLR+hatch), which Pascal has **no** equivalent of. |
| Zundo undo / Zustand+IndexedDB persist | Conflicts with invariant. Figcad undo is Yjs `UndoManager` with `LOCAL_ORIGIN` per-user semantics (Rule 2); offline already covered by `y-indexeddb` (`provider.ts:26`). Pascal's single-player model has no collab/origin semantics to preserve. |
| `def.mcp` descriptors / programmable API | Already removed from Figcad as YAGNI (MEMORY); mechanism re-landed as `?op=apply`. |

---

## 4. Where Figcad already beats Pascal (balance)

- **Real-time collaboration.** Yjs + y-partyserver + Cloudflare DO, field-level LWW, delete-wins, per-user undo (`LOCAL_ORIGIN`), presence/soft-locks. Pascal is single-player; it has none of this.
- **Ops discipline.** All mutations funnel through DocStore ops with zod-at-boundary + quantize + cascade in one place (`store.ts`). Pascal nodes self-write via Zustand with no ops/undo-origin/cascade layer.
- **Parametric purity.** Geometry is never stored — pure param→mesh in `packages/core/src/geometry/` with a hash-memoized `DeriveCache`. Pascal generates geometry inside the React `useFrame` render loop (which would violate Figcad Rule 3).
- **Construction drawings.** `deriveDrawing.ts` produces real plan (cut-at-height + projection), section, and elevation with hidden-line removal + hatch (Phase 1, shipped). **Pascal has no construction-drawing equivalent** — only a 2D editing footprint.
- **Offline + persistence.** `y-indexeddb` is already wired (`apps/web/src/collab/provider.ts:3,26`) as a local cache atop a server-of-record. So "local-first/offline" is **not** a gap — do not recommend it.

**Bottom line:** take exactly two things — the per-`kind` dispatch table (XL, headline, staged kind-by-kind) and the import-completeness fix (M, do first, folds into the registry later). Reject the rest as off-identity or already-present.
