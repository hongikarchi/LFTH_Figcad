import { describe, expect, it } from 'vitest';
import {
  DocStore,
  seedDocument,
  SEED_IDS,
  elementFootprint,
  footprintCrossesRect,
  footprintInRect,
  pointInPolygon,
  pointInRect,
  rectFromPoints,
  segmentIntersectsRect,
  type Footprint,
} from '../src';

const RECT = rectFromPoints([0, 0], [1000, 1000]);
const seg = (a: [number, number], b: [number, number]): Footprint => ({ kind: 'segment', a, b });
const poly = (pts: [number, number][]): Footprint => ({ kind: 'polygon', pts });

describe('박스 판정 순수함수', () => {
  it('pointInRect', () => {
    expect(pointInRect([500, 500], RECT)).toBe(true);
    expect(pointInRect([0, 0], RECT)).toBe(true); // 경계 포함
    expect(pointInRect([1500, 500], RECT)).toBe(false);
  });

  it('pointInPolygon — 사각형', () => {
    const sq = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]] as [number, number][];
    expect(pointInPolygon([500, 500], sq)).toBe(true);
    expect(pointInPolygon([1500, 500], sq)).toBe(false);
  });

  it('segmentIntersectsRect — 안/교차/밖', () => {
    expect(segmentIntersectsRect([200, 200], [800, 800], RECT)).toBe(true); // 완전 안
    expect(segmentIntersectsRect([500, 500], [2000, 500], RECT)).toBe(true); // 한 끝 밖, 변 교차
    expect(segmentIntersectsRect([2000, 2000], [3000, 3000], RECT)).toBe(false); // 완전 밖
    expect(segmentIntersectsRect([-500, 500], [1500, 500], RECT)).toBe(true); // 가로지름
  });
});

describe('window(완전포함) vs crossing(닿음)', () => {
  it('완전히 안에 든 세그먼트 — 둘 다 선택', () => {
    const fp = seg([200, 200], [800, 800]);
    expect(footprintInRect(fp, RECT)).toBe(true);
    expect(footprintCrossesRect(fp, RECT)).toBe(true);
  });

  it('부분만 걸친 세그먼트 — crossing만 선택, window는 제외', () => {
    const fp = seg([500, 500], [2000, 500]);
    expect(footprintInRect(fp, RECT)).toBe(false); // 한 끝이 밖 → window 제외
    expect(footprintCrossesRect(fp, RECT)).toBe(true); // 변 교차 → crossing 선택
  });

  it('완전히 밖 — 둘 다 제외', () => {
    const fp = seg([2000, 2000], [3000, 2000]);
    expect(footprintInRect(fp, RECT)).toBe(false);
    expect(footprintCrossesRect(fp, RECT)).toBe(false);
  });

  it('폴리곤이 박스를 가로지름 — crossing 선택', () => {
    const fp = poly([[-500, 400], [1500, 400], [1500, 600], [-500, 600]]);
    expect(footprintCrossesRect(fp, RECT)).toBe(true);
    expect(footprintInRect(fp, RECT)).toBe(false); // 꼭짓점이 밖
  });
});

describe('elementFootprint', () => {
  function room(): DocStore {
    const s = new DocStore();
    seedDocument(s);
    return s;
  }

  it('벽 = 중심선 세그먼트', () => {
    const s = room();
    const id = s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const fp = elementFootprint(s.getElement(id)!, s);
    expect(fp).toEqual({ kind: 'segment', a: [0, 0], b: [4000, 0] });
  });

  it('슬라브 = 경계 폴리곤', () => {
    const s = room();
    const id = s.createSlab({ levelId: SEED_IDS.level, typeId: SEED_IDS.slab150, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
    const fp = elementFootprint(s.getElement(id)!, s);
    expect(fp?.kind).toBe('polygon');
  });

  it('개구부 = 호스트 위 중심점', () => {
    const s = room();
    const w = s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const o = s.createOpening({ hostId: w, typeId: SEED_IDS.door900, offset: 2000 });
    const fp = elementFootprint(s.getElement(o)!, s);
    expect(fp).toEqual({ kind: 'point', p: [2000, 0] });
  });

  it('window/crossing 통합 — 방 일부만 덮는 박스', () => {
    const s = room();
    const L = SEED_IDS.level;
    const T = SEED_IDS.wall200;
    // 4000x3000 방
    const south = s.createWall({ levelId: L, typeId: T, a: [0, 0], b: [4000, 0] });
    const east = s.createWall({ levelId: L, typeId: T, a: [4000, 0], b: [4000, 3000] });
    s.createWall({ levelId: L, typeId: T, a: [4000, 3000], b: [0, 3000] });
    s.createWall({ levelId: L, typeId: T, a: [0, 3000], b: [0, 0] });
    // 박스 [-100,-100]~[4100,1500] — 남벽 완전포함, 동/서벽 부분, 북벽 제외
    const box = rectFromPoints([-100, -100], [4100, 1500]);
    const fpOf = (id: string) => elementFootprint(s.getElement(id)!, s);
    expect(footprintInRect(fpOf(south), box)).toBe(true); // 남벽 완전 안
    expect(footprintInRect(fpOf(east), box)).toBe(false); // 동벽 위 끝 밖
    expect(footprintCrossesRect(fpOf(east), box)).toBe(true); // 동벽 걸침
  });
});
