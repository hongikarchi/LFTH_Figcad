import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache, buildDeriveIndex, deriveDrawing, labelText } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';
import { elementFootprint } from '../src/select';
import type { LabelElement, WallElement } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

const RECT = [
  [0, 0],
  [4000, 0],
  [4000, 3000],
  [0, 3000],
] as [number, number][];

function deriveOf(store: DocStore, id: string) {
  return new DeriveCache().derive(store, id, buildDeriveIndex(store));
}

describe('레이블 — 템플릿별 텍스트', () => {
  it('area = 존 면적(㎡) + leader 세그먼트', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: '거실' });
    const lid = store.createLabel({ levelId: seed.levelId, at: [5000, 5000], targetId: zid, template: 'area', leader: true });
    const geo = deriveOf(store, lid);
    expect(geo!.labels?.[0]?.text).toBe('12.0㎡'); // 4000×3000 = 12㎡
    expect(geo!.edges.length).toBe(6); // leader 1 세그먼트 = 6 float
  });

  it('name = 존 번호+이름', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: '침실', number: '101' });
    const lid = store.createLabel({ levelId: seed.levelId, at: [0, 0], targetId: zid, template: 'name' });
    expect(deriveOf(store, lid)!.labels?.[0]?.text).toBe('101 침실');
  });

  it('custom = customText 그대로 (leader 없으면 edges 비움)', () => {
    const { store, seed } = setup();
    const lid = store.createLabel({ levelId: seed.levelId, at: [0, 0], template: 'custom', customText: 'N1' });
    const geo = deriveOf(store, lid);
    expect(geo!.labels?.[0]?.text).toBe('N1');
    expect(geo!.edges.length).toBe(0);
  });

  it('labelText — 타입 있는 요소는 타입명, 고아는 fallback', () => {
    const { store, seed } = setup();
    const wid = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [3000, 0] });
    const wall = store.getElement(wid) as WallElement;
    const tname = store.getType(wall.typeId)!.name;
    const mk = (extra: Partial<LabelElement>): LabelElement =>
      ({ id: 'x', kind: 'label', levelId: 'l', at: [0, 0], template: 'name', ...extra }) as LabelElement;
    expect(labelText(mk({ template: 'name' }), wall, store)).toBe(tname);
    expect(labelText(mk({ template: 'name', customText: '?' }), null, store)).toBe('?'); // 고아 fallback
    expect(labelText(mk({ template: 'area' }), null, store)).toBe('—'); // 고아 + customText 없음
  });
});

describe('레이블 — 타깃 추종 (재파생)', () => {
  it('존 boundary 변경 → area 텍스트 재파생 (키 폴드)', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    const lid = store.createLabel({ levelId: seed.levelId, at: [5000, 5000], targetId: zid, template: 'area' });
    const cache = new DeriveCache();
    const g1 = cache.derive(store, lid, buildDeriveIndex(store));
    expect(g1!.labels?.[0]?.text).toBe('12.0㎡');
    // 존을 키움: 4000×6000 = 24㎡
    store.updateElement(zid, { boundary: [[0, 0], [4000, 0], [4000, 6000], [0, 6000]] });
    const g2 = cache.derive(store, lid, buildDeriveIndex(store)); // 같은 캐시 — 키 변경으로 재파생
    expect(g2!.labels?.[0]?.text).toBe('24.0㎡');
    expect(g2).not.toBe(g1); // 새 객체 = 실제 재파생
  });

  it('존 이동 → leader 끝점이 새 중심 추종', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    const lid = store.createLabel({ levelId: seed.levelId, at: [5000, 5000], targetId: zid, template: 'area', leader: true });
    const cache = new DeriveCache();
    cache.derive(store, lid, buildDeriveIndex(store));
    store.moveElements([zid], [10000, 0]); // 중심 x 2000 → 12000
    const g2 = cache.derive(store, lid, buildDeriveIndex(store));
    expect(g2!.edges[3]).toBeCloseTo(12); // leader 끝 x = 12000mm = 12m (월드)
  });
});

