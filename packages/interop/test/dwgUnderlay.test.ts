import { describe, expect, it } from 'vitest';
import { extractDwgUnderlay, type DwgDatabaseLike } from '../src/dwgUnderlay';

const db = (entities: unknown[], blockRecords: unknown[] = []): DwgDatabaseLike =>
  ({ entities, tables: { BLOCK_RECORD: blockRecords } }) as DwgDatabaseLike;

// 세그먼트 점들이 (cx,cy) 반지름 r 원 위에 있나
const onCircle = (segs: Float32Array, cx: number, cy: number, r: number, tol = 1e-3) => {
  for (let i = 0; i < segs.length; i += 2) {
    const d = Math.hypot(segs[i]! - cx, segs[i + 1]! - cy);
    if (Math.abs(d - r) > tol) return false;
  }
  return true;
};

describe('extractDwgUnderlay — 기본 엔티티', () => {
  it('LINE → 세그먼트 1개 + 레이어 태그', () => {
    const u = extractDwgUnderlay(
      db([{ type: 'LINE', layer: 'I-WALL', startPoint: { x: 0, y: 0 }, endPoint: { x: 1000, y: 500 } }]),
    );
    expect(u.segments.length).toBe(4);
    expect([...u.segments]).toEqual([0, 0, 1000, 500]);
    expect(u.layers).toEqual(['I-WALL']);
    expect(u.layerSegCount).toEqual([1]);
    expect(u.bbox).toEqual([0, 0, 1000, 500]);
  });

  it('CIRCLE → 닫힌 폴리곤, 모든 점이 원 위', () => {
    const u = extractDwgUnderlay(db([{ type: 'CIRCLE', center: { x: 100, y: 200 }, radius: 50 }]));
    expect(u.segments.length / 4).toBeGreaterThanOrEqual(16); // π/16 분해능
    expect(onCircle(u.segments, 100, 200, 50)).toBe(true);
  });

  it('ARC 90° → 점들이 원 위 + 끝점 정확', () => {
    const u = extractDwgUnderlay(
      db([{ type: 'ARC', center: { x: 0, y: 0 }, radius: 100, startAngle: 0, endAngle: Math.PI / 2 }]),
    );
    expect(onCircle(u.segments, 0, 0, 100)).toBe(true);
    // 시작 (100,0), 끝 (0,100)
    expect(u.segments[0]).toBeCloseTo(100, 6);
    expect(u.segments[1]).toBeCloseTo(0, 6);
    expect(u.segments[u.segments.length - 2]).toBeCloseTo(0, 6);
    expect(u.segments[u.segments.length - 1]).toBeCloseTo(100, 6);
  });
});

describe('extractDwgUnderlay — bulge(부호) robust', () => {
  // 기대값을 DXF 스펙(외부 oracle)에서 도출 — 코드 가정에서 도출 금지(자기참조 회귀 방지).
  // 스펙: bulge<0 = CW. bulge=+1(CCW) 반원 A(0,0)→B(10,0) = 중심(5,0), CCW 통해 270° = apex (5,-5).
  it('bulge=+1(CCW) 반원 → apex 아래(-y) (5,-5), 중심=현중점', () => {
    const u = extractDwgUnderlay(
      db([{ type: 'LWPOLYLINE', vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0 }] }]),
    );
    expect(onCircle(u.segments, 5, 0, 5, 1e-6)).toBe(true);
    // 모든 점 y<=0 (아래로 휨) — CCW = 270° 통과
    for (let i = 1; i < u.segments.length; i += 2) expect(u.segments[i]!).toBeLessThanOrEqual(1e-9);
    const apexY = Math.min(...[...u.segments].filter((_, i) => i % 2 === 1));
    expect(apexY).toBeCloseTo(-5, 4);
  });

  it('bulge=-1(CW) → apex 위(+y) (5,+5)', () => {
    const u = extractDwgUnderlay(
      db([{ type: 'LWPOLYLINE', vertices: [{ x: 0, y: 0, bulge: -1 }, { x: 10, y: 0 }] }]),
    );
    expect(onCircle(u.segments, 5, 0, 5, 1e-6)).toBe(true);
    for (let i = 1; i < u.segments.length; i += 2) expect(u.segments[i]!).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...[...u.segments].filter((_, i) => i % 2 === 1))).toBeCloseTo(5, 4);
  });

  it('닫힌 LWPOLYLINE(flag&1) → 마지막→처음 닫는 변 포함', () => {
    const open = extractDwgUnderlay(
      db([{ type: 'LWPOLYLINE', flag: 0, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }]),
    );
    const closed = extractDwgUnderlay(
      db([{ type: 'LWPOLYLINE', flag: 1, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }]),
    );
    expect(open.segments.length / 4).toBe(2); // 2변
    expect(closed.segments.length / 4).toBe(3); // +닫는 변
  });
});

