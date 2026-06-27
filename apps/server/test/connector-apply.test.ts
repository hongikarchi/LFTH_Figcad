import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '@figcad/core';
import { handleConnectorRequest } from '../src/handlers/apply';

const ROOM = 'demo';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

function wallOp(seed: ReturnType<typeof seedDocument>, b: [number, number] = [3000, 0]) {
  return { op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b } };
}

async function apply(store: DocStore, ops: unknown[], dedup = false) {
  const body = JSON.stringify({ ops });
  const u = `https://x/parties/doc/${ROOM}?op=apply${dedup ? '&dedup=1' : ''}`;
  const res = await handleConnectorRequest(
    new Request(u, { method: 'POST', body, headers: { 'content-length': String(body.length) } }),
    ROOM,
    store,
    async () => {},
    undefined,
  );
  return { res, json: (await res.json()) as { applied: number; failed: unknown[]; deduped?: number } };
}

describe('커넥터 ?op=apply 멱등화 (iter-2 2)', () => {
  it('dedup=1: 같은 벽 재푸시 = 0 적용 + deduped 1 (중첩 안 됨)', async () => {
    const { store, seed } = setup();
    const base = store.listElements().length;

    const a = await apply(store, [wallOp(seed)], true);
    expect(a.json.applied).toBe(1);
    expect(a.json.deduped).toBe(0);
    expect(store.listElements().length).toBe(base + 1);

    const b = await apply(store, [wallOp(seed)], true); // 동일 재푸시
    expect(b.json.applied).toBe(0);
    expect(b.json.deduped).toBe(1);
    expect(store.listElements().length).toBe(base + 1); // 중첩 0
  });

  it('dedup=1: 좌표 다르면(이동 후 푸시) 적용됨', async () => {
    const { store, seed } = setup();
    await apply(store, [wallOp(seed, [3000, 0])], true);
    const moved = await apply(store, [wallOp(seed, [4000, 0])], true);
    expect(moved.json.applied).toBe(1);
    expect(moved.json.deduped).toBe(0);
  });

  it('dedup 없으면 opt-out — 재푸시가 중첩(곡선 Push writeback 보존)', async () => {
    const { store, seed } = setup();
    const base = store.listElements().length;
    await apply(store, [wallOp(seed)], false);
    await apply(store, [wallOp(seed)], false);
    expect(store.listElements().length).toBe(base + 2); // 멱등 아님 = 2개
  });

  it('배치 내 중복도 첫 1개만', async () => {
    const { store, seed } = setup();
    const base = store.listElements().length;
    const r = await apply(store, [wallOp(seed), wallOp(seed), wallOp(seed)], true);
    expect(r.json.applied).toBe(1);
    expect(r.json.deduped).toBe(2);
    expect(store.listElements().length).toBe(base + 1);
  });

  it('connectorPush 누계 기록 (허브 표시용)', async () => {
    const { store, seed } = setup();
    await apply(store, [wallOp(seed)], true);
    await apply(store, [wallOp(seed)], true); // deduped
    const cp = store.getConnectorPush();
    expect(cp).toBeTruthy();
    expect(cp!.count).toBe(1); // 적용 누계
    expect(cp!.deduped).toBe(1);
    expect(typeof cp!.ts).toBe('number');
  });
});