describe('레이블 — 편집 ops (silent if-chain)', () => {
  it('move/duplicate at 적용 + 복사가 targetId/template 유지', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    const lid = store.createLabel({ levelId: seed.levelId, at: [100, 200], targetId: zid, template: 'area', leader: true });
    store.moveElements([lid], [50, 60]);
    expect((store.getElement(lid) as LabelElement).at).toEqual([150, 260]);
    const [cid] = store.duplicateElements([lid], [1000, 0]);
    const copy = store.getElement(cid!) as LabelElement;
    expect(copy.at).toEqual([1150, 260]);
    expect(copy.targetId).toBe(zid); // 바인딩 유지 (dimension과 달리 — 'area' 복사가 고아 안 됨)
    expect(copy.template).toBe('area');
  });

  it('rotate at 적용 + 양자화', () => {
    const { store, seed } = setup();
    const lid = store.createLabel({ levelId: seed.levelId, at: [1000, 0], template: 'custom', customText: 'x' });
    store.rotateElements([lid], [0, 0], Math.PI / 2);
    expect((store.getElement(lid) as LabelElement).at).toEqual([0, 1000]);
  });

  it('타깃+라벨 동시 복사 → 새 라벨이 복사된 타깃을 가리킴 (intra-set remap)', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    const lid = store.createLabel({ levelId: seed.levelId, at: [100, 100], targetId: zid, template: 'area', leader: true });
    const newIds = store.duplicateElements([zid, lid], [10000, 0]);
    const newZone = newIds.find((id) => store.getElement(id)!.kind === 'zone')!;
    const newLabel = newIds.find((id) => store.getElement(id)!.kind === 'label')!;
    expect((store.getElement(newLabel) as LabelElement).targetId).toBe(newZone); // 원본 zid 아님
    // 복사된 존만 키움 → 복사 라벨만 추종, 원본 라벨 불변 (독립)
    store.updateElement(newZone, { boundary: [[10000, 0], [14000, 0], [14000, 6000], [10000, 6000]] });
    expect(deriveOf(store, newLabel)!.labels?.[0]?.text).toBe('24.0㎡');
    expect(deriveOf(store, lid)!.labels?.[0]?.text).toBe('12.0㎡'); // 원본 영향 없음
  });

  it('타깃 미포함 복사 → 원본 targetId 유지 (name/area 퇴화 방지)', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    const lid = store.createLabel({ levelId: seed.levelId, at: [100, 100], targetId: zid, template: 'area' });
    const [copy] = store.duplicateElements([lid], [10000, 0]); // 라벨만 복사
    expect((store.getElement(copy!) as LabelElement).targetId).toBe(zid); // 원본 유지
    expect(deriveOf(store, copy!)!.labels?.[0]?.text).toBe('12.0㎡'); // 여전히 면적 표시
  });
});

describe('레이블 — 고아/lint/footprint/capability', () => {
  it('타깃 삭제 → 라벨 보존(연쇄삭제 X) + fallback + lint orphan-label', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    const lid = store.createLabel({ levelId: seed.levelId, at: [0, 0], targetId: zid, template: 'area', customText: '미정' });
    store.deleteElements([zid]);
    expect(store.getElement(lid)).toBeTruthy(); // 연쇄삭제 안 됨
    expect(deriveOf(store, lid)!.labels?.[0]?.text).toBe('미정'); // fallback
    expect(lint(store).filter((f) => f.code === 'orphan-label')).toHaveLength(1);
  });

  it('lint 클린 + 중복 감지', () => {
    const { store, seed } = setup();
    store.createLabel({ levelId: seed.levelId, at: [0, 0], template: 'custom', customText: 'A' });
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
    store.createLabel({ levelId: seed.levelId, at: [0, 0], template: 'custom', customText: 'A' });
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(1);
  });

  it('풋프린트 = at 점', () => {
    const { store, seed } = setup();
    const lid = store.createLabel({ levelId: seed.levelId, at: [300, 400], template: 'custom', customText: 'x' });
    expect(elementFootprint(store.getElement(lid)!, store)).toEqual({ kind: 'point', p: [300, 400] });
  });

  it('create_label capability (aiExposed) — 존 면적 라벨', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    const lid = runCapability(store, 'create_label', {
      levelId: seed.levelId,
      at: [5000, 5000],
      targetId: zid,
      template: 'area',
      leader: true,
    }) as string;
    const l = store.getElement(lid) as LabelElement;
    expect(l.template).toBe('area');
    expect(l.targetId).toBe(zid);
    expect(deriveOf(store, lid)!.labels?.[0]?.text).toBe('12.0㎡');
  });
});

describe('레이블 — 평면 도면 생성', () => {
  it('평면 도면에 라벨 텍스트 + leader proj 선 포함 (공유 labelText)', () => {
    const { store, seed } = setup();
    const zid = store.createZone({ levelId: seed.levelId, boundary: RECT, name: 'A' });
    store.createLabel({ levelId: seed.levelId, at: [5000, 5000], targetId: zid, template: 'area', leader: true });
    const viewId = store.createView({ name: '평면', type: 'plan', levelId: seed.levelId });
    const dr = deriveDrawing(store.getView(viewId)!, store);
    expect(dr.labels.some((l) => l.text === '12.0㎡')).toBe(true); // 3D와 동일 텍스트
    expect(dr.proj.some((p) => !p.closed && p.pts.length === 2)).toBe(true); // leader 지시선
  });
});
