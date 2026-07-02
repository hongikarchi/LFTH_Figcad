import { beforeAll, describe, expect, it } from 'vitest';
import * as WebIFC from 'web-ifc';
import {
  DocStore,
  seedDocument,
  SEED_IDS,
  type BeamElement,
  type ColumnElement,
  type OpeningElement,
  type SlabElement,
  type WallElement,
} from '@figcad/core';
import { exportIfc, importIfc } from '../src';

// web-ifc WASM은 한 번만 Init (테스트 간 재사용)
let api: WebIFC.IfcAPI;
beforeAll(async () => {
  api = new WebIFC.IfcAPI();
  await api.Init();
});

/** 한 방(벽4 + 문 + 창 + 슬라브 + 2층) 문서 */
function sample(): DocStore {
  const s = new DocStore();
  seedDocument(s);
  const L = SEED_IDS.level;
  const T = SEED_IDS.wall200;
  const south = s.createWall({ levelId: L, typeId: T, a: [0, 0], b: [4000, 0] });
  const east = s.createWall({ levelId: L, typeId: T, a: [4000, 0], b: [4000, 3000] });
  s.createWall({ levelId: L, typeId: T, a: [4000, 3000], b: [0, 3000] });
  s.createWall({ levelId: L, typeId: SEED_IDS.wall100, a: [0, 3000], b: [0, 0] });
  s.createOpening({ hostId: south, typeId: SEED_IDS.door900, offset: 2000 });
  s.createOpening({ hostId: east, typeId: SEED_IDS.window1200, offset: 1500 });
  s.createSlab({ levelId: L, typeId: SEED_IDS.slab150, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
  s.addLevel({ name: '2층', elevation: 3000, height: 3000, order: 1 });
  return s;
}

function roundtrip(s: DocStore) {
  const bytes = exportIfc(api, s.snapshot());
  const { snapshot, skipped } = importIfc(api, bytes);
  return { snapshot, skipped, bytes };
}

/** 외부 도구 IFC 흉내 — 손으로 쓴 최소 STEP 파일 (외부 규약 픽스처는 우리 exporter로 못 만듦) */
function stepFile(dataLines: string[]): Uint8Array {
  return new TextEncoder().encode(
    [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION((''),'2;1');",
      "FILE_NAME('','',(''),(''),'','','');",
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      ...dataLines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n'),
  );
}

describe('IFC 라운드트립', () => {
  it('벽 — 좌표/두께/방향 보존', () => {
    const s = sample();
    const { snapshot } = roundtrip(s);
    const origWalls = s.listElements().filter((e): e is WallElement => e.kind === 'wall');
    const imported = snapshot.elements.filter((e): e is WallElement => e.kind === 'wall');
    expect(imported).toHaveLength(origWalls.length);

    // 끝점 무순서 매칭 (a→b 방향까지)
    const key = (w: WallElement) => {
      const t = (id: string) => {
        const ty = s.getType(id) ?? snapshot.types.find((x) => x.id === id);
        return ty && 'thickness' in ty ? ty.thickness : 0;
      };
      return `${w.a}|${w.b}|${t(w.typeId)}`;
    };
    const origKeys = origWalls
      .map((w) => `${w.a}|${w.b}|${(s.getType(w.typeId) as { thickness: number }).thickness}`)
      .sort();
    const impKeys = imported
      .map((w) => `${w.a}|${w.b}|${(snapshot.types.find((t) => t.id === w.typeId) as { thickness: number }).thickness}`)
      .sort();
    expect(impKeys).toEqual(origKeys);
    void key;
  });

  it('슬라브 — 경계 폴리곤/두께 보존', () => {
    const s = sample();
    const { snapshot } = roundtrip(s);
    const slab = snapshot.elements.find((e): e is SlabElement => e.kind === 'slab')!;
    expect(slab).toBeDefined();
    expect(slab.boundary).toEqual([[0, 0], [4000, 0], [4000, 3000], [0, 3000]]);
    const st = snapshot.types.find((t) => t.id === slab.typeId)!;
    expect('thickness' in st && st.thickness).toBe(150);
  });

  it('레벨 — 이름/elevation 보존, 층고 추론', () => {
    const s = sample();
    const { snapshot } = roundtrip(s);
    const levels = [...snapshot.levels].sort((a, b) => a.elevation - b.elevation);
    expect(levels).toHaveLength(2);
    expect(levels[0]!.elevation).toBe(0);
    expect(levels[1]!.elevation).toBe(3000);
    expect(levels[0]!.height).toBe(3000); // 다음 층까지 = 3000
    expect(levels[0]!.name).toBe('1층');
  });

  it('개구부 — 문/창 종류·치수·호스트·offset 보존', () => {
    const s = sample();
    const { snapshot } = roundtrip(s);
    const ops = snapshot.elements.filter((e): e is OpeningElement => e.kind === 'opening');
    expect(ops).toHaveLength(2);

    const kinds = ops
      .map((o) => {
        const t = snapshot.types.find((x) => x.id === o.typeId)!;
        return t.kind === 'opening' ? t.opening.kind : '?';
      })
      .sort();
    expect(kinds).toEqual(['door', 'window']);

    // 각 개구부의 호스트 벽이 실제 벽인지 + offset 보존
    for (const o of ops) {
      const host = snapshot.elements.find((e) => e.id === o.hostId);
      expect(host?.kind).toBe('wall');
      expect([1500, 2000]).toContain(o.offset);
    }
    // 문 치수
    const door = ops.find((o) => {
      const t = snapshot.types.find((x) => x.id === o.typeId)!;
      return t.kind === 'opening' && t.opening.kind === 'door';
    })!;
    const dt = snapshot.types.find((x) => x.id === door.typeId)!;
    if (dt.kind === 'opening') {
      expect(dt.opening.width).toBe(900);
      expect(dt.opening.height).toBe(2100);
    }
  });

  it('범위 밖 offset 개구부 — 클램프 베이크 없이 원본 offset 보존', () => {
    const s = new DocStore();
    seedDocument(s);
    const wall = s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    // offset 100은 width 900 문에 대해 resolveOpening이 500으로 클램프하는 값
    s.createOpening({ hostId: wall, typeId: SEED_IDS.door900, offset: 100 });
    const { snapshot } = roundtrip(s);
    const op = snapshot.elements.find((e): e is OpeningElement => e.kind === 'opening')!;
    expect(op.offset).toBe(100); // 클램프된 500이 아니라 원본 100
  });

  it('baseOffset 있는 벽 (허리벽) — 보존', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0], baseOffset: 900, height: 1200 });
    const { snapshot } = roundtrip(s);
    const w = snapshot.elements.find((e): e is WallElement => e.kind === 'wall')!;
    expect(w.baseOffset).toBe(900);
    expect(w.height).toBe(1200);
  });

  it('대각선 벽 — 정수 끝점 보존', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [3000, 4000] }); // len=5000 정수
    s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall100, a: [1000, 500], b: [2730, 1230] }); // 비정수 len
    const { snapshot } = roundtrip(s);
    const walls = snapshot.elements.filter((e): e is WallElement => e.kind === 'wall');
    const keys = walls.map((w) => `${w.a}|${w.b}`).sort();
    expect(keys).toContain('0,0|3000,4000');
    // 비정수 길이도 끝점 반올림 오차 ≤ 1mm
    const diag = walls.find((w) => w.a[0] === 1000)!;
    expect(Math.abs(diag.b[0] - 2730)).toBeLessThanOrEqual(1);
    expect(Math.abs(diag.b[1] - 1230)).toBeLessThanOrEqual(1);
  });

  it('빈 문서 / 자유형 무시 — 깨지지 않음', () => {
    const s = new DocStore();
    seedDocument(s);
    const { snapshot } = roundtrip(s);
    expect(snapshot.elements).toHaveLength(0);
  });

  it('기둥 — IfcColumn으로 export (사각/원 단면)', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createColumn({ levelId: SEED_IDS.level, typeId: SEED_IDS.column400, at: [1000, 1000] });
    const circId = s.addType({
      kind: 'column',
      name: '원형 기둥 D500',
      section: { shape: 'circle', diameter: 500 },
      color: '#cccccc',
    });
    s.createColumn({ levelId: SEED_IDS.level, typeId: circId, at: [4000, 1000] });
    const bytes = exportIfc(api, s.snapshot());
    const m = api.OpenModel(bytes);
    expect(api.GetLineIDsWithType(m, WebIFC.IFCCOLUMN).size()).toBe(2);
    api.CloseModel(m);
  });

  it('기둥 — 왕복 시 위치/단면(비정사각 사각·원) 복원 (F5 역import)', () => {
    const s = new DocStore();
    seedDocument(s);
    // 비정사각(400×600) — width↔depth 전치 버그를 잡는다 (정사각이면 못 잡음)
    const rectId = s.addType({
      kind: 'column',
      name: '사각 기둥 400×600',
      section: { shape: 'rect', width: 400, depth: 600 },
      color: '#cccccc',
    });
    s.createColumn({ levelId: SEED_IDS.level, typeId: rectId, at: [1000, 1000] });
    const circId = s.addType({
      kind: 'column',
      name: '원형 기둥 D500',
      section: { shape: 'circle', diameter: 500 },
      color: '#cccccc',
    });
    s.createColumn({ levelId: SEED_IDS.level, typeId: circId, at: [4000, 1000], baseOffset: 200 });
    const { snapshot } = roundtrip(s);
    const cols = snapshot.elements.filter((e): e is ColumnElement => e.kind === 'column');
    expect(cols).toHaveLength(2);
    const sectionOf = (c: ColumnElement) => {
      const t = snapshot.types.find((x) => x.id === c.typeId);
      return t && t.kind === 'column' ? t.section : null;
    };
    const ats = cols.map((c) => `${c.at}`).sort();
    expect(ats).toEqual(['1000,1000', '4000,1000']);
    const circ = cols.find((c) => c.at[0] === 4000)!;
    expect(sectionOf(circ)).toEqual({ shape: 'circle', diameter: 500 });
    expect(circ.baseOffset).toBe(200);
    const rect = cols.find((c) => c.at[0] === 1000)!;
    // width=400·depth=600 정확 복원 (전치 시 600/400으로 깨짐)
    expect(sectionOf(rect)).toEqual({ shape: 'rect', width: 400, depth: 600 });
  });

  it('보 — IfcBeam으로 export', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createBeam({ levelId: SEED_IDS.level, typeId: SEED_IDS.beam300, a: [0, 0], b: [5000, 0] });
    s.createBeam({ levelId: SEED_IDS.level, typeId: SEED_IDS.beam300, a: [5000, 0], b: [5000, 4000] });
    const bytes = exportIfc(api, s.snapshot());
    const m = api.OpenModel(bytes);
    expect(api.GetLineIDsWithType(m, WebIFC.IFCBEAM).size()).toBe(2);
    api.CloseModel(m);
  });

  it('보 — 왕복 시 끝점(축 방향·길이)/단면 복원 (F5 역import)', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createBeam({ levelId: SEED_IDS.level, typeId: SEED_IDS.beam300, a: [0, 0], b: [5000, 0] });
    s.createBeam({ levelId: SEED_IDS.level, typeId: SEED_IDS.beam300, a: [5000, 0], b: [5000, 4000] });
    const { snapshot } = roundtrip(s);
    const beams = snapshot.elements.filter((e): e is BeamElement => e.kind === 'beam');
    expect(beams).toHaveLength(2);
    // 끝점 무순서 매칭 (a→b 방향까지, ≤1mm 반올림 허용)
    const segKey = (a: number[], b: number[]) => `${a}|${b}`;
    const keys = beams.map((bm) => segKey(bm.a, bm.b)).sort();
    expect(keys).toEqual([segKey([0, 0], [5000, 0]), segKey([5000, 0], [5000, 4000])].sort());
    // 단면 = beam300 (사각) 복원
    const t = snapshot.types.find((x) => x.id === beams[0]!.typeId);
    expect(t?.kind === 'beam' && t.section.shape).toBe('rect');
    const orig = s.getType(SEED_IDS.beam300);
    if (t?.kind === 'beam' && t.section.shape === 'rect' && orig?.kind === 'beam' && orig.section.shape === 'rect') {
      expect(t.section.width).toBe(orig.section.width);
      expect(t.section.depth).toBe(orig.section.depth);
    }
  });

  it('계단 — IfcStair로 export (스텝 솔리드 집합)', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createStair({ levelId: SEED_IDS.level, typeId: SEED_IDS.stair, a: [0, 0], b: [3000, 0] });
    const bytes = exportIfc(api, s.snapshot());
    const m = api.OpenModel(bytes);
    expect(api.GetLineIDsWithType(m, WebIFC.IFCSTAIR).size()).toBe(1);
    api.CloseModel(m);
  });

  it('난간 — IfcRailing으로 export (포스트+레일)', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createRailing({ levelId: SEED_IDS.level, typeId: SEED_IDS.railing, a: [0, 0], b: [3600, 0] });
    const bytes = exportIfc(api, s.snapshot());
    const m = api.OpenModel(bytes);
    expect(api.GetLineIDsWithType(m, WebIFC.IFCRAILING).size()).toBe(1);
    api.CloseModel(m);
  });

  it('지붕 — IfcSlab(ROOF)로 export, 재import 시 슬라브로 부활 안 함(스킵+카운트)', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createRoof({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.roof,
      boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
    });
    const bytes = exportIfc(api, s.snapshot());
    const m = api.OpenModel(bytes);
    // 슬라브 없이 지붕만 → IfcSlab 1개 (PredefinedType ROOF)
    expect(api.GetLineIDsWithType(m, WebIFC.IFCSLAB).size()).toBe(1);
    api.CloseModel(m);
    // 재import: 지붕은 v1 미지원 → 스킵+카운트, 슬라브로 오분류 안 됨 (kind 변경 방지)
    const { snapshot, skipped } = importIfc(api, bytes);
    expect(snapshot.elements.filter((e) => e.kind === 'slab')).toHaveLength(0);
    const roofKey = Object.keys(skipped).find((k) => k.includes('지붕'));
    expect(roofKey).toBeDefined();
    expect(skipped[roofKey!]).toBe(1);
  });

  it('지붕+바닥슬라브 공존 — 왕복 시 진짜 슬라브만 살아남음', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createSlab({ levelId: SEED_IDS.level, typeId: SEED_IDS.slab150, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
    s.createRoof({ levelId: SEED_IDS.level, typeId: SEED_IDS.roof, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
    const { snapshot } = roundtrip(s);
    // 바닥 슬라브 1개만 import (지붕은 유령 슬라브로 오염 안 됨)
    expect(snapshot.elements.filter((e) => e.kind === 'slab')).toHaveLength(1);
  });

  it('IFC 파일이 유효 (재오픈 가능)', () => {
    const s = sample();
    const { bytes } = roundtrip(s);
    expect(new TextDecoder().decode(bytes.slice(0, 12))).toBe('ISO-10303-21');
    const m2 = api.OpenModel(bytes);
    expect(api.GetLineIDsWithType(m2, WebIFC.IFCWALLSTANDARDCASE).size()).toBe(4);
    api.CloseModel(m2);
  });
});

describe('IFC — hsection/polygon 단면 (커넥터 v0.4 S1)', () => {
  const H = { shape: 'hsection', width: 150, depth: 300, web: 7, flange: 9 } as const;

  it('H형강 보+기둥 — IFCISHAPEPROFILEDEF 4치수로 export', () => {
    const s = new DocStore();
    seedDocument(s);
    const bId = s.addType({ kind: 'beam', name: 'H보', section: H, color: '#ccc' });
    const cId = s.addType({ kind: 'column', name: 'H기둥', section: H, color: '#ccc' });
    s.createBeam({ levelId: SEED_IDS.level, typeId: bId, a: [0, 0], b: [5000, 0] });
    s.createColumn({ levelId: SEED_IDS.level, typeId: cId, at: [1000, 1000] });
    const bytes = exportIfc(api, s.snapshot());
    const m = api.OpenModel(bytes);
    const profs = api.GetLineIDsWithType(m, WebIFC.IFCISHAPEPROFILEDEF);
    expect(profs.size()).toBe(2);
    for (let i = 0; i < profs.size(); i++) {
      const p = api.GetLine(m, profs.get(i)) as unknown as Record<string, { value: number }>;
      expect(p['OverallWidth']!.value).toBe(150);
      expect(p['OverallDepth']!.value).toBe(300);
      expect(p['WebThickness']!.value).toBe(7);
      expect(p['FlangeThickness']!.value).toBe(9);
    }
    api.CloseModel(m);
  });

  it('H형강 왕복 — 보(회전 Position)·기둥(identity) 모두 단면 deep-equal (방향 양방향 핀)', () => {
    const s = new DocStore();
    seedDocument(s);
    const bId = s.addType({ kind: 'beam', name: 'H보', section: H, color: '#ccc' });
    const cId = s.addType({ kind: 'column', name: 'H기둥', section: H, color: '#ccc' });
    s.createBeam({ levelId: SEED_IDS.level, typeId: bId, a: [0, 0], b: [3000, 4000] }); // 대각 축까지
    s.createColumn({ levelId: SEED_IDS.level, typeId: cId, at: [1000, 1000] });
    const { snapshot } = roundtrip(s);
    const beam = snapshot.elements.find((e): e is BeamElement => e.kind === 'beam')!;
    const col = snapshot.elements.find((e): e is ColumnElement => e.kind === 'column')!;
    const bt = snapshot.types.find((t) => t.id === beam.typeId);
    const ct = snapshot.types.find((t) => t.id === col.typeId);
    expect(bt?.kind === 'beam' && bt.section).toEqual(H);
    expect(ct?.kind === 'column' && ct.section).toEqual(H);
    // 보 끝점도 보존 (Position 회전이 축 복원을 깨지 않음)
    expect(beam.a).toEqual([0, 0]);
    expect(Math.abs(beam.b[0] - 3000)).toBeLessThanOrEqual(1);
    expect(Math.abs(beam.b[1] - 4000)).toBeLessThanOrEqual(1);
  });

  it('polygon 기둥 — IfcArbitraryClosedProfileDef로 export, import는 미지원 카운트(크래시 없음)', () => {
    const s = new DocStore();
    seedDocument(s);
    const pId = s.addType({
      kind: 'column',
      name: '삼각기둥',
      section: { shape: 'polygon', points: [[-200, -200], [200, -200], [0, 300]] },
      color: '#ccc',
    });
    s.createColumn({ levelId: SEED_IDS.level, typeId: pId, at: [1000, 1000] });
    const bytes = exportIfc(api, s.snapshot());
    const m = api.OpenModel(bytes);
    expect(api.GetLineIDsWithType(m, WebIFC.IFCARBITRARYCLOSEDPROFILEDEF).size()).toBe(1);
    expect(api.GetLineIDsWithType(m, WebIFC.IFCCOLUMN).size()).toBe(1);
    api.CloseModel(m);
    const { snapshot, skipped } = importIfc(api, bytes);
    expect(snapshot.elements.filter((e) => e.kind === 'column')).toHaveLength(0);
    expect(skipped['column(미지원 표현)']).toBe(1);
  });

  it('외부 규약 보 — 솔리드 RefDirection 수평(0,1,0) = 스왑 없이 width/depth 그대로 (전치 방지)', () => {
    // 일반 외부 IFC 규약: 프로파일 X=수평 → XDim=width. 우리 export 규약(RefDirection(0,0,1))일 때만 스왑.
    const bytes = stepFile([
      "#1=IFCPROJECT('2O2Fr$t4X7Zf8NOew3FLOH',$,'ext',$,$,$,$,$,$);",
      '#10=IFCCARTESIANPOINT((1000.,2000.,300.));',
      '#11=IFCAXIS2PLACEMENT3D(#10,$,$);',
      '#12=IFCLOCALPLACEMENT($,#11);',
      '#20=IFCCARTESIANPOINT((0.,0.));',
      '#21=IFCAXIS2PLACEMENT2D(#20,$);',
      '#22=IFCRECTANGLEPROFILEDEF(.AREA.,$,#21,300.,600.);',
      '#30=IFCCARTESIANPOINT((0.,0.,0.));',
      '#31=IFCDIRECTION((1.,0.,0.));',
      '#32=IFCDIRECTION((0.,1.,0.));',
      '#33=IFCAXIS2PLACEMENT3D(#30,#31,#32);',
      '#34=IFCDIRECTION((0.,0.,1.));',
      '#35=IFCEXTRUDEDAREASOLID(#22,#33,#34,5000.);',
      "#40=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#35));",
      '#41=IFCPRODUCTDEFINITIONSHAPE($,$,(#40));',
      "#50=IFCBEAM('2O2Fr$t4X7Zf8NOew3FLOI',$,'B1',$,$,#12,#41,$,$);",
    ]);
    const { snapshot, skipped } = importIfc(api, bytes);
    const beam = snapshot.elements.find((e): e is BeamElement => e.kind === 'beam')!;
    expect(beam).toBeDefined();
    expect(beam.a).toEqual([1000, 2000]);
    expect(beam.b).toEqual([6000, 2000]); // Axis(1,0,0) × 5000
    expect(beam.zOffset).toBe(300);
    const t = snapshot.types.find((x) => x.id === beam.typeId);
    // 무조건 스왑이면 600×300으로 전치되던 케이스
    expect(t?.kind === 'beam' && t.section).toEqual({ shape: 'rect', width: 300, depth: 600 });
    expect(skipped['보(프로파일 회전 미지원)']).toBeUndefined();
  });

  it('외부 보 프로파일 자체 회전(비항등 2D RefDirection) — 스킵 카운트 + best-effort import (조용한 손실 금지)', () => {
    const bytes = stepFile([
      "#1=IFCPROJECT('2O2Fr$t4X7Zf8NOew3FLOH',$,'ext',$,$,$,$,$,$);",
      '#10=IFCCARTESIANPOINT((0.,0.,0.));',
      '#11=IFCAXIS2PLACEMENT3D(#10,$,$);',
      '#12=IFCLOCALPLACEMENT($,#11);',
      '#20=IFCCARTESIANPOINT((0.,0.));',
      '#23=IFCDIRECTION((0.707107,0.707107));', // 45° — 우리가 반영 못 하는 회전
      '#21=IFCAXIS2PLACEMENT2D(#20,#23);',
      '#22=IFCRECTANGLEPROFILEDEF(.AREA.,$,#21,300.,600.);',
      '#30=IFCCARTESIANPOINT((0.,0.,0.));',
      '#31=IFCDIRECTION((1.,0.,0.));',
      '#32=IFCDIRECTION((0.,1.,0.));',
      '#33=IFCAXIS2PLACEMENT3D(#30,#31,#32);',
      '#34=IFCDIRECTION((0.,0.,1.));',
      '#35=IFCEXTRUDEDAREASOLID(#22,#33,#34,4000.);',
      "#40=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#35));",
      '#41=IFCPRODUCTDEFINITIONSHAPE($,$,(#40));',
      "#50=IFCBEAM('2O2Fr$t4X7Zf8NOew3FLOI',$,'B1',$,$,#12,#41,$,$);",
    ]);
    const { snapshot, skipped } = importIfc(api, bytes);
    expect(skipped['보(프로파일 회전 미지원)']).toBe(1); // 카운트됨 = 조용하지 않음
    const beam = snapshot.elements.find((e) => e.kind === 'beam');
    expect(beam).toBeDefined(); // 그래도 best-effort 치수로 import
  });

  it('외부 불량 IShapeProfile 기둥(web≥width) — 전체 import 중단 없이 스킵+카운트, 나머지는 살아남음', () => {
    const bytes = stepFile([
      "#1=IFCPROJECT('2O2Fr$t4X7Zf8NOew3FLOH',$,'ext',$,$,$,$,$,$);",
      // 불량: WebThickness 150 ≥ OverallWidth 100 → store.addType validateSection throw 유발
      '#10=IFCCARTESIANPOINT((1000.,1000.,0.));',
      '#11=IFCAXIS2PLACEMENT3D(#10,$,$);',
      '#12=IFCLOCALPLACEMENT($,#11);',
      '#20=IFCCARTESIANPOINT((0.,0.));',
      '#21=IFCAXIS2PLACEMENT2D(#20,$);',
      '#22=IFCISHAPEPROFILEDEF(.AREA.,$,#21,100.,300.,150.,9.,$,$,$);',
      '#30=IFCCARTESIANPOINT((0.,0.,0.));',
      '#33=IFCAXIS2PLACEMENT3D(#30,$,$);',
      '#34=IFCDIRECTION((0.,0.,1.));',
      '#35=IFCEXTRUDEDAREASOLID(#22,#33,#34,3000.);',
      "#40=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#35));",
      '#41=IFCPRODUCTDEFINITIONSHAPE($,$,(#40));',
      "#50=IFCCOLUMN('2O2Fr$t4X7Zf8NOew3FLOJ',$,'C-bad',$,$,#12,#41,$,$);",
      // 정상 기둥 (rect 400×400) — 불량 기둥 뒤에서도 import되어야 함
      '#60=IFCCARTESIANPOINT((4000.,1000.,0.));',
      '#61=IFCAXIS2PLACEMENT3D(#60,$,$);',
      '#62=IFCLOCALPLACEMENT($,#61);',
      '#70=IFCRECTANGLEPROFILEDEF(.AREA.,$,#21,400.,400.);',
      '#75=IFCEXTRUDEDAREASOLID(#70,#33,#34,3000.);',
      "#80=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#75));",
      '#81=IFCPRODUCTDEFINITIONSHAPE($,$,(#80));',
      "#90=IFCCOLUMN('2O2Fr$t4X7Zf8NOew3FLOK',$,'C-ok',$,$,#62,#81,$,$);",
    ]);
    const { snapshot, skipped } = importIfc(api, bytes); // throw 없음 (이전엔 여기서 전체 abort + CloseModel 누락)
    expect(skipped['기둥(변환 실패)']).toBe(1);
    const cols = snapshot.elements.filter((e): e is ColumnElement => e.kind === 'column');
    expect(cols).toHaveLength(1);
    expect(cols[0]!.at).toEqual([4000, 1000]);
    const t = snapshot.types.find((x) => x.id === cols[0]!.typeId);
    expect(t?.kind === 'column' && t.section).toEqual({ shape: 'rect', width: 400, depth: 400 });
  });

  it('polygon 보 — (p,q)→(q,p) 프로필 좌표 export가 유효 IFC (재오픈 가능)', () => {
    const s = new DocStore();
    seedDocument(s);
    const pId = s.addType({
      kind: 'beam',
      name: '다각보',
      section: { shape: 'polygon', points: [[-150, -300], [150, -300], [150, 300], [-150, 300]] },
      color: '#ccc',
    });
    s.createBeam({ levelId: SEED_IDS.level, typeId: pId, a: [0, 0], b: [5000, 0] });
    const bytes = exportIfc(api, s.snapshot());
    const m = api.OpenModel(bytes);
    expect(api.GetLineIDsWithType(m, WebIFC.IFCARBITRARYCLOSEDPROFILEDEF).size()).toBe(1);
    expect(api.GetLineIDsWithType(m, WebIFC.IFCBEAM).size()).toBe(1);
    api.CloseModel(m);
  });
});
