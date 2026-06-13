import { beforeAll, describe, expect, it } from 'vitest';
import * as WebIFC from 'web-ifc';
import {
  DocStore,
  seedDocument,
  SEED_IDS,
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
