import { describe, expect, it } from 'vitest';
import { arcPolyline, deriveWall, wallFootprint, wallDeriveKey, curvedWallFootprint } from '../src/geometry';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';
import { lint } from '../src/lint';
import type { Level, WallElement, WallType, Pt } from '../src/schema';

const level: Level = { id: 'L1', name: '1층', elevation: 0, height: 3000, order: 0 };
const type: WallType = { id: 'T1', kind: 'wall', name: '벽200', thickness: 200, color: '#fff' };
const wall = (a: Pt, b: Pt, sagitta?: number): WallElement => ({
  id: 'W1',
  kind: 'wall',
  levelId: 'L1',
  typeId: 'T1',
  a,
  b,
  ...(sagitta !== undefined ? { sagitta } : {}),
});

/** 점 p의 현(a→b)으로부터의 부호있는 수직거리 (좌측법선 n=(-dir.y,dir.x) 방향이 +) */
function signedPerp(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  return (p[0] - a[0]) * nx + (p[1] - a[1]) * ny;
}

function bbox(positions: Float32Array) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!); maxX = Math.max(maxX, positions[i]!);
    minY = Math.min(minY, positions[i + 1]!); maxY = Math.max(maxY, positions[i + 1]!);
    minZ = Math.min(minZ, positions[i + 2]!); maxZ = Math.max(maxZ, positions[i + 2]!);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

describe('arcPolyline', () => {
  it('끝점은 입력 a,b와 정확히 일치(정수 — 끝점 조인 키 유지)', () => {
    const poly = arcPolyline([0, 0], [4000, 0], 500);
    expect(poly[0]).toEqual([0, 0]);
    expect(poly[poly.length - 1]).toEqual([4000, 0]);
  });

  it('결정론: 같은 (a,b,sagitta) → 동일 점 배열', () => {
    const p1 = arcPolyline([0, 0], [4000, 0], 500);
    const p2 = arcPolyline([0, 0], [4000, 0], 500);
    expect(p1).toEqual(p2);
  });

  it('호 중간점의 현으로부터 최대 수직편차 ≈ |sagitta| (내접 폴리라인 → ≤ s, 테셀레이션 오차만큼 작음)', () => {
    const s = 500;
    const poly = arcPolyline([0, 0], [4000, 0], s);
    const perps = poly.map((p) => signedPerp(p, [0, 0], [4000, 0]));
    const maxAbs = Math.max(...perps.map(Math.abs));
    // 내접 폴리라인이라 정점편차는 항상 ≤ 실제 새지타. N=5(이 경우)에서 정점이 정확히 정점(apex)에 안 떨어져 ~480.
    // (1mm 라운딩 여유로 s를 살짝 넘을 수 있어 +2 허용)
    expect(maxAbs).toBeGreaterThan(s * 0.9); // 테셀레이션이 호를 충분히 따라감
    expect(maxAbs).toBeLessThanOrEqual(s + 2);
  });

  it('부호 반전 = 휘는 쪽 반대 (최대편차 정점이 현 반대편)', () => {
    const a: Pt = [0, 0];
    const b: Pt = [4000, 0];
    const pPlus = arcPolyline(a, b, 500);
    const pMinus = arcPolyline(a, b, -500);
    const perpPlus = pPlus.map((p) => signedPerp(p, a, b));
    const perpMinus = pMinus.map((p) => signedPerp(p, a, b));
    const extremePlus = perpPlus.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
    const extremeMinus = perpMinus.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
    expect(extremePlus).toBeGreaterThan(0); // +sagitta = 좌측(+n)
    expect(extremeMinus).toBeLessThan(0); // −sagitta = 우측
  });

  it('새지타 작으면 점 수 최소(≈현), 클수록 증가(상한 N=64 → 65점)', () => {
    // sagitta=1, chord=4000 → R≈2,000,000, Θ≈0.001rad → N=clamp(ceil≈1,2,64)=2 → 3점.
    const nearStraight = arcPolyline([0, 0], [4000, 0], 1);
    expect(nearStraight.length).toBeLessThanOrEqual(3); // 거의 직선
    const semicircle = arcPolyline([0, 0], [4000, 0], 2000); // sagitta=h → 반원(Θ=π)
    expect(semicircle.length).toBeGreaterThan(8);
    expect(semicircle.length).toBeLessThanOrEqual(65); // N≤64 → ≤65점
  });
});

