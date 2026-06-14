import { describe, expect, it } from 'vitest';
import { DocStore, critiqueOpLog, seedDocument, SEED_IDS, type OpLogEntry } from '../src';

/**
 * lint-in-loop critic 코어(critiqueOpLog) — 결정적 lint를 AI가 이번 턴 건드린
 * 요소에만 적용. 외부 결정적 검증자만(LLM 판사 없음). agent.ts가 이 함수를 루프
 * 종료 직전 호출해 error면 재프롬프트, warning/info면 통지한다.
 */

const L = SEED_IDS.level;

function seeded(): DocStore {
  const s = new DocStore();
  seedDocument(s);
  return s;
}

describe('critiqueOpLog', () => {
  it('빈 opLog → 무비평', () => {
    expect(critiqueOpLog(seeded(), [])).toEqual({ errors: [], warnings: [] });
  });

  it('AI가 만든 겹침 벽 → warning 비평 (result id가 touched)', () => {
    const s = seeded();
    s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const dup = s.createWall({ levelId: L, typeId: SEED_IDS.wall100, a: [0, 30], b: [4000, 30] });
    const log: OpLogEntry[] = [
      { op: 'create_wall', args: { levelId: L, typeId: SEED_IDS.wall100 }, result: dup },
    ];
    const c = critiqueOpLog(s, log);
    expect(c.errors).toEqual([]);
    expect(c.warnings.some((f) => f.code === 'overlap-wall')).toBe(true);
  });

  it('touched 밖의 기존 이슈는 비평 안 함 (잔소리 금지)', () => {
    const s = seeded();
    s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    s.createWall({ levelId: L, typeId: SEED_IDS.wall100, a: [0, 30], b: [4000, 30] }); // 겹침이나 opLog 밖
    const other = s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [0, 9000], b: [1000, 9000] });
    const log: OpLogEntry[] = [{ op: 'create_wall', args: {}, result: other }];
    const c = critiqueOpLog(s, log);
    expect(c.warnings).toEqual([]);
    expect(c.errors).toEqual([]);
  });

  it('AI가 만든 개구부 부적합 → error 비평 (재프롬프트 트리거)', () => {
    const s = seeded();
    const tiny = s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [20000, 0], b: [20120, 0] });
    const op = s.createOpening({ hostId: tiny, typeId: SEED_IDS.door900, offset: 60 });
    const log: OpLogEntry[] = [
      { op: 'create_wall', args: {}, result: tiny },
      { op: 'create_opening', args: { hostId: tiny }, result: op },
    ];
    const c = critiqueOpLog(s, log);
    expect(c.errors.some((f) => f.code === 'opening-misfit' && f.severity === 'error')).toBe(true);
  });

  it('args.ids로 참조한 요소도 touched (이동·중복 등)', () => {
    const s = seeded();
    const w1 = s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const w2 = s.createWall({ levelId: L, typeId: SEED_IDS.wall100, a: [0, 30], b: [4000, 30] });
    const log: OpLogEntry[] = [{ op: 'move_elements', args: { ids: [w1, w2] }, result: null }];
    const c = critiqueOpLog(s, log);
    expect(c.warnings.some((f) => f.code === 'overlap-wall')).toBe(true);
  });

  it('깨끗한 작업 → 무비평', () => {
    const s = seeded();
    const ids = [
      s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] }),
      s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [4000, 0], b: [4000, 3000] }),
    ];
    const log: OpLogEntry[] = ids.map((id) => ({ op: 'create_wall', args: {}, result: id }));
    expect(critiqueOpLog(s, log)).toEqual({ errors: [], warnings: [] });
  });
});