describe('extractDwgUnderlay — INSERT 블록 전개', () => {
  const door = {
    name: 'door',
    basePoint: { x: 0, y: 0 },
    entities: [{ type: 'LINE', layer: 'I-DOOR', startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 } }],
  };

  it('이동만 — insertionPoint 더해짐', () => {
    const u = extractDwgUnderlay(
      db([{ type: 'INSERT', name: 'door', insertionPoint: { x: 500, y: 300 } }], [door]),
    );
    expect([...u.segments]).toEqual([500, 300, 600, 300]);
    expect(u.skipped['INSERT-nodef']).toBeUndefined();
  });

  it('회전 90° + 스케일 2 — 변환행렬 정확', () => {
    const u = extractDwgUnderlay(
      db([{ type: 'INSERT', name: 'door', insertionPoint: { x: 0, y: 0 }, xScale: 2, yScale: 2, rotation: Math.PI / 2 }], [door]),
    );
    // (0,0)→(0,0), (100,0) 스케일2=(200,0) 회전90°=(0,200)
    expect(u.segments[0]).toBeCloseTo(0, 6);
    expect(u.segments[1]).toBeCloseTo(0, 6);
    expect(u.segments[2]).toBeCloseTo(0, 6);
    expect(u.segments[3]).toBeCloseTo(200, 6);
  });

  it('거울(xScale=-1) — X 반전, 좌표 안 번짐', () => {
    const u = extractDwgUnderlay(
      db([{ type: 'INSERT', name: 'door', insertionPoint: { x: 0, y: 0 }, xScale: -1, yScale: 1, rotation: 0 }], [door]),
    );
    // door LINE (0,0)-(100,0), xScale -1 → (0,0)-(-100,0)
    expect([...u.segments]).toEqual([0, 0, -100, 0]);
  });

  it('비균일 스케일(xScale 3, yScale 1) — 축별 독립', () => {
    const b = { name: 'b', basePoint: { x: 0, y: 0 }, entities: [{ type: 'LINE', startPoint: { x: 10, y: 20 }, endPoint: { x: 10, y: 20 } }] };
    const u = extractDwgUnderlay(db([{ type: 'INSERT', name: 'b', insertionPoint: { x: 0, y: 0 }, xScale: 3, yScale: 1 }], [b]));
    expect([...u.segments]).toEqual([30, 20, 30, 20]); // x×3, y×1
  });

  it('basePoint 보정 — 블록 base가 insertion에 매핑', () => {
    const b = { name: 'b', basePoint: { x: 10, y: 0 }, entities: [{ type: 'LINE', startPoint: { x: 10, y: 0 }, endPoint: { x: 20, y: 0 } }] };
    const u = extractDwgUnderlay(db([{ type: 'INSERT', name: 'b', insertionPoint: { x: 0, y: 0 } }], [b]));
    // base(10,0)→(0,0), 끝(20,0)→(10,0)
    expect([...u.segments]).toEqual([0, 0, 10, 0]);
  });

  it('중첩 INSERT 재귀', () => {
    const inner = { name: 'inner', basePoint: { x: 0, y: 0 }, entities: [{ type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } }] };
    const outer = { name: 'outer', basePoint: { x: 0, y: 0 }, entities: [{ type: 'INSERT', name: 'inner', insertionPoint: { x: 100, y: 0 } }] };
    const u = extractDwgUnderlay(db([{ type: 'INSERT', name: 'outer', insertionPoint: { x: 1000, y: 0 } }], [inner, outer]));
    expect([...u.segments]).toEqual([1100, 0, 1110, 0]);
  });

  it('순환 INSERT 가드 — 무한루프 안 됨', () => {
    const self = { name: 'self', basePoint: { x: 0, y: 0 }, entities: [{ type: 'INSERT', name: 'self', insertionPoint: { x: 1, y: 0 } }, { type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 0 } }] };
    const u = extractDwgUnderlay(db([{ type: 'INSERT', name: 'self', insertionPoint: { x: 0, y: 0 } }], [self]));
    expect(u.skipped['INSERT-cycle']).toBeGreaterThanOrEqual(1);
    expect(u.segments.length).toBe(4); // LINE 1개만(재귀 중단)
  });

  it('블록 정의 없음 → INSERT-nodef 카운트(조용한 누락 없음)', () => {
    const u = extractDwgUnderlay(db([{ type: 'INSERT', name: 'missing', insertionPoint: { x: 0, y: 0 } }]));
    expect(u.skipped['INSERT-nodef']).toBe(1);
    expect(u.segments.length).toBe(0);
  });
});

describe('extractDwgUnderlay — 라벨 + 스킵', () => {
  it('TEXT → 라벨, 세그먼트 아님', () => {
    const u = extractDwgUnderlay(
      db([{ type: 'TEXT', layer: 'A-TEXT', text: '거실', startPoint: { x: 100, y: 200 }, textHeight: 300 }]),
    );
    expect(u.segments.length).toBe(0);
    expect(u.labels).toEqual([{ text: '거실', x: 100, y: 200, height: 300, layer: 'A-TEXT' }]);
  });

  it('미지원 타입 → skipped 카운트', () => {
    const u = extractDwgUnderlay(
      db([{ type: 'HATCH' }, { type: 'HATCH' }, { type: 'DIMENSION' }, { type: 'WIPEOUT' }]),
    );
    expect(u.skipped).toEqual({ HATCH: 2, DIMENSION: 1, WIPEOUT: 1 });
    expect(u.segments.length).toBe(0);
  });

  it('BLOCK_RECORD가 {entries} 래퍼여도 흡수', () => {
    const u = extractDwgUnderlay({
      entities: [{ type: 'INSERT', name: 'd', insertionPoint: { x: 0, y: 0 } }],
      tables: { BLOCK_RECORD: { entries: [{ name: 'd', basePoint: { x: 0, y: 0 }, entities: [{ type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 0 } }] }] } },
    } as DwgDatabaseLike);
    expect([...u.segments]).toEqual([0, 0, 5, 0]);
  });
});
