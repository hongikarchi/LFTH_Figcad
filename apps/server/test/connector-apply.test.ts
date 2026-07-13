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

describe('dedup=1 — 수직 파라미터 겹층 부재 (v0.4 리뷰: zOffset/baseOffset 키 폴드)', () => {
  it('같은 평면축 zOffset만 다른 보 2개 배치 — 둘 다 적용, 재푸시는 둘 다 dedup', async () => {
    const { store, seed } = setup();
    const base = store.listElements().length;
    const beam = (z: number) => ({
      op: 'create_beam',
      args: { levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0], zOffset: z },
    });
    const first = await apply(store, [beam(2700), beam(5700)], true);
    expect(first.json.applied).toBe(2); // 위층 보가 in-batch dedup으로 삭제되지 않음
    expect(first.json.deduped).toBe(0);
    expect(store.listElements().length).toBe(base + 2);

    const again = await apply(store, [beam(2700), beam(5700)], true); // 동일 배치 재푸시
    expect(again.json.applied).toBe(0);
    expect(again.json.deduped).toBe(2);
    expect(store.listElements().length).toBe(base + 2); // 중첩 0
  });

  it('같은 at, baseOffset만 다른 기둥 2개 — 둘 다 적용, 재푸시는 둘 다 dedup', async () => {
    const { store, seed } = setup();
    const base = store.listElements().length;
    const col = (baseOffset: number) => ({
      op: 'create_column',
      args: { levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 1000], height: 1500, baseOffset },
    });
    const first = await apply(store, [col(0), col(1500)], true);
    expect(first.json.applied).toBe(2);
    expect(first.json.deduped).toBe(0);
    expect(store.listElements().length).toBe(base + 2);

    const again = await apply(store, [col(0), col(1500)], true);
    expect(again.json.applied).toBe(0);
    expect(again.json.deduped).toBe(2);
    expect(store.listElements().length).toBe(base + 2);
  });
});

describe('dedup=1 — 절대 z 정규화 (레벨 구조화 M2)', () => {
  it('평탄 푸시(1층+오프셋) 후 층 구조화 재푸시(2층+0) = 전량 dedup, 중복 0', async () => {
    const { store, seed } = setup();
    const base = store.listElements().length;
    // 1차: 평탄 푸시 — 전부 1층, 절대 z를 오프셋으로 보존 (v0.6 커넥터 동작)
    const flat = [
      { op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [3000, 0], baseOffset: 3400 } },
      { op: 'create_column', args: { levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 1000], height: 3000, baseOffset: 3400 } },
      { op: 'create_slab', args: { levelId: seed.levelId, typeId: seed.slabTypeId, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], zOffset: 3400 } },
    ];
    const first = await apply(store, flat, true);
    expect(first.json.applied).toBe(3);
    expect(store.listElements().length).toBe(base + 3);

    // 커넥터 프로토콜: POST-A(레벨 생성)가 요소 옵과 별도 요청으로 선행
    const l2res = await apply(store, [{ op: 'add_level', args: { name: '2층', elevation: 3400, height: 3000, order: 1 } }], false);
    expect(l2res.json.applied).toBe(1);
    const l2 = store.listLevels().find((l) => l.name === '2층')!.id;

    // 2차: 층 구조화 재푸시 — 같은 절대 위치, 2층 기준 오프셋 0
    const structured = [
      { op: 'create_wall', args: { levelId: l2, typeId: seed.wallTypeIds[0], a: [0, 0], b: [3000, 0] } },
      { op: 'create_column', args: { levelId: l2, typeId: seed.columnTypeId, at: [1000, 1000], height: 3000 } },
      { op: 'create_slab', args: { levelId: l2, typeId: seed.slabTypeId, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] } },
    ];
    const second = await apply(store, structured, true);
    expect(second.json.applied).toBe(0);
    expect(second.json.deduped).toBe(3); // M2 핵심 — 전량 중복 차단
    expect(store.listElements().length).toBe(base + 3);
  });

  it('교체 배치 [create(신층)→delete(평탄)] — 순서 무관 프리패스 해제 = 데이터 소실 없음 (리뷰 실증)', async () => {
    const { store, seed } = setup();
    await apply(
      store,
      [{ op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [3000, 0], baseOffset: 3400 } }],
      true,
    );
    const flatId = store.listElements().find((e) => e.kind === 'wall')!.id;
    await apply(store, [{ op: 'add_level', args: { name: '2층', elevation: 3400, height: 3000, order: 1 } }], false);
    const l2 = store.listLevels().find((l) => l.name === '2층')!.id;
    // create가 delete보다 먼저 — 프리패스 해제 없으면 create가 dedup 스킵된 뒤 delete가 유일본 제거
    const res = await apply(
      store,
      [
        { op: 'create_wall', args: { levelId: l2, typeId: seed.wallTypeIds[0], a: [0, 0], b: [3000, 0] } },
        { op: 'delete_elements', args: { ids: [flatId] } },
      ],
      true,
    );
    expect(res.json.applied).toBe(2);
    const walls = store.listElements().filter((e) => e.kind === 'wall');
    expect(walls).toHaveLength(1); // 교체 성립 — 소실 없음
    expect((walls[0] as { levelId: string }).levelId).toBe(l2);
  });

  it('dedup=1 배치에 add_level 혼합 = 400 (프로토콜 가드 — POST-A 분리 강제)', async () => {
    const { store, seed } = setup();
    const res = await apply(
      store,
      [
        { op: 'add_level', args: { name: '2층', elevation: 3400, height: 3000, order: 1 } },
        { op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [3000, 0] } },
      ],
      true,
    );
    expect(res.res.status).toBe(400);
  });

  it('다른 절대 z(진짜 위층 신규 부재)는 dedup 안 됨', async () => {
    const { store, seed } = setup();
    await apply(store, [{ op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.wallTypeIds[0], a: [0, 0], b: [3000, 0] } }], true);
    await apply(store, [{ op: 'add_level', args: { name: '2층', elevation: 3400, height: 3000, order: 1 } }], false);
    const l2 = store.listLevels().find((l) => l.name === '2층')!.id;
    const upper = await apply(
      store,
      [{ op: 'create_wall', args: { levelId: l2, typeId: seed.wallTypeIds[0], a: [0, 0], b: [3000, 0] } }],
      true,
    );
    expect(upper.json.applied).toBe(1); // 절대 z 3400 ≠ 0
    expect(upper.json.deduped).toBe(0);
  });
});

