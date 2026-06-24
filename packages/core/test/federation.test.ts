import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore, seedDocument } from '../src/store';
import { buildDeriveIndex, DeriveCache } from '../src/geometry';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

const src = (over: Partial<Parameters<DocStore['addFederationSource']>[0]> = {}) => ({
  name: '구조 모델',
  sourceType: 'figcad-room' as const,
  ref: 'room-abc',
  visible: true,
  addedBy: '소장',
  ...over,
});

describe('federation 채널 — CRUD', () => {
  it('addFederationSource → list/get, 가시성 토글, 제거', () => {
    const { store } = setup();
    const id = store.addFederationSource(src());
    expect(store.listFederationSources()).toHaveLength(1);
    const s = store.getFederationSource(id)!;
    expect(s.sourceType).toBe('figcad-room');
    expect(s.ref).toBe('room-abc');
    expect(s.visible).toBe(true);
    expect(typeof s.ts).toBe('number'); // ts 자동

    store.setSourceVisible(id, false);
    expect(store.getFederationSource(id)!.visible).toBe(false);

    store.removeFederationSource(id);
    expect(store.listFederationSources()).toHaveLength(0);
  });

  it('지오메트리 필드 없음 — ref만 (불변① 가드)', () => {
    const { store } = setup();
    const id = store.addFederationSource(src({ sourceType: 'ifc', ref: 'https://r2/x.ifc' }));
    const s = store.getFederationSource(id)! as Record<string, unknown>;
    expect(s.positions).toBeUndefined();
    expect(s.normals).toBeUndefined();
    expect(Object.keys(s).sort()).toEqual(
      ['addedBy', 'id', 'name', 'ref', 'sourceType', 'ts', 'visible'].sort(),
    );
  });
});

describe('federation 채널 — 스냅샷 4경로 라운드트립 + 구버전 호환', () => {
  it('snapshot/fromSnapshot/importSnapshot federation 보존', () => {
    const { store } = setup();
    store.addFederationSource(src());
    store.addFederationSource(src({ name: '설비', sourceType: 'gltf', ref: 'https://r2/m.glb' }));
    const snap = store.snapshot();
    expect(snap.federation).toHaveLength(2);

    const restored = DocStore.fromSnapshot(snap);
    expect(restored.listFederationSources()).toHaveLength(2);

    const s2 = new DocStore();
    seedDocument(s2);
    s2.importSnapshot(snap);
    expect(s2.listFederationSources()).toHaveLength(2);
  });

  it('snapshotOf(외부 ydoc)도 federation 포함', () => {
    const { store } = setup();
    store.addFederationSource(src());
    const snap = DocStore.snapshotOf(store.ydoc);
    expect(snap.federation).toHaveLength(1);
  });

  it("dxf 언더레이 — sourceType 'dxf' + underlay 배치가 4경로 보존(optional 필드 미탈락)", () => {
    const { store, seed } = setup();
    const id = store.addFederationSource(
      src({
        name: '평면도.dxf',
        sourceType: 'dxf',
        ref: 'https://r2/p.dxf',
        underlay: { levelId: seed.levelId, origin: [-12000, -8000], rotation: 0, scale: 1 },
      }),
    );
    const expectUnderlay = (s: import('../src/schema').FederationSource | undefined) => {
      expect(s?.sourceType).toBe('dxf');
      expect(s?.underlay).toEqual({
        levelId: seed.levelId,
        origin: [-12000, -8000],
        rotation: 0,
        scale: 1,
      });
    };
    expectUnderlay(store.getFederationSource(id)); // 라이브
    const snap = store.snapshot();
    expectUnderlay(DocStore.fromSnapshot(snap).getFederationSource(id)); // snapshot→fromSnapshot
    const s2 = new DocStore();
    seedDocument(s2);
    s2.importSnapshot(snap);
    expectUnderlay(s2.getFederationSource(id)); // importSnapshot
    // 메시 소스(underlay 부재)는 키셋 불변 — 불변① 가드 회귀 없음
    const meshId = store.addFederationSource(src({ sourceType: 'ifc', ref: 'r.ifc' }));
    const mesh = store.getFederationSource(meshId)! as Record<string, unknown>;
    expect(mesh.underlay).toBeUndefined();
  });

  it('커밋 복원(federation 부재) = 라이브 소스 보존 / JSON([])=교체 (코멘트와 동일 critical 가드)', () => {
    const { store } = setup();
    store.addFederationSource(src());
    const full = store.snapshot();
    // 커밋 blob엔 federation 없음(canonicalSnapshotJson 누락) → undefined로 복원
    store.importSnapshot({ ...full, federation: undefined });
    expect(store.listFederationSources()).toHaveLength(1); // 보존 (wipe 안 됨)
    // JSON 백업은 federation 명시 → 교체 ([] 면 비움)
    store.importSnapshot({ ...full, federation: [] });
    expect(store.listFederationSources()).toHaveLength(0);
  });

  it('v3 스냅샷(federation 부재, schemaVersion 3) import → throw 없음 + []', () => {
    const { store } = setup();
    const snap = store.snapshot();
    expect(() =>
      store.importSnapshot({
        ...snap,
        meta: { ...snap.meta, schemaVersion: 3 },
        federation: undefined,
      }),
    ).not.toThrow();
    expect(store.listFederationSources()).toEqual([]);
  });
});

