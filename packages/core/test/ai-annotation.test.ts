import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';
import { AI_TOOLS, applyOpLog, executeOp, type OpLogEntry } from '../src/ai';
import { DeriveCache } from '../src/geometry';
import type { DimensionElement, WallElement } from '../src/schema';

/**
 * AI 주석 파이프라인 — LLM 없이 검증.
 * 실제 흐름: 서버가 인메모리 스토어에 executeOp로 op 적용(드라이런)하며 opLog 기록 →
 * 클라이언트가 승인 시 applyOpLog로 자기 스토어에 재생(id 재매핑).
 * 여기선 "AI가 낼 opLog"를 손으로 구성해 양 단계를 그대로 돌린다.
 */

describe('AI 주석 도구 — opLog 파이프라인 (LLM 무관)', () => {
  it('buildAiTools에 create_dimension 노출 · create_text는 제거', () => {
    const names = AI_TOOLS.map((t) => t.name);
    expect(names).toContain('create_dimension');
    expect(names).not.toContain('create_text'); // 텍스트 생성 완전 제거(레이블로 대체, 일관성)
    // 각 도구에 input_schema 존재 (agent.ts가 그대로 API에 넘김)
    const dim = AI_TOOLS.find((t) => t.name === 'create_dimension')!;
    expect(dim.input_schema).toBeTruthy();
  });

  it('드라이런→재생: 벽+치수, 치수는 좌표 기반이라 재생 스토어 진짜 벽에 자동 바인딩', () => {
    // --- 서버 드라이런 (인메모리) ---
    const dry = new DocStore();
    seedDocument(dry);
    const log: OpLogEntry[] = [];
    const run = (op: string, args: Record<string, unknown>) => {
      const result = executeOp(dry, op, args);
      log.push({ op, args, result });
      return result;
    };
    // "방 한 벽 그리고 치수 넣어줘"가 낼 법한 opLog
    const dryWall = run('create_wall', {
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [0, 0],
      b: [4000, 0],
    }) as string;
    run('create_dimension', { levelId: SEED_IDS.level, a: [0, 0], b: [4000, 0], offset: 600 });

    // 드라이런 스토어에서 치수가 드라이 벽에 바인딩됐는지
    const dryDim = dry.listElements().find((e): e is DimensionElement => e.kind === 'dimension')!;
    expect(dryDim.bindA).toEqual({ id: dryWall, anchor: 'a' });

    // --- 클라이언트 재생 (별도 스토어, 같은 고정 시드 id) ---
    const real = new DocStore();
    seedDocument(real);
    const res = applyOpLog(real, log);
    expect(res.applied).toBe(2);
    expect(res.failed).toHaveLength(0);
    expect(res.createdIds).toHaveLength(2);

    const wall = real.listElements().find((e): e is WallElement => e.kind === 'wall')!;
    const dim = real.listElements().find((e): e is DimensionElement => e.kind === 'dimension')!;

    // 재생 벽 id는 드라이 id와 다름 (독립 nanoid)
    expect(wall.id).not.toBe(dryWall);
    // 치수는 좌표 기반 바인딩이라 remap 없이 재생 스토어의 *진짜* 벽에 묶임
    expect(dim.bindA).toEqual({ id: wall.id, anchor: 'a' });
    expect(dim.bindB).toEqual({ id: wall.id, anchor: 'b' });
    expect(dim.offset).toBe(600);

    // 추종 동작: 재생 스토어에서 벽 끝점 이동 → 치수 측정값 갱신
    const cache = new DeriveCache();
    expect(cache.derive(real, dim.id)!.labels?.[0]?.text).toBe('4000');
    real.updateElement(wall.id, { b: [5500, 0] });
    expect(cache.derive(real, dim.id)!.labels?.[0]?.text).toBe('5500');
  });

  it('자유 치수(끝점 불일치) — 바인딩 없이 재생', () => {
    const dry = new DocStore();
    seedDocument(dry);
    const log: OpLogEntry[] = [];
    const r = executeOp(dry, 'create_dimension', { levelId: SEED_IDS.level, a: [1000, 1000], b: [3000, 1000] });
    log.push({ op: 'create_dimension', args: { levelId: SEED_IDS.level, a: [1000, 1000], b: [3000, 1000] }, result: r });

    const real = new DocStore();
    seedDocument(real);
    applyOpLog(real, log);
    const dim = real.listElements().find((e): e is DimensionElement => e.kind === 'dimension')!;
    expect(dim.bindA).toBeUndefined(); // 일치 요소 없음 → 자유
    expect(dim.a).toEqual([1000, 1000]);
  });
});
