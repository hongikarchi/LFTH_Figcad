import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex, deriveRoof } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';
import { elementFootprint, footprintInRect } from '../src/select';
import type { RoofElement, RoofType, Level } from '../src/schema';

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

const RECT: [number, number][] = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]];
const level: Level = { id: 'L', name: '1층', elevation: 0, height: 3000, order: 0 };
const type: RoofType = { id: 'T', kind: 'roof', name: 'r', thickness: 200, color: '#fff' };

describe('지붕 — 생성/파생', () => {
  it('평지붕 — 벽 위(elevation+height)에 두께, 체적=면적×두께', () => {
    const roof: RoofElement = { id: 'R', kind: 'roof', levelId: 'L', typeId: 'T', boundary: RECT };
    const geo = deriveRoof({ roof, type, level });
    expect(Math.abs(signedVolume(geo.positions))).toBeCloseTo(4 * 3 * 0.2, 3); // 2.4 m³
    // 하단 = 3000(벽 위), 상단 = 3200
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < geo.positions.length; i += 3) {
      minY = Math.min(minY, geo.positions[i]!);
      maxY = Math.max(maxY, geo.positions[i]!);
    }
    expect(minY).toBeCloseTo(3.0, 5);
    expect(maxY).toBeCloseTo(3.2, 5);
    expect(geo.anchors.a[1]).toBeCloseTo(3.2); // p0 상면
  });

  it('단경사 — dir 방향으로 상승, 체적 보존(수직 두께)', () => {
    const roof: RoofElement = {
      id: 'R', kind: 'roof', levelId: 'L', typeId: 'T', boundary: RECT,
      slope: { dir: [1, 0], pitch: 200 }, // +x로 1000당 200 상승
    };
    const geo = deriveRoof({ roof, type, level });
    // 체적은 평면적×수직두께 = 2.4 그대로
    expect(Math.abs(signedVolume(geo.positions))).toBeCloseTo(2.4, 3);
    // x=0 하단 3000, x=4000 하단 3000+0.2*4000=3800 → 상면 최대 4000
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < geo.positions.length; i += 3) {
      minY = Math.min(minY, geo.positions[i]!);
      maxY = Math.max(maxY, geo.positions[i]!);
    }
    expect(minY).toBeCloseTo(3.0, 5); // x=0 하단
    expect(maxY).toBeCloseTo(4.0, 5); // x=4000 상면 = 3800+200
  });

  it('CW 입력 경계도 inside-out 안 됨 (enforceWinding)', () => {
    const cw: [number, number][] = [...RECT].reverse();
    const roof: RoofElement = { id: 'R', kind: 'roof', levelId: 'L', typeId: 'T', boundary: cw };
    const geo = deriveRoof({ roof, type, level });
    expect(Math.abs(signedVolume(geo.positions))).toBeCloseTo(2.4, 3);
  });
});

describe('지붕 — 편집 ops (silent if-chain)', () => {
  it('move/rotate가 boundary에 적용 (slab 분기, a/b 아님)', () => {
    const { store, seed } = setup();
    const id = store.createRoof({ levelId: seed.levelId, typeId: seed.roofTypeId, boundary: RECT });
    store.moveElements([id], [1000, 500]);
    const roof = store.getElement(id) as RoofElement;
    expect(roof.boundary[0]).toEqual([1000, 500]);
    expect(roof.boundary[1]).toEqual([5000, 500]);
  });

  it('경사 지붕 회전 시 slope.dir도 회전', () => {
    const { store, seed } = setup();
    const id = store.createRoof({
      levelId: seed.levelId, typeId: seed.roofTypeId, boundary: RECT,
      slope: { dir: [1000, 0], pitch: 200 },
    });
    store.rotateElements([id], [0, 0], Math.PI / 2); // +x → +y
    const roof = store.getElement(id) as RoofElement;
    expect(roof.slope!.dir[0]).toBeCloseTo(0, 0);
    expect(roof.slope!.dir[1]).toBeCloseTo(1000, 0);
    expect(roof.slope!.pitch).toBe(200);
  });

  it('경사 지붕 복사 시 slope.dir 보존 (평행이동 불변)', () => {
    const { store, seed } = setup();
    const id = store.createRoof({
      levelId: seed.levelId, typeId: seed.roofTypeId, boundary: RECT,
      slope: { dir: [1000, 0], pitch: 200 },
    });
    const [copyId] = store.duplicateElements([id], [5000, 0]);
    const copy = store.getElement(copyId!) as RoofElement;
    expect(copy.slope!.dir).toEqual([1000, 0]);
  });
});

describe('지붕 — lint/select/capability', () => {
  it('lint 클린 + 중복 감지', () => {
    const { store, seed } = setup();
    store.createRoof({ levelId: seed.levelId, typeId: seed.roofTypeId, boundary: RECT });
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
    store.createRoof({ levelId: seed.levelId, typeId: seed.roofTypeId, boundary: RECT });
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(1);
  });

  it('풋프린트 = 경계 폴리곤', () => {
    const { store, seed } = setup();
    const id = store.createRoof({ levelId: seed.levelId, typeId: seed.roofTypeId, boundary: RECT });
    const fp = elementFootprint(store.getElement(id)!, store);
    expect(fp).toEqual({ kind: 'polygon', pts: RECT });
    expect(footprintInRect(fp, { minX: -100, minY: -100, maxX: 4100, maxY: 3100 })).toBe(true);
  });

  it('create_roof capability + 경사 + float 관용', () => {
    const { store, seed } = setup();
    const id = runCapability(store, 'create_roof', {
      levelId: seed.levelId,
      typeId: seed.roofTypeId,
      boundary: [[0.4, 0.4], [4000.6, 0.4], [4000.6, 3000.4], [0.4, 3000.4]],
      slope: { dir: [1, 0], pitch: 150 },
    }) as string;
    const roof = store.getElement(id) as RoofElement;
    expect(roof.boundary[0]).toEqual([0, 0]);
    expect(roof.boundary[1]).toEqual([4001, 0]);
    expect(roof.slope).toEqual({ dir: [1, 0], pitch: 150 });
  });
});