describe('federation 채널 — 동시 추가 무클로버 (평면 엔트리)', () => {
  it('두 클라가 동시에 소스 추가 → 둘 다 생존', () => {
    const a = new DocStore();
    seedDocument(a);
    const b = new DocStore();
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    a.addFederationSource(src({ name: 'A모델', ref: 'room-a' }));
    b.addFederationSource(src({ name: 'B모델', ref: 'room-b' }));
    const av = Y.encodeStateVector(a.ydoc);
    const bv = Y.encodeStateVector(b.ydoc);
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, av));
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, bv));
    const namesA = a.listFederationSources().map((s) => s.name).sort();
    const namesB = b.listFederationSources().map((s) => s.name).sort();
    expect(namesA).toEqual(['A모델', 'B모델']);
    expect(namesB).toEqual(['A모델', 'B모델']);
  });
});

// A4 게이트 — figcad-room 추출 경로(snapshot→fromSnapshot→derive→메시)가 월드좌표를
// 보존하는지 *구조적으로* 검증. unit/scale/좌표 변환버그를 naive 스모크 전에 잡는다.
function meshStats(store: DocStore): { vertexCount: number; bbox: number[] } {
  const index = buildDeriveIndex(store);
  const cache = new DeriveCache();
  let vertexCount = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const consume = (pos: Float32Array) => {
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    vertexCount += pos.length / 3;
  };
  for (const el of store.listElements()) {
    const geo = cache.derive(store, el.id, index);
    if (!geo) continue;
    if (geo.positions.length) consume(geo.positions);
    if (geo.panels && geo.panels.positions.length) consume(geo.panels.positions);
  }
  return { vertexCount, bbox: [minX, minY, minZ, maxX, maxY, maxZ] };
}

describe('federation — A4 게이트: 추출 좌표 정합(bbox+vertex 일치)', () => {
  it('snapshot→fromSnapshot→derive 가 원본과 동일 bbox+vertex (월드미터 보존)', () => {
    const { store, seed } = setup();
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [4000, 0] });
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [4000, 0], b: [4000, 3000] });
    store.createSlab({
      levelId: seed.levelId,
      typeId: seed.slabTypeId,
      boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
    });
    store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 1000] });
    store.createCurtainWall({
      levelId: seed.levelId,
      typeId: seed.curtainWallTypeId,
      a: [0, 3000],
      b: [4000, 3000],
      uSpacing: 1000,
      vSpacing: 1500,
    });

    const original = meshStats(store);
    expect(original.vertexCount).toBeGreaterThan(0);
    // bbox는 월드 미터 — 4m 벽이면 x 범위 ~4. mm(4000)로 새지 않았음을 sanity 체크.
    expect(original.bbox[3]).toBeLessThan(100); // maxX < 100m (mm로 안 샘)
    expect(original.bbox[3]).toBeGreaterThan(1); // maxX > 1m (m로 정상)

    const overlay = meshStats(DocStore.fromSnapshot(store.snapshot()));
    expect(overlay.vertexCount).toBe(original.vertexCount);
    expect(overlay.bbox).toEqual(original.bbox);
  });
});
