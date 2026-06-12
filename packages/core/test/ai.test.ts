import { describe, expect, it } from 'vitest';
import {
  DocStore,
  seedDocument,
  SEED_IDS,
  executeOp,
  applyOpLog,
  opSummary,
  AI_TOOLS,
  type OpLogEntry,
} from '../src';

/** 드라이런(서버) → 승인 재생(클라이언트) 흐름 재현 헬퍼 */
function dryRun(
  real: DocStore,
  ops: { op: string; args: Record<string, unknown> }[],
): { dry: DocStore; log: OpLogEntry[] } {
  const dry = DocStore.fromSnapshot(real.snapshot());
  const log: OpLogEntry[] = [];
  for (const { op, args } of ops) {
    const result = executeOp(dry, op, args);
    log.push({ op, args, result });
  }
  return { dry, log };
}

describe('snapshot/fromSnapshot', () => {
  it('스냅샷 라운드트립 — id·필드 보존', () => {
    const store = new DocStore();
    seedDocument(store);
    const wallId = store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [0, 0],
      b: [4000, 0],
    });
    store.createOpening({ hostId: wallId, typeId: SEED_IDS.door900, offset: 1500 });

    const copy = DocStore.fromSnapshot(store.snapshot());
    expect(copy.listElements()).toHaveLength(2);
    expect(copy.getElement(wallId)?.kind).toBe('wall');
    expect(copy.listLevels()).toEqual(store.listLevels());
    expect(copy.listTypes().length).toBe(store.listTypes().length);
    // 독립성: 사본 변경이 원본에 전파되지 않음
    copy.deleteElements([wallId]);
    expect(store.getElement(wallId)).toBeDefined();
  });
});

describe('executeOp', () => {
  it('전 도구 이름이 executeOp에서 처리됨 (unknown 방지)', () => {
    const store = new DocStore();
    seedDocument(store);
    for (const tool of AI_TOOLS) {
      // 인자 검증 에러는 허용 — 'unknown op'만 금지
      try {
        executeOp(store, tool.name, {});
      } catch (e) {
        expect(String(e)).not.toContain('unknown op');
      }
    }
  });

  it('create_wall → create_opening 체인 (드라이런 일관성)', () => {
    const store = new DocStore();
    seedDocument(store);
    const wallId = executeOp(store, 'create_wall', {
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [0, 0],
      b: [3000, 0],
    }) as string;
    const openingId = executeOp(store, 'create_opening', {
      hostId: wallId,
      typeId: SEED_IDS.door900,
      offset: 1500,
    }) as string;
    expect(store.getElement(openingId)?.kind).toBe('opening');
    expect(store.openingsOf(wallId)).toHaveLength(1);
  });

  it('rotate_elements는 도 단위 입력', () => {
    const store = new DocStore();
    seedDocument(store);
    const id = store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [0, 0],
      b: [1000, 0],
    });
    executeOp(store, 'rotate_elements', { ids: [id], center: [0, 0], angleDeg: 90 });
    const wall = store.getElement(id);
    expect(wall?.kind === 'wall' && wall.b).toEqual([0, 1000]);
  });

  it('trim_extend_wall은 targetWallId로 기준 벽 조회', () => {
    const store = new DocStore();
    seedDocument(store);
    const w1 = store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [0, 0],
      b: [2000, 0],
    });
    const w2 = store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [3000, -1000],
      b: [3000, 1000],
    });
    executeOp(store, 'trim_extend_wall', { id: w1, end: 'b', targetWallId: w2 });
    const wall = store.getElement(w1);
    expect(wall?.kind === 'wall' && wall.b).toEqual([3000, 0]);
  });
});

