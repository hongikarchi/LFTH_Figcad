import { describe, expect, it } from 'vitest';
import {
  computeFlatNormals,
  deriveWall,
  enforceWinding,
  extrudeProfile,
  wallDeriveKey,
} from '../src/geometry';
import type { Level, WallElement, WallType } from '../src/schema';

const level: Level = { id: 'L1', name: '1층', elevation: 0, height: 3000, order: 0 };
const type: WallType = { id: 'T1', kind: 'wall', name: '벽200', thickness: 200, color: '#fff' };
const wall = (a: [number, number], b: [number, number], height?: number): WallElement => ({
  id: 'W1',
  kind: 'wall',
  levelId: 'L1',
  typeId: 'T1',
  a,
  b,
  ...(height !== undefined ? { height } : {}),
});

describe('enforceWinding', () => {
  it('외곽을 CCW로, 구멍을 CW로 보정한다', () => {
    const fixed = enforceWinding({
      outer: [
        [0, 0],
        [0, 10],
        [10, 10],
        [10, 0],
      ], // CW 입력
      holes: [
        [
          [2, 2],
          [8, 2],
          [8, 8],
          [2, 8],
        ], // CCW 입력
      ],
    });
    // 외곽 signed area > 0 (CCW)
    const area = (ring: [number, number][]) =>
      ring.reduce((acc, [x1, y1], i) => {
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        return acc + (x1 * y2 - x2 * y1);
      }, 0) / 2;
    expect(area(fixed.outer)).toBeGreaterThan(0);
    expect(area(fixed.holes[0]!)).toBeLessThan(0);
  });
});

describe('extrudeProfile', () => {
  it('사각형 프로필 → 12 삼각형 (앞2+뒤2+측면8)', () => {
    const mesh = extrudeProfile(
      {
        outer: [
          [0, 0],
          [4, 0],
          [4, 2],
          [0, 2],
        ],
        holes: [],
      },
      1,
      (u, v, w) => [u, v, w],
    );
    expect(mesh.positions.length).toBe(12 * 9);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    // 엣지: 정점 4개 × 3선분(앞/뒤/커넥터)
    expect(mesh.edges.length).toBe(4 * 3 * 6);
  });

  it('구멍 있는 프로필 — 구멍 측면이 생성되고 부피가 줄어든다', () => {
    const solid = extrudeProfile(
      {
        outer: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        holes: [],
      },
      1,
      (u, v, w) => [u, v, w],
    );
    const withHole = extrudeProfile(
      {
        outer: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        holes: [
          [
            [3, 3],
            [7, 3],
            [7, 7],
            [3, 7],
          ],
        ],
      },
      1,
      (u, v, w) => [u, v, w],
    );
    // 구멍이 있으면 측면(구멍 내벽) 삼각형이 추가된다
    expect(withHole.positions.length).toBeGreaterThan(solid.positions.length);
  });

  it('법선은 단위 벡터', () => {
    const mesh = extrudeProfile(
      {
        outer: [
          [0, 0],
          [4, 0],
          [4, 2],
          [0, 2],
        ],
        holes: [],
      },
      1,
      (u, v, w) => [u, v, w],
    );
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const len = Math.hypot(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('앞면 법선 +w, 뒷면 법선 -w (와인딩 검증)', () => {
    const mesh = extrudeProfile(
      {
        outer: [
          [0, 0],
          [4, 0],
          [4, 2],
          [0, 2],
        ],
        holes: [],
      },
      1,
      (u, v, w) => [u, v, w],
    );
    // 첫 삼각형 = 앞면 (w=+0.5)
    expect(mesh.normals[2]).toBeCloseTo(1, 5);
    // 앞면 2개 다음 = 뒷면
    const backStart = 2 * 9;
    expect(mesh.normals[backStart + 2]).toBeCloseTo(-1, 5);
  });
});

describe('deriveWall', () => {
  it('X축 방향 4m 벽 — bbox가 길이/높이/두께와 일치 (m)', () => {
    const geo = deriveWall({ wall: wall([0, 0], [4000, 0]), type, level });
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < geo.positions.length; i += 3) {
      minX = Math.min(minX, geo.positions[i]!);
      maxX = Math.max(maxX, geo.positions[i]!);
      minY = Math.min(minY, geo.positions[i + 1]!);
      maxY = Math.max(maxY, geo.positions[i + 1]!);
      minZ = Math.min(minZ, geo.positions[i + 2]!);
      maxZ = Math.max(maxZ, geo.positions[i + 2]!);
    }
    expect(maxX - minX).toBeCloseTo(4, 5); // 길이 4m
    expect(maxY - minY).toBeCloseTo(3, 5); // 층고 3m (level.height)
    expect(maxZ - minZ).toBeCloseTo(0.2, 5); // 두께 0.2m
    expect(minY).toBeCloseTo(0, 5);
  });

  it('height 오버라이드 적용', () => {
    const geo = deriveWall({ wall: wall([0, 0], [4000, 0], 2400), type, level });
    let maxY = -Infinity;
    for (let i = 1; i < geo.positions.length; i += 3) {
      maxY = Math.max(maxY, geo.positions[i]!);
    }
    expect(maxY).toBeCloseTo(2.4, 5);
  });

  it('대각선 벽 — 앵커가 중심선 양 끝 (m)', () => {
    const geo = deriveWall({ wall: wall([1000, 1000], [4000, 5000]), type, level });
    expect(geo.anchors.a).toEqual([1, 0, 1]);
    expect(geo.anchors.b).toEqual([4, 0, 5]);
  });

  it('파생 키 — 같은 입력 = 같은 키, 파라미터 변경 = 다른 키', () => {
    const i1 = { wall: wall([0, 0], [4000, 0]), type, level };
    const i2 = { wall: wall([0, 0], [4000, 0]), type, level };
    const i3 = { wall: wall([0, 0], [4001, 0]), type, level };
    expect(wallDeriveKey(i1)).toBe(wallDeriveKey(i2));
    expect(wallDeriveKey(i1)).not.toBe(wallDeriveKey(i3));
  });
});

describe('computeFlatNormals', () => {
  it('XY 평면 CCW 삼각형 → +Z 법선', () => {
    const n = computeFlatNormals(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(n[2]).toBeCloseTo(1, 6);
  });
});
