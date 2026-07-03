import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex, deriveStair } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';
import { elementFootprint, footprintCrossesRect, footprintInRect } from '../src/select';
import type { StairElement, StairType } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

/** non-indexed 메시 부호 부피 — 외향 와인딩이면 양수 (핸디드니스 검증) */
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

/** 최상단(centroid Y 최대) 삼각형의 법선 Y — 최상면은 반드시 위(+Y) 향함.
 *  닫힌 솔리드는 max(ny)>0.9가 inside-out도 통과하므로 이 검사로 핸디드니스 확정. */
function topFaceNormalY(positions: Float32Array, normals: Float32Array): number {
  let bestY = -Infinity;
  let bestNy = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const cy = (positions[i + 1]! + positions[i + 4]! + positions[i + 7]!) / 3;
    if (cy > bestY) {
      bestY = cy;
      bestNy = (normals[i + 1]! + normals[i + 4]! + normals[i + 7]!) / 3;
    }
  }
  return bestNy;
}

describe('계단 — 생성/파생', () => {
  it('createStair + 시드 타입으로 솔리드 파생 (체적 = 실루엣 면적×폭)', () => {
    const { store, seed } = setup();
    const id = store.createStair({ levelId: seed.levelId, typeId: seed.stairTypeId, a: [0, 0], b: [3000, 0] });
    const cache = new DeriveCache();
    const geo = cache.derive(store, id, buildDeriveIndex(store));
    expect(geo).not.toBeNull();
    expect(geo!.positions.length).toBeGreaterThan(0);

    // run=3000, width=1000, 총상승=level.height=3000, riser=175 → n=round(3000/175)=17
    // waist-슬랩 밑면: 톱니 아래 통짜 웨지에서 밑면 경사선(노징 평행, ⊥두께 waist) 아래 삼각 영역 제거
    const run = 3000, width = 1000, totalRise = 3000;
    const n = Math.round(totalRise / 175);
    const waist = Math.max(150, 175);
    const waistV = (waist * Math.hypot(run, totalRise)) / run;
    const x0 = (waistV * run) / totalRise;
    const removedMm2 = 0.5 * (run - x0) * (totalRise - waistV);
    const silhouetteMm2 = (run * totalRise * (n + 1)) / (2 * n) - removedMm2;
    const expectedM3 = silhouetteMm2 * 1e-6 * (width * 0.001);
    expect(signedVolume(geo!.positions)).toBeCloseTo(expectedM3, 2);
  });

  it('핸디드니스 — 최상단 디딤판 법선이 위(+Y), 외향 와인딩(부피>0)', () => {
    const { store, seed } = setup();
    const id = store.createStair({ levelId: seed.levelId, typeId: seed.stairTypeId, a: [0, 0], b: [3000, 0] });
    const cache = new DeriveCache();
    const geo = cache.derive(store, id, buildDeriveIndex(store))!;
    expect(topFaceNormalY(geo.positions, geo.normals)).toBeGreaterThan(0.9); // inside-out이면 −Y
    expect(signedVolume(geo.positions)).toBeGreaterThan(0);
  });

  it('앵커 — a=하단 바닥, b=상단(총상승)', () => {
    const level = { id: 'L', name: '1', elevation: 0, height: 3000, order: 0 };
    const type: StairType = { id: 'T', kind: 'stair', name: 's', width: 1000, riser: 175, color: '#fff' };
    const stair: StairElement = { id: 's1', kind: 'stair', levelId: 'L', typeId: 'T', a: [0, 0], b: [3000, 0] };
    const geo = deriveStair({ stair, type, level });
    expect(geo.anchors.a[1]).toBeCloseTo(0);
    expect(geo.anchors.b[1]).toBeCloseTo(3.0); // 총상승 = 3000mm
  });
});

describe('계단 — 편집 ops (silent if-chain)', () => {
  it('move/duplicate/rotate가 a/b에 적용됨', () => {
    const { store, seed } = setup();
    const id = store.createStair({ levelId: seed.levelId, typeId: seed.stairTypeId, a: [0, 0], b: [3000, 0] });

    store.moveElements([id], [1000, 500]);
    let st = store.getElement(id) as StairElement;
    expect(st.a).toEqual([1000, 500]);
    expect(st.b).toEqual([4000, 500]);

    const [copyId] = store.duplicateElements([id], [0, 2000]);
    expect((store.getElement(copyId!) as StairElement).a).toEqual([1000, 2500]);

    store.rotateElements([id], [1000, 500], Math.PI / 2);
    st = store.getElement(id) as StairElement;
    expect(st.a).toEqual([1000, 500]);
    expect(st.b).toEqual([1000, 3500]); // (4000,500) 90°CCW around (1000,500)
  });

  it('updateElement float a/b 양자화 + 0길이 거부', () => {
    const { store, seed } = setup();
    const id = store.createStair({ levelId: seed.levelId, typeId: seed.stairTypeId, a: [0, 0], b: [3000, 0] });
    store.updateElement(id, { a: [10.4, 20.6] });
    expect((store.getElement(id) as StairElement).a).toEqual([10, 21]);
    store.updateElement(id, { b: [10, 21] });
    expect((store.getElement(id) as StairElement).b).toEqual([3000, 0]); // 0길이 거부
  });
});

describe('계단 — lint/select/capability', () => {
  it('lint 클린 + 중복 감지', () => {
    const { store, seed } = setup();
    store.createStair({ levelId: seed.levelId, typeId: seed.stairTypeId, a: [0, 0], b: [3000, 0] });
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
    store.createStair({ levelId: seed.levelId, typeId: seed.stairTypeId, a: [0, 0], b: [3000, 0] });
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(1);
  });

  it('풋프린트 = 주행 세그먼트', () => {
    const { store, seed } = setup();
    const id = store.createStair({ levelId: seed.levelId, typeId: seed.stairTypeId, a: [0, 0], b: [3000, 0] });
    const fp = elementFootprint(store.getElement(id)!, store);
    expect(fp).toEqual({ kind: 'segment', a: [0, 0], b: [3000, 0] });
    expect(footprintInRect(fp, { minX: -100, minY: -100, maxX: 3100, maxY: 100 })).toBe(true);
    expect(footprintCrossesRect(fp, { minX: -100, minY: -100, maxX: 1500, maxY: 100 })).toBe(true);
  });

  it('create_stair capability + float 관용', () => {
    const { store, seed } = setup();
    const id = runCapability(store, 'create_stair', {
      levelId: seed.levelId,
      typeId: seed.stairTypeId,
      a: [0.4, 0.4],
      b: [3000.6, 0.4],
    }) as string;
    const st = store.getElement(id) as StairElement;
    expect(st.a).toEqual([0, 0]);
    expect(st.b).toEqual([3001, 0]);
  });
});
