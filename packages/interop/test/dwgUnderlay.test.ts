import { describe, expect, it } from 'vitest';
import { cleanMText, clipSegmentAabb, extractDwgUnderlay, underlayDenseCenter, type DwgDatabaseLike } from '../src/dwgUnderlay';

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

  it('LWPOLYLINE closed = libredwg flag bit 512 → 닫는 세그 포함', () => {
    const u = extractDwgUnderlay(db([{ type: 'LWPOLYLINE', flag: 512, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }]));
    expect(u.segments.length / 4).toBe(4); // 4점 닫힘 = 4세그 (마지막 (0,10)→(0,0))
  });

  it('LWPOLYLINE 열림(flag 0) → 닫는 세그 없음', () => {
    const u = extractDwgUnderlay(db([{ type: 'LWPOLYLINE', flag: 0, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }]));
    expect(u.segments.length / 4).toBe(2);
  });

  it('SOLID → 외곽 쿼드(DXF 와인딩 1-2-4-3)', () => {
    const u = extractDwgUnderlay(db([{ type: 'SOLID', corner1: { x: 0, y: 0 }, corner2: { x: 10, y: 0 }, corner3: { x: 0, y: 10 }, corner4: { x: 10, y: 10 } }]));
    expect(u.segments.length / 4).toBe(4);
  });

  it('HATCH edge 경계 → 경계선 세그', () => {
    const u = extractDwgUnderlay(db([{ type: 'HATCH', boundaryPaths: [{ boundaryPathTypeFlag: 1, edges: [{ type: 1, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { type: 1, start: { x: 10, y: 0 }, end: { x: 10, y: 10 } }] }] }]));
    expect(u.segments.length / 4).toBe(2);
  });

  it('solidFill HATCH → fills 채움 루프(로고·poché)', () => {
    const u = extractDwgUnderlay(db([{ type: 'HATCH', solidFill: 1, boundaryPaths: [{ boundaryPathTypeFlag: 2, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }] }]));
    expect(u.fills.length).toBe(1);
    expect(u.fills[0]!.loops[0]!.length).toBe(4); // 4코너 루프
  });

  it('패턴 HATCH(solidFill 없음) → 채움 안 함(경계만)', () => {
    const u = extractDwgUnderlay(db([{ type: 'HATCH', boundaryPaths: [{ boundaryPathTypeFlag: 2, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }] }]));
    expect(u.fills.length).toBe(0);
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

  it('미지원 타입 → skipped 카운트 (WIPEOUT·XLINE 등 진짜 미지원)', () => {
    const u = extractDwgUnderlay(db([{ type: 'WIPEOUT' }, { type: 'WIPEOUT' }, { type: 'XLINE' }]));
    expect(u.skipped).toEqual({ WIPEOUT: 2, XLINE: 1 });
    expect(u.segments.length).toBe(0);
  });

  it('DIMENSION → 익명 *D 블록 전개(치수선 + 측정값 MTEXT 라벨)', () => {
    const u = extractDwgUnderlay({
      entities: [{ type: 'DIMENSION', blockName: '*D1', insertionPoint: { x: 0, y: 0 } }],
      tables: { BLOCK_RECORD: { entries: [{ name: '*D1', basePoint: { x: 0, y: 0 }, entities: [
        { type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 } },
        { type: 'MTEXT', text: '100', startPoint: { x: 50, y: 20 }, textHeight: 25 },
      ] }] } },
    } as DwgDatabaseLike);
    expect(u.segments.length / 4).toBe(1); // 치수선
    expect(u.labels.map((l) => l.text)).toEqual(['100']); // 측정값 텍스트
  });

  it('LAYER frozen/off → layerHidden 반영 (CAD 표시 의미론), color도', () => {
    const u = extractDwgUnderlay({
      entities: [
        { type: 'LINE', layer: 'TRAFFIC', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } },
        { type: 'LINE', layer: 'OFFLYR', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } },
        { type: 'LINE', layer: 'I-WALL', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } },
      ],
      tables: {
        LAYER: {
          entries: [
            { name: 'TRAFFIC', frozen: true, color: 0xff0000 },
            { name: 'OFFLYR', off: true, color: 0x00ff00 },
            { name: 'I-WALL', frozen: false, off: false, color: 0x000000 },
          ],
        },
      },
    } as DwgDatabaseLike);
    const idx = (n: string) => u.layers.indexOf(n);
    expect(u.layerHidden[idx('TRAFFIC')]).toBe(true); // frozen
    expect(u.layerHidden[idx('OFFLYR')]).toBe(true); // off
    expect(u.layerHidden[idx('I-WALL')]).toBe(false); // 보임
    expect(u.layerColor[idx('TRAFFIC')]).toBe(0xff0000);
  });

  it('LAYER 테이블 없으면 전부 보임(layerHidden false)', () => {
    const u = extractDwgUnderlay(db([{ type: 'LINE', layer: 'X', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } }]));
    expect(u.layerHidden).toEqual([false]);
  });

  it('denseCenter — 숨김 레이어 무시(보이는 콘텐츠에 센터)', () => {
    // 숨김 레이어에 멀리 빽빽한 클러스터 + 보이는 레이어에 가까운 소수 → 보이는 쪽 센터
    const ents: unknown[] = [];
    for (let i = 0; i < 50; i++) ents.push({ type: 'LINE', layer: 'HID', startPoint: { x: 9_000_000 + i, y: 9_000_000 }, endPoint: { x: 9_000_000 + i + 1, y: 9_000_000 } });
    for (let i = 0; i < 5; i++) ents.push({ type: 'LINE', layer: 'VIS', startPoint: { x: 100 + i, y: 200 }, endPoint: { x: 101 + i, y: 200 } });
    const u = extractDwgUnderlay({ entities: ents, tables: { LAYER: { entries: [{ name: 'HID', frozen: true }, { name: 'VIS' }] } } } as DwgDatabaseLike);
    const [cx, cy] = underlayDenseCenter(u);
    expect(cx).toBeLessThan(1000); // 9M 숨김 클러스터에 안 끌림
    expect(cy).toBeLessThan(1000);
  });

  it('underlayDenseCenter — 밀집 클러스터 중심(원격 이상점 무시)', () => {
    // 원점 근처 빽빽한 격자(클러스터) + 멀리 떨어진 이상점 1개
    const ents: unknown[] = [];
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++)
      ents.push({ type: 'LINE', startPoint: { x: 1000 + x * 100, y: 2000 + y * 100 }, endPoint: { x: 1000 + x * 100 + 50, y: 2000 + y * 100 } });
    ents.push({ type: 'LINE', startPoint: { x: 9_000_000, y: -9_000_000 }, endPoint: { x: 9_000_050, y: -9_000_000 } });
    const u = extractDwgUnderlay(db(ents));
    const [cx, cy] = underlayDenseCenter(u);
    // 클러스터 중심 ≈ (1500, 2450), 이상점(9M)에 안 끌려감
    expect(cx).toBeGreaterThan(1000);
    expect(cx).toBeLessThan(2000);
    expect(cy).toBeGreaterThan(2000);
    expect(cy).toBeLessThan(3000);
  });

  it('빈 언더레이 denseCenter = [0,0]', () => {
    expect(underlayDenseCenter(extractDwgUnderlay(db([{ type: 'HATCH' }])))).toEqual([0, 0]);
  });

  describe('파일 XCLIP (SPATIAL_FILTER → INSERT 지오 클립)', () => {
    // INSERT I1(=블록 B: LINE 0~100) + SPATIAL_FILTER가 x∈[20,80]로 클립. invBlock=항등 → 월드폴리=verts.
    const dbXclip = (verts: { x: number; y: number }[], owner = 'I1') =>
      ({
        entities: [{ type: 'INSERT', handle: 'I1', name: 'B', insertionPoint: { x: 0, y: 0 } }],
        tables: { BLOCK_RECORD: { entries: [{ name: 'B', basePoint: { x: 0, y: 0 }, entities: [{ type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 } }] }] } },
        objects: { SPATIAL_FILTER: [{ handle: 'F1', ownerHandle: owner, vertices: verts, invertBlockMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }] },
      }) as DwgDatabaseLike;

    it('INSERT 지오가 클립 경계서 트림됨', () => {
      const u = extractDwgUnderlay(dbXclip([{ x: 20, y: -10 }, { x: 80, y: -10 }, { x: 80, y: 10 }, { x: 20, y: 10 }]));
      expect([...u.segments]).toEqual([20, 0, 80, 0]); // x∈[20,80]만
    });

    it('2점(직사각형) 클립 — AutoCAD 직사각 XCLIP은 대각 2모서리 → 4코너 확장', () => {
      const u = extractDwgUnderlay(dbXclip([{ x: 20, y: -10 }, { x: 80, y: 10 }])); // 대각 2점
      expect([...u.segments]).toEqual([20, 0, 80, 0]); // 4코너 직사각으로 클립
    });

    it('클립 완전 바깥 = 전부 버림', () => {
      const u = extractDwgUnderlay(dbXclip([{ x: 200, y: -10 }, { x: 280, y: -10 }, { x: 280, y: 10 }, { x: 200, y: 10 }]));
      expect(u.segments.length).toBe(0);
    });

    it('소유체인 못 풀면(연결 안 됨) 클립 무시 = 전체 통과', () => {
      const u = extractDwgUnderlay(dbXclip([{ x: 20, y: -10 }, { x: 80, y: -10 }, { x: 80, y: 10 }, { x: 20, y: 10 }], 'NOPE'));
      expect([...u.segments]).toEqual([0, 0, 100, 0]); // 클립 안 걸림
    });

    it('SPATIAL_FILTER 없으면 무영향', () => {
      const u = extractDwgUnderlay({
        entities: [{ type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 } }],
      } as DwgDatabaseLike);
      expect([...u.segments]).toEqual([0, 0, 100, 0]);
    });
  });

  describe('clipSegmentAabb (XCLIP, Liang-Barsky)', () => {
    const box = [0, 0, 10, 10] as const;
    it('완전 안쪽 → 그대로', () => {
      expect(clipSegmentAabb(2, 2, 8, 8, ...box)).toEqual([2, 2, 8, 8]);
    });
    it('완전 바깥 → null', () => {
      expect(clipSegmentAabb(20, 20, 30, 30, ...box)).toBeNull();
      expect(clipSegmentAabb(-5, 5, -1, 5, ...box)).toBeNull();
    });
    it('가로지름 → 경계서 트림', () => {
      // (-5,5)→(15,5) 수평선 → [0,5]~[10,5]
      expect(clipSegmentAabb(-5, 5, 15, 5, ...box)).toEqual([0, 5, 10, 5]);
    });
    it('한 끝만 바깥 → 그쪽만 트림', () => {
      // (5,5)→(15,5) → [5,5]~[10,5]
      expect(clipSegmentAabb(5, 5, 15, 5, ...box)).toEqual([5, 5, 10, 5]);
    });
    it('대각선 모서리 트림', () => {
      const r = clipSegmentAabb(-5, -5, 15, 15, ...box);
      expect(r).toEqual([0, 0, 10, 10]);
    });
  });

  it('BLOCK_RECORD가 {entries} 래퍼여도 흡수', () => {
    const u = extractDwgUnderlay({
      entities: [{ type: 'INSERT', name: 'd', insertionPoint: { x: 0, y: 0 } }],
      tables: { BLOCK_RECORD: { entries: [{ name: 'd', basePoint: { x: 0, y: 0 }, entities: [{ type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 0 } }] }] } },
    } as DwgDatabaseLike);
    expect([...u.segments]).toEqual([0, 0, 5, 0]);
  });
});

describe('cleanMText', () => {
  it('정렬코드 \\A1; 벗김 → 평문', () => {
    expect(cleanMText('\\A1;13000')).toBe('13000');
  });
  it('폰트·높이·중괄호 벗김', () => {
    expect(cleanMText('{\\fArial|b0|i0;\\H2x;방 이름}')).toBe('방 이름');
  });
  it('단락 \\P → 공백', () => {
    expect(cleanMText('1층\\P평면도')).toBe('1층 평면도');
  });
  it('%%d/%%c/%%p → °/Ø/±', () => {
    expect(cleanMText('45%%d')).toBe('45°');
    expect(cleanMText('%%c100')).toBe('Ø100');
  });
  it('일반 텍스트 무변화', () => {
    expect(cleanMText('지상1층 평면도')).toBe('지상1층 평면도');
  });
});
