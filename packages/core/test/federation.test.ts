import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';

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
