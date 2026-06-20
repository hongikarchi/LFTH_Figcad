import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS, rebaseSnapshot, type DocSnapshot } from '../src/store';
import type { Element, WallElement, SlabElement, ColumnElement } from '../src/schema';

// M13 projectOrigin — 부지좌표 recenter + 기억 → export 원좌표 복원 (Revit Project Base Point 패턴).

function siteSnapshot(): DocSnapshot {
  // 원좌표(부지, -1.9M 부근) 요소들 + projectOrigin 미설정(원좌표 그대로)
  const s = new DocStore();
  seedDocument(s);
  s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [-1900000, -89000], b: [-1896000, -89000] });
  s.createColumn({ levelId: SEED_IDS.level, typeId: SEED_IDS.column400, at: [-1899000, -88000] });
  s.createSlab({ levelId: SEED_IDS.level, typeId: SEED_IDS.slab150, boundary: [[-1900000, -89000], [-1896000, -89000], [-1896000, -85000], [-1900000, -85000]] });
  return s.snapshot();
}

describe('projectOrigin — meta 영속 + snapshot 4경로', () => {
  it('setProjectOrigin → meta·snapshot·라운드트립 보존, [0,0]=제거', () => {
    const s = new DocStore();
    seedDocument(s);
    s.setProjectOrigin([-1900000, -89000]);
    expect(s.getProjectOrigin()).toEqual([-1900000, -89000]);
    expect(s.snapshot().meta.projectOrigin).toEqual([-1900000, -89000]);

    const restored = DocStore.fromSnapshot(s.snapshot());
    expect(restored.getProjectOrigin()).toEqual([-1900000, -89000]);

    const s2 = new DocStore();
    seedDocument(s2);
    s2.importSnapshot(s.snapshot());
    expect(s2.getProjectOrigin()).toEqual([-1900000, -89000]);

    s.setProjectOrigin(null);
    expect(s.getProjectOrigin()).toBeNull();
    expect(s.snapshot().meta.projectOrigin).toBeUndefined();
  });

  it('구버전(projectOrigin 부재) snapshot import → null, throw 없음', () => {
    const s = new DocStore();
    seedDocument(s);
    const snap = s.snapshot();
    expect(() => s.importSnapshot({ ...snap, meta: { ...snap.meta, schemaVersion: 4, projectOrigin: undefined } })).not.toThrow();
    expect(s.getProjectOrigin()).toBeNull();
  });
});

describe('rebaseSnapshot — import(-1)/export(+1) 라운드트립 무손실 (advisor 게이트)', () => {
  it('원좌표 → recenter(-) → 원점근처 저장 → export(+) → 원좌표 정확 복원', () => {
    const site = siteSnapshot();
    const origin: [number, number] = [-1900000, -89000];

    // import: origin 설정 + 좌표 빼기 (원점근처로)
    const centered = rebaseSnapshot({ ...site, meta: { ...site.meta, projectOrigin: origin } }, -1);
    const cWall = centered.elements.find((e) => e.kind === 'wall') as WallElement;
    expect(cWall.a).toEqual([0, 0]); // -1900000 - (-1900000) = 0
    expect(cWall.b).toEqual([4000, 0]);
    expect(centered.meta.projectOrigin).toEqual(origin); // import는 origin 기억

    // export: 좌표 더하기 → 원좌표 복원, origin 소비
    const back = rebaseSnapshot(centered, 1);
    const bWall = back.elements.find((e) => e.kind === 'wall') as WallElement;
    const oWall = site.elements.find((e) => e.kind === 'wall') as WallElement;
    expect(bWall.a).toEqual(oWall.a); // 원좌표 정확 복원
    expect(bWall.b).toEqual(oWall.b);
    expect(back.meta.projectOrigin).toBeUndefined(); // export는 origin 소비

    // 모든 kind 좌표 복원 확인 (segment/polygon/point)
    const bSlab = back.elements.find((e) => e.kind === 'slab') as SlabElement;
    const oSlab = site.elements.find((e) => e.kind === 'slab') as SlabElement;
    expect(bSlab.boundary).toEqual(oSlab.boundary);
    const bCol = back.elements.find((e) => e.kind === 'column') as ColumnElement;
    const oCol = site.elements.find((e) => e.kind === 'column') as ColumnElement;
    expect(bCol.at).toEqual(oCol.at);
  });

  it('origin 없음/[0,0] = no-op (좌표 불변)', () => {
    const site = siteSnapshot();
    expect(rebaseSnapshot(site, -1)).toBe(site); // 원본 그대로 반환
    expect(rebaseSnapshot({ ...site, meta: { ...site.meta, projectOrigin: [0, 0] } }, -1).elements[0])
      .toEqual(site.elements[0]);
  });
});
