import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex, deriveColumn, sectionRing } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';
import { elementFootprint, footprintInRect } from '../src/select';
import type { ColumnElement, ColumnType } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

/** non-indexed 메시 부호 부피 — 솔리드 정합성 (닫힌 메시면 |V| = 실제 부피) */
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

describe('기둥 — 생성/파생', () => {
  it('createColumn + 시드 타입으로 솔리드 파생 (렌더됨)', () => {
    const { store, seed } = setup();
    const id = store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 2000] });
    const cache = new DeriveCache();
    const geo = cache.derive(store, id, buildDeriveIndex(store));
    expect(geo).not.toBeNull();
    expect(geo!.positions.length).toBeGreaterThan(0);
    // 400×400×3000 = 0.48㎥ (m 단위) — 닫힌 솔리드
    expect(Math.abs(signedVolume(geo!.positions))).toBeCloseTo(0.4 * 0.4 * 3.0, 3);
    // 앵커 = 베이스/상단 중심
    expect(geo!.anchors.a).toEqual([1.0, 0, 2.0]);
    expect(geo!.anchors.b).toEqual([1.0, 3.0, 2.0]);
  });

  it('원형 단면 = N각형 테셀레이션 (24각형)', () => {
    expect(sectionRing({ shape: 'rect', width: 200, depth: 300 })).toHaveLength(4);
    const circle = sectionRing({ shape: 'circle', diameter: 500 });
    expect(circle).toHaveLength(24);
    // 첫 점 = (r, 0)
    expect(circle[0]).toEqual([250, 0]);
  });

  it('deriveColumn 순수 — baseOffset/height 반영', () => {
    const level = { id: 'L', name: '1', elevation: 0, height: 3000, order: 0 };
    const type: ColumnType = { id: 'T', kind: 'column', name: 'c', section: { shape: 'rect', width: 400, depth: 400 }, color: '#fff' };
    const column: ColumnElement = { id: 'c1', kind: 'column', levelId: 'L', typeId: 'T', at: [0, 0], height: 2000, baseOffset: 500 };
    const geo = deriveColumn({ column, type, level });
    expect(geo.anchors.a[1]).toBeCloseTo(0.5); // 베이스 = elevation+baseOffset
    expect(geo.anchors.b[1]).toBeCloseTo(2.5); // 상단 = base + height
  });
});

describe('기둥 — 편집 ops (silent if-chain)', () => {
  it('move/duplicate/rotate가 at에 적용됨', () => {
    const { store, seed } = setup();
    const id = store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 1000] });

    store.moveElements([id], [500, -200]);
    expect((store.getElement(id) as ColumnElement).at).toEqual([1500, 800]);

    const [copyId] = store.duplicateElements([id], [1000, 0]);
    expect((store.getElement(copyId!) as ColumnElement).at).toEqual([2500, 800]);

    store.rotateElements([id], [0, 0], Math.PI / 2); // 90° CCW: (1500,800)→(-800,1500)
    expect((store.getElement(id) as ColumnElement).at).toEqual([-800, 1500]);
  });

  it('updateElement가 float 좌표/높이 양자화', () => {
    const { store, seed } = setup();
    const id = store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [0, 0] });
    store.updateElement(id, { at: [1500.5, 999.4], height: 2800.6 });
    const col = store.getElement(id) as ColumnElement;
    expect(col.at).toEqual([1501, 999]);
    expect(col.height).toBe(2801);
  });

  it('arrayElements 누적 복사', () => {
    const { store, seed } = setup();
    const id = store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [0, 0] });
    const created = store.arrayElements([id], [3000, 0], 3);
    expect(created).toHaveLength(3);
    const xs = created.map((c) => (store.getElement(c) as ColumnElement).at[0]).sort((a, b) => a - b);
    expect(xs).toEqual([3000, 6000, 9000]);
  });
});

describe('기둥 — lint/select', () => {
  it('깨끗한 기둥은 무경고, 중복은 감지', () => {
    const { store, seed } = setup();
    store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [0, 0] });
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
    store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [0, 0] }); // 동일 자리
    const dup = lint(store).filter((f) => f.code === 'duplicate');
    expect(dup).toHaveLength(1);
  });

  it('박스 선택 풋프린트 = 중심점', () => {
    const { store, seed } = setup();
    const id = store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [500, 500] });
    const fp = elementFootprint(store.getElement(id)!, store);
    expect(fp).toEqual({ kind: 'point', p: [500, 500] });
    expect(footprintInRect(fp, { minX: 0, minY: 0, maxX: 1000, maxY: 1000 })).toBe(true);
    expect(footprintInRect(fp, { minX: 600, minY: 0, maxX: 1000, maxY: 1000 })).toBe(false);
  });
});

describe('기둥 — capability (AI/op 경로)', () => {
  it('create_column 실행 + float 좌표 관용', () => {
    const { store, seed } = setup();
    const id = runCapability(store, 'create_column', {
      levelId: seed.levelId,
      typeId: seed.columnTypeId,
      at: [1200.5, 800.5],
    }) as string;
    expect((store.getElement(id) as ColumnElement).at).toEqual([1201, 801]);
  });
});