describe('곡선 벽 파생', () => {
  it('곡선 벽 = 비어있지 않은 메시 (positions/normals)', () => {
    const geo = deriveWall({ wall: wall([0, 0], [4000, 0], 500), type, level });
    expect(geo.positions.length).toBeGreaterThan(0);
    expect(geo.normals.length).toBe(geo.positions.length);
  });

  it('곡선 풋프린트의 중심선이 현으로부터 ~|sagitta| 편차', () => {
    const a: Pt = [0, 0];
    const b: Pt = [4000, 0];
    const s = 500;
    const fp = wallFootprint({ wall: wall(a, b, s), type, level });
    // 풋프린트는 outer(centerline+tw/2) ++ reverse(inner(centerline−tw/2)).
    // 중심선 편차 = (outer편차 + inner편차)/2 ≈ |s| (±tw/2가 상쇄). 정점쌍 평균의 최대.
    const half = fp.length / 2;
    const outer = fp.slice(0, half);
    const inner = fp.slice(half).reverse(); // outer[i]에 대응
    let maxCenterPerp = 0;
    for (let i = 0; i < half; i++) {
      const cx = (outer[i]![0] + inner[i]![0]) / 2;
      const cy = (outer[i]![1] + inner[i]![1]) / 2;
      const perp = signedPerp([cx, cy], a, b);
      if (Math.abs(perp) > Math.abs(maxCenterPerp)) maxCenterPerp = perp;
    }
    expect(maxCenterPerp).toBeGreaterThan(s * 0.9); // 좌측 볼록, 테셀레이션 정점편차 ≤ s
    expect(maxCenterPerp).toBeLessThanOrEqual(s + 2);
  });

  it('+sagitta vs −sagitta 풋프린트 = 현 반대편으로 볼록', () => {
    const a: Pt = [0, 0];
    const b: Pt = [4000, 0];
    const centerExtreme = (s: number) => {
      const fp = wallFootprint({ wall: wall(a, b, s), type, level });
      const half = fp.length / 2;
      const outer = fp.slice(0, half);
      const inner = fp.slice(half).reverse();
      let ext = 0;
      for (let i = 0; i < half; i++) {
        const perp = signedPerp([(outer[i]![0] + inner[i]![0]) / 2, (outer[i]![1] + inner[i]![1]) / 2], a, b);
        if (Math.abs(perp) > Math.abs(ext)) ext = perp;
      }
      return ext;
    };
    expect(centerExtreme(500)).toBeGreaterThan(0);
    expect(centerExtreme(-500)).toBeLessThan(0);
  });

  it('deriveKey가 sagitta를 포함 (곡률 변경 → 키 변동, stale 캐시 방지)', () => {
    const straight = wallDeriveKey({ wall: wall([0, 0], [4000, 0]), type, level });
    const curved = wallDeriveKey({ wall: wall([0, 0], [4000, 0], 500), type, level });
    const curved2 = wallDeriveKey({ wall: wall([0, 0], [4000, 0], 600), type, level });
    expect(straight).not.toBe(curved);
    expect(curved).not.toBe(curved2);
  });
});

