import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex, deriveBeam } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';
import { elementFootprint, footprintCrossesRect, footprintInRect } from '../src/select';
import type { BeamElement, BeamType } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

/** non-indexed 메시 부호 부피 */
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

describe('보 — 생성/파생', () => {
  it('createBeam + 시드 타입으로 솔리드 파생 (체적 = L×width×depth)', () => {
    const { store, seed } = setup();
    const id = store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0] });
    const cache = new DeriveCache();
    const geo = cache.derive(store, id, buildDeriveIndex(store));
    expect(geo).not.toBeNull();
    expect(geo!.positions.length).toBeGreaterThan(0);
    // 5000 × 300 × 600 (mm) = 0.9㎥ (m 단위)
    expect(Math.abs(signedVolume(geo!.positions))).toBeCloseTo(5.0 * 0.3 * 0.6, 3);
  });

  it('기본 zOffset = 상단을 천장에 맞춤 (axisZ = height - depth/2)', () => {
    const level = { id: 'L', name: '1', elevation: 0, height: 3000, order: 0 };
    const type: BeamType = { id: 'T', kind: 'beam', name: 'b', section: { shape: 'rect', width: 300, depth: 600 }, color: '#fff' };
    const beam: BeamElement = { id: 'b1', kind: 'beam', levelId: 'L', typeId: 'T', a: [0, 0], b: [4000, 0] };
    const geo = deriveBeam({ beam, type, level });
    // 중심축 = 3000 - 300 = 2700mm = 2.7m
    expect(geo.anchors.a[1]).toBeCloseTo(2.7);
    expect(geo.anchors.b[1]).toBeCloseTo(2.7);
    // zOffset 명시 시 그대로
    const geo2 = deriveBeam({ beam: { ...beam, zOffset: 1500 }, type, level });
    expect(geo2.anchors.a[1]).toBeCloseTo(1.5);
  });
});

describe('보 — 편집 ops (silent if-chain)', () => {
  it('move/duplicate/rotate가 a/b에 적용됨', () => {
    const { store, seed } = setup();
    const id = store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [4000, 0] });

    store.moveElements([id], [1000, 500]);
    let beam = store.getElement(id) as BeamElement;
    expect(beam.a).toEqual([1000, 500]);
    expect(beam.b).toEqual([5000, 500]);

    const [copyId] = store.duplicateElements([id], [0, 2000]);
    const copy = store.getElement(copyId!) as BeamElement;
    expect(copy.a).toEqual([1000, 2500]);

    store.rotateElements([id], [1000, 500], Math.PI / 2); // a 고정, b 회전
    beam = store.getElement(id) as BeamElement;
    expect(beam.a).toEqual([1000, 500]);
    expect(beam.b).toEqual([1000, 4500]); // (5000,500) 90°CCW around (1000,500)
  });

  it('updateElement가 float a/b/zOffset 양자화 + 0길이 거부', () => {
    const { store, seed } = setup();
    const id = store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [4000, 0] });
    store.updateElement(id, { a: [10.4, 20.6], zOffset: 1499.5 });
    const beam = store.getElement(id) as BeamElement;
    expect(beam.a).toEqual([10, 21]);
    expect(beam.zOffset).toBe(1500);
    // 0길이로 만들면 무시 (b를 a와 같게)
    store.updateElement(id, { b: [10, 21] });
    expect((store.getElement(id) as BeamElement).b).toEqual([4000, 0]); // 변경 거부
  });
});

describe('보 — lint/select/capability', () => {
  it('lint 클린 + 중복 감지', () => {
    const { store, seed } = setup();
    store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [4000, 0] });
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
    store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [4000, 0] });
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(1);
  });

  it('풋프린트 = 중심축 세그먼트', () => {
    const { store, seed } = setup();
    const id = store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [4000, 0] });
    const fp = elementFootprint(store.getElement(id)!, store);
    expect(fp).toEqual({ kind: 'segment', a: [0, 0], b: [4000, 0] });
    // 완전포함(window) vs 닿음(crossing)
    expect(footprintInRect(fp, { minX: -100, minY: -100, maxX: 5000, maxY: 100 })).toBe(true);
    expect(footprintInRect(fp, { minX: -100, minY: -100, maxX: 2000, maxY: 100 })).toBe(false);
    expect(footprintCrossesRect(fp, { minX: -100, minY: -100, maxX: 2000, maxY: 100 })).toBe(true);
  });

  it('create_beam capability + float 관용', () => {
    const { store, seed } = setup();
    const id = runCapability(store, 'create_beam', {
      levelId: seed.levelId,
      typeId: seed.beamTypeId,
      a: [0.4, 0.4],
      b: [4000.6, 0.4],
    }) as string;
    const beam = store.getElement(id) as BeamElement;
    expect(beam.a).toEqual([0, 0]);
    expect(beam.b).toEqual([4001, 0]);
  });
});
