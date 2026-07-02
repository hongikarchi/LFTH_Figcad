import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex, deriveDrawing, sectionRing, sectionVHalf, sectionWidth } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { applyOpLog, executeOp } from '../src/ai';
import { formatSection } from '../src/schema';
import type { BeamElement, ColumnType, DrawingView, Pt, Section } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

/** non-indexed 메시 부호 부피 (beam.test.ts 패턴) */
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

/** 링 부호 면적 (슈레이스, CCW 양수) mm² */
function ringArea(ring: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

const H300: Section = { shape: 'hsection', width: 150, depth: 300, web: 7, flange: 9 };
/** H 단면 이론 면적 = 2·b·tf + (h−2tf)·tw */
const H300_AREA = 2 * 150 * 9 + (300 - 2 * 9) * 7;

describe('hsection — 링/파생', () => {
  it('sectionRing(hsection) = 12점 CCW, 부호 면적 = 2·b·tf+(h−2tf)·tw', () => {
    const ring = sectionRing(H300);
    expect(ring).toHaveLength(12);
    expect(ringArea(ring)).toBeCloseTo(H300_AREA, 6); // CCW = 양수
  });

  it('deriveColumn(hsection) 부피 ≈ 단면적 × 높이', () => {
    const { store, seed } = setup();
    const typeId = store.addType({ kind: 'column', name: 'H기둥', section: H300, color: '#ccc' });
    const id = store.createColumn({ levelId: seed.levelId, typeId, at: [1000, 2000] });
    const geo = new DeriveCache().derive(store, id, buildDeriveIndex(store));
    expect(geo).not.toBeNull();
    // mm²×mm → m³ = ×1e-9. 기본 높이 = 3000
    expect(Math.abs(signedVolume(geo!.positions))).toBeCloseTo(H300_AREA * 3000 * 1e-9, 6);
  });

  it('deriveBeam(hsection) 부피 ≈ 단면적 × 길이 (대각 축 포함)', () => {
    const { store, seed } = setup();
    const typeId = store.addType({ kind: 'beam', name: 'H보', section: H300, color: '#ccc' });
    const id = store.createBeam({ levelId: seed.levelId, typeId, a: [0, 0], b: [3000, 4000] }); // L=5000
    const geo = new DeriveCache().derive(store, id, buildDeriveIndex(store));
    expect(Math.abs(signedVolume(geo!.positions))).toBeCloseTo(H300_AREA * 5000 * 1e-9, 6);
  });
});

describe('polygon — 링/파생/헬퍼', () => {
  it('CW 입력 폴리곤도 정상 부피 (enforceWinding)', () => {
    const { store, seed } = setup();
    // CW 삼각형 (슈레이스 음수): 면적 = 500×500/2
    const cw: Pt[] = [
      [0, 0],
      [0, 500],
      [500, 0],
    ];
    expect(ringArea(cw)).toBeLessThan(0);
    const typeId = store.addType({ kind: 'column', name: '삼각', section: { shape: 'polygon', points: cw }, color: '#ccc' });
    const id = store.createColumn({ levelId: seed.levelId, typeId, at: [0, 0] });
    const geo = new DeriveCache().derive(store, id, buildDeriveIndex(store));
    const vol = signedVolume(geo!.positions);
    expect(vol).toBeGreaterThan(0); // inside-out 아님
    expect(vol).toBeCloseTo(((500 * 500) / 2) * 3000 * 1e-9, 6);
  });

  it('sectionVHalf(비대칭 polygon) = max y · sectionWidth = x범위', () => {
    const asym: Section = {
      shape: 'polygon',
      points: [
        [-100, -50],
        [100, -50],
        [0, 300],
      ],
    };
    expect(sectionVHalf(asym)).toBe(300);
    expect(sectionWidth(asym)).toBe(200);
    expect(sectionVHalf(H300)).toBe(150);
    expect(sectionWidth(H300)).toBe(150);
    expect(sectionVHalf({ shape: 'circle', diameter: 500 })).toBe(250);
    expect(sectionWidth({ shape: 'circle', diameter: 500 })).toBe(500);
  });

  it('formatSection — 4형 라벨', () => {
    expect(formatSection({ shape: 'rect', width: 300, depth: 600 })).toBe('300×600');
    expect(formatSection({ shape: 'circle', diameter: 500 })).toBe('Ø500');
    expect(formatSection(H300)).toBe('H 150×300×7/9');
    expect(formatSection({ shape: 'polygon', points: [[0, 0], [100, 0], [0, 100]] })).toBe('다각형 3pt');
  });
});

describe('store.addType — 양자화 + 명시 검증 throw', () => {
  it('float 치수/점 양자화 (mm 정수)', () => {
    const { store } = setup();
    const hId = store.addType({
      kind: 'beam',
      name: 'Hf',
      section: { shape: 'hsection', width: 150.4, depth: 300.2, web: 7.4, flange: 9.6 },
      color: '#ccc',
    });
    const ht = store.getType(hId);
    expect(ht?.kind === 'beam' && ht.section).toEqual({ shape: 'hsection', width: 150, depth: 300, web: 7, flange: 10 });

    const pId = store.addType({
      kind: 'column',
      name: 'Pf',
      section: { shape: 'polygon', points: [[0.4, 0.6], [500.2, 0], [0, 500.5]] as Pt[] },
      color: '#ccc',
    });
    const pt = store.getType(pId);
    expect(pt?.kind === 'column' && pt.section).toEqual({
      shape: 'polygon',
      points: [[0, 1], [500, 0], [0, 501]],
    });
  });

  it('hsection: web≥width / 2·flange≥depth 거부', () => {
    const { store } = setup();
    expect(() =>
      store.addType({ kind: 'beam', name: 'bad', section: { shape: 'hsection', width: 150, depth: 300, web: 150, flange: 9 }, color: '#ccc' }),
    ).toThrow(/web/);
    expect(() =>
      store.addType({ kind: 'beam', name: 'bad', section: { shape: 'hsection', width: 150, depth: 300, web: 7, flange: 150 }, color: '#ccc' }),
    ).toThrow(/flange/);
    expect(() =>
      store.addType({ kind: 'beam', name: 'bad', section: { shape: 'hsection', width: 150, depth: 300, web: 0, flange: 9 }, color: '#ccc' }),
    ).toThrow();
  });

  it('rect/circle: 0·음수 치수 거부 (v0.4 리뷰 — 양수성)', () => {
    const { store } = setup();
    expect(() =>
      store.addType({ kind: 'beam', name: 'bad', section: { shape: 'rect', width: 0, depth: 600 }, color: '#ccc' }),
    ).toThrow(/width/);
    expect(() =>
      store.addType({ kind: 'beam', name: 'bad', section: { shape: 'rect', width: 300, depth: -600 }, color: '#ccc' }),
    ).toThrow(/depth/);
    expect(() =>
      store.addType({ kind: 'column', name: 'bad', section: { shape: 'circle', diameter: 0 }, color: '#ccc' }),
    ).toThrow(/diameter/);
  });

  it('polygon: 퇴화(면적 0 — 공선/중복점) 거부 (earcut NaN 방지)', () => {
    const { store } = setup();
    // 3점 전부 공선 — isSimplePolygon은 통과하던 케이스
    expect(() =>
      store.addType({
        kind: 'column', name: 'bad',
        section: { shape: 'polygon', points: [[0, 0], [100, 0], [200, 0]] as Pt[] }, color: '#ccc',
      }),
    ).toThrow(/degenerate/);
    // 중복점만으로 이뤄진 링
    expect(() =>
      store.addType({
        kind: 'column', name: 'bad',
        section: { shape: 'polygon', points: [[50, 50], [50, 50], [50, 50]] as Pt[] }, color: '#ccc',
      }),
    ).toThrow(/degenerate|self-intersecting/);
    // 정상 폴리곤은 통과 (회귀 가드)
    expect(() =>
      store.addType({
        kind: 'column', name: 'ok',
        section: { shape: 'polygon', points: [[0, 0], [100, 0], [0, 100]] as Pt[] }, color: '#ccc',
      }),
    ).not.toThrow();
  });

  it('polygon: 자가교차/점부족 거부 (updateType도 동일 경로)', () => {
    const { store } = setup();
    const bowtie: Pt[] = [
      [0, 0],
      [100, 100],
      [100, 0],
      [0, 100],
    ];
    expect(() =>
      store.addType({ kind: 'column', name: 'bad', section: { shape: 'polygon', points: bowtie }, color: '#ccc' }),
    ).toThrow(/self-intersecting/);
    expect(() =>
      store.addType({ kind: 'column', name: 'bad', section: { shape: 'polygon', points: [[0, 0], [100, 0]] as Pt[] }, color: '#ccc' }),
    ).toThrow();
    // updateType — 유효 타입을 자가교차로 바꾸려 하면 거부
    const ok = store.addType({ kind: 'column', name: 'ok', section: { shape: 'polygon', points: [[0, 0], [100, 0], [0, 100]] as Pt[] }, color: '#ccc' });
    expect(() => store.updateType(ok, { section: { shape: 'polygon', points: bowtie } })).toThrow(/self-intersecting/);
  });
});

describe('create_type capability (executeOp)', () => {
  it('beam/column/wall — getType 대조 + id 반환', () => {
    const { store } = setup();
    const beamId = executeOp(store, 'create_type', {
      kind: 'beam',
      name: 'H-300×150',
      section: { shape: 'hsection', width: 150, depth: 300, web: 7, flange: 9 },
    }) as string;
    const bt = store.getType(beamId);
    expect(bt?.kind).toBe('beam');
    expect(bt?.name).toBe('H-300×150');
    expect(bt?.kind === 'beam' && bt.section).toEqual(H300);
    expect(bt?.color).toBe('#cfc9bf'); // 시드 기본색

    const colId = executeOp(store, 'create_type', {
      kind: 'column',
      name: '원기둥',
      section: { shape: 'circle', diameter: 500 },
      color: '#123456',
    }) as string;
    const ct = store.getType(colId);
    expect(ct?.kind === 'column' && ct.section).toEqual({ shape: 'circle', diameter: 500 });
    expect(ct?.color).toBe('#123456'); // 명시 색 우선

    const wallId = executeOp(store, 'create_type', { kind: 'wall', name: '벽 150', thickness: 150 }) as string;
    const wt = store.getType(wallId);
    expect(wt?.kind === 'wall' && wt.thickness).toBe(150);
  });

  it('나머지 kind(개구부/계단/난간/커튼월/슬라브/지붕)도 생성', () => {
    const { store } = setup();
    const opId = runCapability(store, 'create_type', {
      kind: 'opening',
      name: '문 800',
      opening: { kind: 'door', width: 800, height: 2100 },
    }) as string;
    const ot = store.getType(opId);
    expect(ot?.kind === 'opening' && ot.opening).toEqual({ kind: 'door', width: 800, height: 2100, sillHeight: 0 });
    const stId = runCapability(store, 'create_type', { kind: 'stair', name: '계단 1200', width: 1200, riser: 180 }) as string;
    expect(store.getType(stId)?.kind).toBe('stair');
    const raId = runCapability(store, 'create_type', { kind: 'railing', name: '난간 1000', height: 1000, postSpacing: 1500 }) as string;
    expect(store.getType(raId)?.kind).toBe('railing');
    const cwId = runCapability(store, 'create_type', {
      kind: 'curtainwall',
      name: 'CW60',
      mullionSection: { shape: 'rect', width: 60, depth: 120 },
    }) as string;
    expect(store.getType(cwId)?.kind).toBe('curtainwall');
    const slId = runCapability(store, 'create_type', { kind: 'slab', name: '슬라브 200', thickness: 200 }) as string;
    expect(store.getType(slId)?.kind).toBe('slab');
    const rfId = runCapability(store, 'create_type', { kind: 'roof', name: '지붕 150', thickness: 150 }) as string;
    expect(store.getType(rfId)?.kind).toBe('roof');
  });

  it('필수 파라미터 누락 = throw (kind별)', () => {
    const { store } = setup();
    expect(() => executeOp(store, 'create_type', { kind: 'beam', name: 'x' })).toThrow(); // section 누락
    expect(() => executeOp(store, 'create_type', { kind: 'wall', name: 'x' })).toThrow(/thickness/);
    expect(() => executeOp(store, 'create_type', { kind: 'stair', name: 'x', width: 1000 })).toThrow(/riser/);
    expect(() => executeOp(store, 'create_type', { kind: 'opening', name: 'x' })).toThrow(/opening/);
    expect(() => executeOp(store, 'create_type', { kind: 'curtainwall', name: 'x' })).toThrow(/mullionSection/);
    expect(() => executeOp(store, 'create_type', { kind: 'nope', name: 'x' })).toThrow();
    expect(() =>
      executeOp(store, 'create_type', { kind: 'beam', name: 'x', section: { shape: 'blob' } }),
    ).toThrow(/shape/);
  });

  it('계약 테스트 — applyOpLog placeholder 리맵: create_type → create_beam(typeId=tmp)', () => {
    const { store, seed } = setup();
    const result = applyOpLog(store, [
      {
        op: 'create_type',
        args: { kind: 'beam', name: 'H-300×150', section: { shape: 'hsection', width: 150, depth: 300, web: 7, flange: 9 } },
        result: 'tmp-1',
      },
      {
        op: 'create_beam',
        args: { levelId: seed.levelId, typeId: 'tmp-1', a: [0, 0], b: [4000, 0] },
        result: 'tmp-2',
      },
    ]);
    expect(result.applied).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(result.createdIds).toHaveLength(2);
    const realTypeId = result.createdIds[0]!;
    const beam = store.getElement(result.createdIds[1]!) as BeamElement;
    expect(beam.kind).toBe('beam');
    expect(beam.typeId).toBe(realTypeId); // 'tmp-1'이 실 id로 치환됨
    const t = store.getType(realTypeId) as ColumnType | undefined;
    expect(t?.name).toBe('H-300×150');
  });
});

describe('deriveDrawing — hsection 평면 절단', () => {
  it('H기둥 plan-cut → 12점 절단 폴리곤', () => {
    const { store, seed } = setup();
    const typeId = store.addType({ kind: 'column', name: 'H기둥', section: H300, color: '#ccc' });
    store.createColumn({ levelId: seed.levelId, typeId, at: [1000, 1000] });
    const view: DrawingView = { id: 'v', name: 'p', type: 'plan', levelId: seed.levelId, cutHeight: 1200 };
    const d = deriveDrawing(view, store);
    const cut12 = d.cut.find((p) => p.closed && p.pts.length === 12);
    expect(cut12).toBeDefined();
    expect(d.hatch.length).toBeGreaterThan(0);
  });
});