describe('커넥터 create_type 배치 (v0.4 S1 — placeholder 리맵 + dedup 거동)', () => {
  const H = { shape: 'hsection', width: 150, depth: 300, web: 7, flange: 9 };
  const typeOp = { op: 'create_type', args: { kind: 'beam', name: 'H-300×150', section: H }, result: 'tmp-1' };
  const beamOp = (seed: ReturnType<typeof seedDocument>) => ({
    op: 'create_beam',
    args: { levelId: seed.levelId, typeId: 'tmp-1', a: [0, 0], b: [5000, 0] },
    result: 'tmp-2',
  });

  it('배치 [create_type(result:tmp), create_beam(typeId:tmp)] → 2 적용 + 요소가 실 typeId 참조', async () => {
    const { store, seed } = setup();
    const r = await apply(store, [typeOp, beamOp(seed)]);
    expect(r.json.applied).toBe(2);
    expect(r.json.failed).toHaveLength(0);
    const beam = store.listElements().find((e) => e.kind === 'beam') as { typeId: string } | undefined;
    expect(beam).toBeTruthy();
    expect(beam!.typeId).not.toBe('tmp-1'); // placeholder가 실 id로 치환됨
    const t = store.getType(beam!.typeId);
    expect(t?.kind).toBe('beam');
    expect(t?.name).toBe('H-300×150');
  });

  it('dedup=1 재푸시 — create_type은 재적용(문서화된 v1 거동: 타입 op은 content key 없음 → 항상 적용). 커넥터는 스냅샷 타입 매칭(2단계 POST)으로 create_type 자체를 안 보내는 게 계약', async () => {
    const { store, seed } = setup();
    const first = await apply(store, [typeOp, beamOp(seed)], true);
    expect(first.json.applied).toBe(2);
    const typesBefore = store.snapshot().types.length;

    const again = await apply(store, [typeOp, beamOp(seed)], true);
    // create_type: dedup 키 없음(createOpContentKey null) → 재적용 = 중복 타입 (v1 문서화 거동)
    expect(store.snapshot().types.length).toBe(typesBefore + 1);
    // create_beam(placeholder typeId): dedup 키가 리맵 *전* 계산이라 기존 요소(실 typeId)와 불일치 →
    // 역시 재적용 — 이것이 커넥터가 create_type을 dedup 없는 POST-B로 분리해야 하는 이유(plan Phase 3).
    expect(again.json.applied).toBe(2);
  });

  it('dedup=1 + 실 typeId 재푸시(2단계 POST 흐름) — create_beam은 deduped', async () => {
    const { store, seed } = setup();
    // POST-B: 타입만 (dedup 없음) → 실 id 획득
    const tRes = await apply(store, [typeOp]);
    expect(tRes.json.applied).toBe(1);
    const realTypeId = (tRes.json as unknown as { createdIds: string[] }).createdIds[0]!;
    // POST-C: 요소만 (dedup=1, 실 typeId)
    const el = { op: 'create_beam', args: { levelId: seed.levelId, typeId: realTypeId, a: [0, 0], b: [5000, 0] } };
    const c1 = await apply(store, [el], true);
    expect(c1.json.applied).toBe(1);
    expect(c1.json.deduped).toBe(0);
    // 재푸시 → 정확중첩 차단
    const c2 = await apply(store, [el], true);
    expect(c2.json.applied).toBe(0);
    expect(c2.json.deduped).toBe(1);
  });
});
