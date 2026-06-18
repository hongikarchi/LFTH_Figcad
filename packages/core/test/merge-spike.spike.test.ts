/* ============================================================================
 * THROWAWAY RESEARCH SPIKE — R1 (geometry-representation-study.md §6 step 0)
 *
 * NOT production code. NOT shipped. Excluded from the build gate (`*.spike.*`,
 * vitest.config.ts). Produces empirical numbers for docs/merge-spike-results.md.
 *
 * QUESTION: when users concurrently edit + merge via Yjs CRDT, how often does the
 * result converge to a structurally-valid consensus model that is DOMAIN-INVALID
 * (overlap-wall, orphan-opening, opening-misfit…)?
 *   rare / lint-caught  -> path A (merge + post-merge lint flag = M13-B) survives.
 *   frequent / silent   -> server-authority retreat (Onshape).
 *
 * METHOD: per trial+category, fork base into 2 peers, apply each peer's edit,
 * snapshot each peer's SOLO lint (before-set), merge, then count lint findings on
 * the merged doc NOT in (beforeA ∪ beforeB), keyed by `code + sorted(elementIds)`
 * — i.e. only the dirt the MERGE introduced. Integer RNG (test env; determinism
 * irrelevant for a measurement harness).
 * ========================================================================== */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as Y from 'yjs';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';
import { lint, type LintCode } from '../src/lint';

function fork(base: DocStore): DocStore {
  const f = new DocStore();
  Y.applyUpdate(f.ydoc, Y.encodeStateAsUpdate(base.ydoc));
  return f;
}
function merge(a: DocStore, b: DocStore): void {
  const av = Y.encodeStateVector(a.ydoc);
  const bv = Y.encodeStateVector(b.ydoc);
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, av));
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, bv));
}
const keys = (s: DocStore): Set<string> =>
  new Set(lint(s).map((f) => `${f.code}|${f.elementIds.slice().sort().join(',')}`));
function mergeIntroduced(merged: DocStore, beforeA: Set<string>, beforeB: Set<string>): LintCode[] {
  const out: LintCode[] = [];
  for (const f of lint(merged)) {
    const k = `${f.code}|${f.elementIds.slice().sort().join(',')}`;
    if (!beforeA.has(k) && !beforeB.has(k)) out.push(f.code);
  }
  return out;
}
const rnd = (n: number) => Math.floor(Math.random() * n);
const TRIALS = 100;

describe('R1 merge spike (throwaway)', () => {
  it('카테고리별 머지 유발 무효 빈도', () => {
    const tally: Record<string, { trials: number; invalid: number; byCode: Record<string, number> }> = {};
    const bump = (cat: string, found: LintCode[]) => {
      const t = (tally[cat] ??= { trials: 0, invalid: 0, byCode: {} });
      t.trials++;
      if (found.length) {
        t.invalid++;
        for (const c of found) t.byCode[c] = (t.byCode[c] ?? 0) + 1;
      }
    };

    const newBase = () => {
      const base = new DocStore();
      seedDocument(base);
      const w1 = base.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
      const w2 = base.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 2000], b: [4000, 2000] });
      return { base, w1, w2 };
    };
    // 한 카테고리 실행: editA/editB는 각 피어 fork에 편집 적용
    const run = (cat: string, mk: () => { base: DocStore; w1: string; w2: string }, editA: (s: DocStore, w1: string, w2: string) => void, editB: (s: DocStore, w1: string, w2: string) => void) => {
      const { base, w1, w2 } = mk();
      const fa = fork(base), fb = fork(base);
      editA(fa, w1, w2);
      editB(fb, w1, w2);
      const beforeA = keys(fa), beforeB = keys(fb); // 각 피어 솔로 lint (머지 전)
      merge(fa, fb);
      bump(cat, mergeIntroduced(fa, beforeA, beforeB));
    };

    for (let i = 0; i < TRIALS; i++) {
      // A: 두 피어가 각자 벽을 서로 향해 이동 → 겹칠 수 있음 (머지 간격 0~210mm)
      run('A 끝점 상호이동', newBase,
        (s, w1) => { const g = rnd(210); s.updateElement(w1, { a: [0, 2000 - g], b: [4000, 2000 - g] }); },
        () => {}); // 피어B는 w2 유지 — w1만 w2로 접근
      // B: 두 피어가 같은 영역에 새 벽 추가 → 중복/겹침
      run('B 같은영역 벽추가', newBase,
        (s) => s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 1000], b: [4000, 1000] }) as unknown as void,
        (s) => s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 1000 + rnd(30)], b: [4000, 1000 + rnd(30)] }) as unknown as void);
      // C: 피어1 벽 삭제 vs 피어2 그 벽에 개구부 추가 → 고아 개구부(삭제승)
      run('C 삭제vs개구부추가', newBase,
        (s, w1) => s.deleteElements([w1]),
        (s, w1) => s.createOpening({ hostId: w1, typeId: SEED_IDS.door900, offset: 2000 }) as unknown as void);
      // D: 피어1 벽 대폭 단축 vs 피어2 그 벽 먼 끝에 개구부 → 미스핏/클램프
      run('D 벽단축vs개구부', newBase,
        (s, w1) => s.updateElement(w1, { b: [800, 0] }),
        (s, w1) => s.createOpening({ hostId: w1, typeId: SEED_IDS.door900, offset: 3500 }) as unknown as void);
      // E: 직교 필드 LWW — 피어1 height, 피어2 끝점 (무효 없어야 = 머지가 깨끗한 경우)
      run('E 직교필드 LWW', newBase,
        (s, w1) => s.updateElement(w1, { height: 2800 + rnd(400) }),
        (s, w1) => s.updateElement(w1, { b: [3500 + rnd(200), 0] }));
    }

    const lines = ['=== R1 MERGE SPIKE (trials/category=' + TRIALS + ') ==='];
    for (const [cat, t] of Object.entries(tally)) {
      const pct = ((100 * t.invalid) / t.trials).toFixed(0);
      const cs = Object.entries(t.byCode).map(([c, n]) => `${c}:${n}`).join(' ') || '—';
      lines.push(`${cat}: ${t.invalid}/${t.trials} (${pct}%) merge-invalid  [${cs}]`);
    }
    writeFileSync(new URL('./.merge-spike-out.txt', import.meta.url), lines.join('\n'), 'utf8');
  });
});
