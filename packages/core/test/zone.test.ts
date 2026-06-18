import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex, polygonArea, polygonCentroid } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';
import { elementFootprint } from '../src/select';
import type { ZoneElement } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

const RECT = [
  [0, 0],
  [4000, 0],
  [4000, 3000],
  [0, 3000],
] as [number, number][];

describe('존 — 생성/파생/면적', () => {
  it('createZone + deriveZone — 면적 라벨 12.0㎡', () => {
    const { store, seed } = setup();
    const id = store.createZone({ levelId: seed.levelId, boundary: RECT, name: '거실' });
    const cache = new DeriveCache();
    const geo = cache.derive(store, id, buildDeriveIndex(store));
    expect(geo).not.toBeNull();
    expect(geo!.labels?.[0]?.text).toBe('거실');
    expect(geo!.labels?.[1]?.text).toBe('12.0㎡'); // 4000×3000 = 12e6 mm² = 12㎡
    expect(geo!.edges.length).toBe(RECT.length * 6); // 경계 루프 (세그먼트당 6 float)
  });

  it('polygonArea / polygonCentroid', () => {
    expect(polygonArea(RECT)).toBeCloseTo(12_000_000);
    expect(polygonCentroid(RECT)).toEqual([2000, 1500]);
    // 와인딩 무관 (CW도 같은 면적)
    expect(polygonArea([...RECT].reverse())).toBeCloseTo(12_000_000);
  });
});

describe('존 — 편집 ops (silent if-chain)', () => {
  it('move/duplicate/rotate가 boundary에 적용', () => {
    const { store, seed } = setup();
    const id = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });

    store.moveElements([id], [1000, 500]);
    expect((store.getElement(id) as ZoneElement).boundary[0]).toEqual([1000, 500]);

    const [copyId] = store.duplicateElements([id], [0, 5000]);
    expect((store.getElement(copyId!) as ZoneElement).boundary[0]).toEqual([1000, 5500]);

    store.rotateElements([id], [1000, 500], Math.PI / 2);
    // (5000,500) 기준 회전 후 첫 점은 회전 중심 (1000,500) 그대로
    expect((store.getElement(id) as ZoneElement).boundary[0]).toEqual([1000, 500]);
  });

  it('updateElement name/height + boundary 양자화 + 자가교차 거부', () => {
    const { store, seed } = setup();
    const id = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    store.updateElement(id, { name: '침실', number: '101', height: 2800.6 });
    const z = store.getElement(id) as ZoneElement;
    expect(z.name).toBe('침실');
    expect(z.number).toBe('101');
    expect(z.height).toBe(2801);
    // 자가교차(나비형) → 무시(무변경)
    store.updateElement(id, { boundary: [[0, 0], [4000, 3000], [4000, 0], [0, 3000]] });
    expect((store.getElement(id) as ZoneElement).boundary[1]).toEqual([4000, 0]); // 거부됨
  });
});

describe('존 — lint/select/capability', () => {
  it('lint 클린 + 중복 감지', () => {
    const { store, seed } = setup();
    store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
    store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(1);
  });

  it('풋프린트 = 경계 폴리곤', () => {
    const { store, seed } = setup();
    const id = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    expect(elementFootprint(store.getElement(id)!, store)).toEqual({ kind: 'polygon', pts: RECT });
  });

  it('create_zone capability + float boundary 관용', () => {
    const { store, seed } = setup();
    const id = runCapability(store, 'create_zone', {
      levelId: seed.levelId,
      boundary: [[0.4, 0.4], [4000.6, 0], [4000, 3000], [0, 3000]],
      name: '주방',
    }) as string;
    const z = store.getElement(id) as ZoneElement;
    expect(z.boundary[0]).toEqual([0, 0]);
    expect(z.name).toBe('주방');
  });
});