describe('applyOpLog (승인 재생 + id 재매핑)', () => {
  it('드라이런 id가 재생 시 실제 id로 치환된다 (벽→개구부 체인)', () => {
    const real = new DocStore();
    seedDocument(real);

    // 서버: 드라이런으로 계획 생성
    const { dry, log } = (() => {
      const dry = DocStore.fromSnapshot(real.snapshot());
      const log: OpLogEntry[] = [];
      const wallArgs = {
        levelId: SEED_IDS.level,
        typeId: SEED_IDS.wall200,
        a: [0, 0],
        b: [4000, 0],
      };
      const dryWallId = executeOp(dry, 'create_wall', wallArgs) as string;
      log.push({ op: 'create_wall', args: wallArgs, result: dryWallId });
      const openArgs = { hostId: dryWallId, typeId: SEED_IDS.door900, offset: 2000 };
      const dryOpenId = executeOp(dry, 'create_opening', openArgs) as string;
      log.push({ op: 'create_opening', args: openArgs, result: dryOpenId });
      return { dry, log };
    })();
    expect(dry.listElements()).toHaveLength(2);
    expect(real.listElements()).toHaveLength(0); // 원본 무변경

    // 클라이언트: 승인 → 재생
    const result = applyOpLog(real, log);
    expect(result.applied).toBe(2);
    expect(result.failed).toHaveLength(0);
    const walls = real.listElements().filter((e) => e.kind === 'wall');
    const openings = real.listElements().filter((e) => e.kind === 'opening');
    expect(walls).toHaveLength(1);
    expect(openings).toHaveLength(1);
    // 재호스트: 새 벽 id ≠ 드라이런 id, 개구부 hostId = 새 벽 id
    expect(walls[0]!.id).not.toBe(log[0]!.result);
    expect(openings[0]!.kind === 'opening' && openings[0]!.hostId).toBe(walls[0]!.id);
  });

  it('배열 복사 결과(string[])도 짝지어 매핑된다', () => {
    const real = new DocStore();
    seedDocument(real);
    const baseArgs = {
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [0, 0],
      b: [2000, 0],
    };
    const { log } = dryRun(real, [
      { op: 'create_wall', args: baseArgs },
      // 다음 op의 ids는 앞 op의 드라이런 결과를 참조해야 한다 — dryRun 헬퍼로는 불가하므로 수동
    ]);
    // 수동 체인: 드라이런 벽 id로 array → 그 결과 중 하나 삭제
    const dry = DocStore.fromSnapshot(real.snapshot());
    const dryWall = executeOp(dry, 'create_wall', baseArgs) as string;
    const arrayArgs = { ids: [dryWall], delta: [0, 3000], count: 2 };
    const dryCopies = executeOp(dry, 'array_elements', arrayArgs) as string[];
    const delArgs = { ids: [dryCopies[1]!] };
    executeOp(dry, 'delete_elements', delArgs);
    const fullLog: OpLogEntry[] = [
      { op: 'create_wall', args: baseArgs, result: dryWall },
      { op: 'array_elements', args: arrayArgs, result: dryCopies },
      { op: 'delete_elements', args: delArgs, result: null },
    ];
    expect(log).toHaveLength(1); // dryRun 헬퍼 로그 (사용 안 함 경고 방지)

    const result = applyOpLog(real, fullLog);
    expect(result.failed).toHaveLength(0);
    // 벽 1 + 복사 2 - 삭제 1 = 2
    expect(real.listElements().filter((e) => e.kind === 'wall')).toHaveLength(2);
  });

  it('개별 실패는 건너뛰고 나머지 적용', () => {
    const real = new DocStore();
    seedDocument(real);
    const log: OpLogEntry[] = [
      {
        op: 'create_opening',
        args: { hostId: 'ghost-wall', typeId: SEED_IDS.door900, offset: 500 },
        result: 'x',
      },
      {
        op: 'create_wall',
        args: { levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [1000, 0] },
        result: 'y',
      },
    ];
    const result = applyOpLog(real, log);
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.entry.op).toBe('create_opening');
  });

  it('get_document(비변경 op)는 재생에서 무시', () => {
    const real = new DocStore();
    seedDocument(real);
    const result = applyOpLog(real, [{ op: 'get_document', args: {}, result: null }]);
    expect(result.applied).toBe(0);
  });
});

describe('opSummary', () => {
  it('모든 변경 op에 한글 요약 존재', () => {
    for (const tool of AI_TOOLS.filter((t) => t.mutating)) {
      const s = opSummary({ op: tool.name, args: {} });
      expect(s).toBeTruthy();
      expect(s).not.toBe(tool.name); // 폴백(op명 그대로)이 아닌 실제 요약
    }
  });
});
