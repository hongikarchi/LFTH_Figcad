import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex, deriveRailing } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';
import { elementFootprint, footprintCrossesRect, footprintInRect } from '../src/select';
import type { RailingElement, RailingType } from '../src/schema';

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

describe('난간 — 생성/파생', () => {
  it('createRailing + 시드 타입으로 포스트+레일 솔리드 (외향 와인딩)', () => {
    const { store, seed } = setup();
    const id = store.createRailing({ levelId: seed.levelId, typeId: seed.railingTypeId, a: [0, 0], b: [3600, 0] });
    const cache = new DeriveCache();
    const geo = cache.derive(store, id, buildDeriveIndex(store));
    expect(geo).not.toBeNull();
    expect(geo!.positions.length).toBeGreaterThan(0);
    expect(signedVolume(geo!.positions)).toBeGreaterThan(0); // 핸디드니스
  });

  it('포스트 균등 분할 — 길이/간격 → 포스트 수 (부피로 검증)', () => {
    const level = { id: 'L', name: '1', elevation: 0, height: 3000, order: 0 };
    const type: RailingType = { id: 'T', kind: 'railing', name: 'r', height: 1000, postSpacing: 1000, color: '#fff' };
    // len=3000, spacing 목표 1000 → nGaps=3, 포스트 4개 + 레일
    const railing: RailingElement = { id: 'r1', kind: 'railing', levelId: 'L', typeId: 'T', a: [0, 0], b: [3000, 0] };
    const geo = deriveRailing({ railing, type, level });
    // 포스트 4 × (50×50×1000) + 레일 (60×50×3000) = 1.0e7 + 9.0e6 = 1.9e7 mm³ = 0.019 m³
    const posts = 4 * (0.05 * 0.05 * 1.0);
    const rail = 0.06 * 0.05 * 3.0;
    expect(signedVolume(geo.positions)).toBeCloseTo(posts + rail, 3);
    expect(geo.anchors.a[1]).toBeCloseTo(1.0); // 상부레일 윗면 = height
  });
});

describe('난간 — 편집 ops (silent if-chain)', () => {
  it('move/duplicate/rotate가 a/b에 적용됨', () => {
    const { store, seed } = setup();
    const id = store.createRailing({ levelId: seed.levelId, typeId: seed.railingTypeId, a: [0, 0], b: [3000, 0] });

    store.moveElements([id], [1000, 500]);
    let rl = store.getElement(id) as RailingElement;
    expect(rl.a).toEqual([1000, 500]);
    expect(rl.b).toEqual([4000, 500]);

    const [copyId] = store.duplicateElements([id], [0, 2000]);
    expect((store.getElement(copyId!) as RailingElement).a).toEqual([1000, 2500]);

    store.rotateElements([id], [1000, 500], Math.PI / 2);
    rl = store.getElement(id) as RailingElement;
    expect(rl.b).toEqual([1000, 3500]);
  });
});

describe('난간 — lint/select/capability', () => {
  it('lint 클린 + 중복 감지', () => {
    const { store, seed } = setup();
    store.createRailing({ levelId: seed.levelId, typeId: seed.railingTypeId, a: [0, 0], b: [3000, 0] });
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
    store.createRailing({ levelId: seed.levelId, typeId: seed.railingTypeId, a: [0, 0], b: [3000, 0] });
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(1);
  });

  it('풋프린트 = 세그먼트', () => {
    const { store, seed } = setup();
    const id = store.createRailing({ levelId: seed.levelId, typeId: seed.railingTypeId, a: [0, 0], b: [3000, 0] });
    const fp = elementFootprint(store.getElement(id)!, store);
    expect(fp).toEqual({ kind: 'segment', a: [0, 0], b: [3000, 0] });
    expect(footprintInRect(fp, { minX: -50, minY: -50, maxX: 3100, maxY: 50 })).toBe(true);
    expect(footprintCrossesRect(fp, { minX: -50, minY: -50, maxX: 1500, maxY: 50 })).toBe(true);
  });

  it('create_railing capability + float 관용', () => {
    const { store, seed } = setup();
    const id = runCapability(store, 'create_railing', {
      levelId: seed.levelId,
      typeId: seed.railingTypeId,
      a: [0.4, 0.4],
      b: [3000.6, 0.4],
    }) as string;
    const rl = store.getElement(id) as RailingElement;
    expect(rl.a).toEqual([0, 0]);
    expect(rl.b).toEqual([3001, 0]);
  });
});
