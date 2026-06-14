import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';
import { elementFootprint } from '../src/select';
import type { CurtainWallElement } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

function signedVolume(positions: Float32Array): number {
  let v = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az] = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
    const [bx, by, bz] = [positions[i + 3]!, positions[i + 4]!, positions[i + 5]!];
    const [cx, cy, cz] = [positions[i + 6]!, positions[i + 7]!, positions[i + 8]!];
    v += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by)) / 6;
  }
  return v;
}

describe('커튼월 — 생성/파생', () => {
  it('createCurtainWall + 멀리언 그리드 솔리드 파생 (외향 와인딩)', () => {
    const { store, seed } = setup();
    const id = store.createCurtainWall({
      levelId: seed.levelId,
      typeId: seed.curtainWallTypeId,
      a: [0, 0],
      b: [6000, 0],
      uSpacing: 1500,
      vSpacing: 1500,
    });
    const cache = new DeriveCache();
    const geo = cache.derive(store, id, buildDeriveIndex(store));
    expect(geo).not.toBeNull();
    expect(geo!.positions.length).toBeGreaterThan(0);
    expect(signedVolume(geo!.positions)).toBeGreaterThan(0); // inside-out이면 음수
  });

  it('유리 패널 파생 — 그리드 셀마다 쿼드 (panels 메시)', () => {
    const { store, seed } = setup();
    // 6000×3000(층고) ÷ 1500 = u 4셀 × v 2셀 = 8패널 → 6 정점/패널(쿼드 2삼각)
    const id = store.createCurtainWall({
      levelId: seed.levelId,
      typeId: seed.curtainWallTypeId,
      a: [0, 0],
      b: [6000, 0],
      uSpacing: 1500,
      vSpacing: 1500,
    });
    const geo = new DeriveCache().derive(store, id, buildDeriveIndex(store));
    expect(geo!.panels).toBeDefined();
    expect(geo!.panels!.positions.length).toBeGreaterThan(0);
    expect(geo!.panels!.positions.length % 9).toBe(0); // 삼각형 단위
  });

  it('seed 커튼월 타입 존재 (mullionSection)', () => {
    const { store, seed } = setup();
    const t = store.getType(seed.curtainWallTypeId);
    expect(t?.kind).toBe('curtainwall');
  });
});

describe('커튼월 — 편집 ops (silent if-chain)', () => {
  it('move/duplicate/rotate가 a/b에 적용 + uSpacing 양자화', () => {
    const { store, seed } = setup();
    const id = store.createCurtainWall({
      levelId: seed.levelId,
      typeId: seed.curtainWallTypeId,
      a: [0, 0],
      b: [6000, 0],
      uSpacing: 1500.6,
      vSpacing: 1500,
    });
    expect((store.getElement(id) as CurtainWallElement).uSpacing).toBe(1501);

    store.moveElements([id], [1000, 500]);
    const cw = store.getElement(id) as CurtainWallElement;
    expect(cw.a).toEqual([1000, 500]);
    expect(cw.b).toEqual([7000, 500]);

    const [copyId] = store.duplicateElements([id], [0, 2000]);
    expect((store.getElement(copyId!) as CurtainWallElement).a).toEqual([1000, 2500]);

    store.rotateElements([id], [1000, 500], Math.PI / 2);
    expect((store.getElement(id) as CurtainWallElement).b).toEqual([1000, 6500]); // (7000,500) 90°CCW
  });

  it('updateElement uSpacing/vSpacing/height + 0길이 거부', () => {
    const { store, seed } = setup();
    const id = store.createCurtainWall({
      levelId: seed.levelId,
      typeId: seed.curtainWallTypeId,
      a: [0, 0],
      b: [6000, 0],
      uSpacing: 1500,
      vSpacing: 1500,
    });
    store.updateElement(id, { uSpacing: 1000, vSpacing: 1200, height: 3500 });
    const cw = store.getElement(id) as CurtainWallElement;
    expect([cw.uSpacing, cw.vSpacing, cw.height]).toEqual([1000, 1200, 3500]);
    store.updateElement(id, { b: [0, 0] });
    expect((store.getElement(id) as CurtainWallElement).b).toEqual([6000, 0]); // 0길이 거부
  });
});

describe('커튼월 — lint/select/capability', () => {
  it('lint 클린 + 중복 감지', () => {
    const { store, seed } = setup();
    const p = { levelId: seed.levelId, typeId: seed.curtainWallTypeId, a: [0, 0] as [number, number], b: [6000, 0] as [number, number], uSpacing: 1500, vSpacing: 1500 };
    store.createCurtainWall(p);
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
    store.createCurtainWall(p);
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(1);
  });

  it('풋프린트 = 베이스라인 세그먼트', () => {
    const { store, seed } = setup();
    const id = store.createCurtainWall({ levelId: seed.levelId, typeId: seed.curtainWallTypeId, a: [0, 0], b: [6000, 0], uSpacing: 1500, vSpacing: 1500 });
    expect(elementFootprint(store.getElement(id)!, store)).toEqual({ kind: 'segment', a: [0, 0], b: [6000, 0] });
  });

  it('create_curtainwall capability + float 관용', () => {
    const { store, seed } = setup();
    const id = runCapability(store, 'create_curtainwall', {
      levelId: seed.levelId,
      typeId: seed.curtainWallTypeId,
      a: [0.4, 0.4],
      b: [6000.6, 0.4],
      uSpacing: 1500,
      vSpacing: 1500,
    }) as string;
    const cw = store.getElement(id) as CurtainWallElement;
    expect(cw.a).toEqual([0, 0]);
    expect(cw.b).toEqual([6001, 0]);
  });
});