describe('직선 벽 회귀 — sagitta 없으면 기존 경로(바이트 동일)', () => {
  it('sagitta 없는 벽 = 12면 프리즘(상/하/측2/끝2 → 변경 전과 동일 삼각형 수)', () => {
    // 기존 geometry.test.ts가 12*9 positions를 pin함. 여기선 곡선 작업 후에도 직선이 그대로인지 재확인.
    const geo = deriveWall({ wall: wall([0, 0], [4000, 0]), type, level });
    expect(geo.positions.length).toBe(12 * 9);
    const bb = bbox(geo.positions);
    // 4m 벽, 두께 200mm → x: 0..4, z: 0..0.2 (±tw/2 = ±0.1 중심선 y=0), y(높이): 0..3
    expect(bb.maxX - bb.minX).toBeCloseTo(4.0, 5);
    expect(bb.maxZ - bb.minZ).toBeCloseTo(0.2, 5);
    expect(bb.maxY - bb.minY).toBeCloseTo(3.0, 5);
  });

  it('sagitta:0 = 직선 경로(곡선 분기 안 탐, !sagitta가 0을 falsy 처리)', () => {
    const geo = deriveWall({ wall: wall([0, 0], [4000, 0], 0), type, level });
    expect(geo.positions.length).toBe(12 * 9); // 직선과 동일
  });
});

describe('곡선 벽 개구부 차단 + lint (Codex #2)', () => {
  it('곡선 벽에 createOpening = throw / 직선 벽 = 정상', () => {
    const s = new DocStore();
    seedDocument(s);
    const straight = s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    expect(() => s.createOpening({ hostId: straight, typeId: SEED_IDS.door900, offset: 2000 })).not.toThrow();
    const arc = s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 2000], b: [4000, 2000], sagitta: 600 });
    expect(() => s.createOpening({ hostId: arc, typeId: SEED_IDS.door900, offset: 2000 })).toThrow();
  });

  it('updateElement: 개구부 보유 벽 곡선화 차단 (Codex #2 보강)', () => {
    const s = new DocStore();
    seedDocument(s);
    const straight = s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    s.createOpening({ hostId: straight, typeId: SEED_IDS.door900, offset: 2000 });
    expect(() => s.updateElement(straight, { sagitta: 600 })).toThrow(); // 개구부 있어 차단
    // 개구부 없으면 곡선화 OK
    const bare = s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 3000], b: [4000, 3000] });
    expect(() => s.updateElement(bare, { sagitta: 600 })).not.toThrow();
  });

  it('타이트 곡률 footprint = 자기교차 폴백(직선 butt 4점, 3D 가드와 일치)', () => {
    // a=[0,0] b=[200,0] sagitta=100 thickness=200 → R=100 ≤ tw/2=100 → 직선 butt(자기교차 방지)
    const fp = curvedWallFootprint([0, 0], [200, 0], 100, 200);
    expect(fp).toHaveLength(4); // 호 레일(다정점) 아닌 단순 사각형
    const xs = fp.map((p) => p[0]);
    const ys = fp.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 200]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([-100, 100]);
  });

  it('완만 곡률 footprint = 호 레일(다정점)', () => {
    expect(curvedWallFootprint([0, 0], [4000, 0], 300, 200).length).toBeGreaterThan(4);
  });

  it('lint arc-wall-opening: import/머지로 곡선 벽+개구부 유입 시 플래그(backstop)', () => {
    const s = new DocStore();
    seedDocument(s);
    const straight = s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const op = s.createOpening({ hostId: straight, typeId: SEED_IDS.door900, offset: 2000 });
    expect(lint(s).some((f) => f.code === 'arc-wall-opening')).toBe(false);
    // import/머지 시나리오: snapshot서 host에 sagitta 주입(updateElement 가드 우회 = 외부 경로) → 재import
    const snap = s.snapshot();
    const w = snap.elements.find((e) => e.id === straight) as { sagitta?: number };
    w.sagitta = 600;
    s.importSnapshot(snap);
    const found = lint(s).filter((f) => f.code === 'arc-wall-opening');
    expect(found).toHaveLength(1);
    expect(found[0]!.elementIds).toContain(op);
  });
});
