import { describe, expect, it } from 'vitest';
import { snapPoint } from '../src/snap';

describe('snapPoint', () => {
  it('끝점 스냅이 최우선', () => {
    const r = snapPoint([1980, 30], {
      endpoints: [[2000, 0]],
      endpointTolerance: 100,
      grid: 100,
    });
    expect(r.kind).toBe('endpoint');
    expect(r.point).toEqual([2000, 0]);
  });

  it('그리드 스냅 (100mm)', () => {
    const r = snapPoint([1234, 567], { endpoints: [], endpointTolerance: 100, grid: 100 });
    expect(r.kind).toBe('grid');
    expect(r.point).toEqual([1200, 600]);
  });

  it('축 고정 — 7도 이내 수평이면 Y 클램프', () => {
    const r = snapPoint([3000, 80], {
      endpoints: [],
      endpointTolerance: 100,
      grid: 100,
      axisFrom: [0, 0],
    });
    expect(r.axisLocked).toBe(true);
    expect(r.point[1]).toBe(0);
  });

  it('축 고정 — 수직 클램프', () => {
    const r = snapPoint([-60, 2500], {
      endpoints: [],
      endpointTolerance: 100,
      grid: 100,
      axisFrom: [0, 0],
    });
    expect(r.axisLocked).toBe(true);
    expect(r.point[0]).toBe(0);
  });

  it('45도 방향은 축 고정 안 됨', () => {
    const r = snapPoint([2000, 2000], {
      endpoints: [],
      endpointTolerance: 100,
      grid: 100,
      axisFrom: [0, 0],
    });
    expect(r.axisLocked).toBe(false);
  });
});
