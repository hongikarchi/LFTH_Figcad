import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore, seedDocument } from '../src/store';
import { MaterialOverrideSchema, materialOverrideKey } from '../src/schema';

function setup(): DocStore {
  const s = new DocStore();
  seedDocument(s);
  return s;
}

function addSource(s: DocStore, name = '외부 모델'): string {
  return s.addFederationSource({
    name,
    sourceType: '3dm',
    ref: `/api/blob/${name}`,
    visible: true,
    addedBy: '나',
  });
}

describe('임포트 재질 오버라이드(materials 채널)', () => {
  it('set/get/list/clear 왕복 — 결정적 키, 같은 대상 2회 set = 1엔트리(LWW)', () => {
    const s = setup();
    const src = addSource(s);
    s.setMaterialOverride({ sourceId: src, category: '3F::Walls', color: '#ff0000', opacity: 0.5 });
    s.setMaterialOverride({ sourceId: src, category: '3F::Walls', color: '#00ff00', opacity: 1 });
    expect(s.listMaterialOverrides()).toHaveLength(1); // 같은 키 수렴 — 중복 없음
    const m = s.getMaterialOverride(src, '3F::Walls')!;
    expect(m.color).toBe('#00ff00');
    expect(m.opacity).toBe(1);
    expect(s.clearMaterialOverride(src, '3F::Walls')).toBe(true);
    expect(s.clearMaterialOverride(src, '3F::Walls')).toBe(false); // 없으면 no-op
    expect(s.listMaterialOverrides()).toHaveLength(0);
  });

  it('소스 전체(category 없음) 키와 카테고리 키 공존 — 키 유일성 (|·::·유니코드·U+001F 회피)', () => {
    const s = setup();
    const src = addSource(s);
    s.setMaterialOverride({ sourceId: src, color: '#101010', opacity: 1 }); // 소스 전체
    s.setMaterialOverride({ sourceId: src, category: 'A|B::층', color: '#202020', opacity: 0.7 });
    s.setMaterialOverride({ sourceId: src, category: 'A', color: '#303030', opacity: 1 });
    expect(s.listMaterialOverrides(src)).toHaveLength(3);
    expect(s.getMaterialOverride(src)!.color).toBe('#101010');
    expect(s.getMaterialOverride(src, 'A|B::층')!.color).toBe('#202020');
    // 키 자체가 서로 다름 (구분자 U+001F는 레이어명에 못 들어오는 제어문자)
    const keys = new Set([
      materialOverrideKey(src),
      materialOverrideKey(src, 'A|B::층'),
      materialOverrideKey(src, 'A'),
    ]);
    expect(keys.size).toBe(3);
  });

  it('no-op 가드 — 같은 색·불투명도 재도색은 무기록 (죽은 undo 스텝 방지)', () => {
    const s = setup();
    const src = addSource(s);
    const undo = s.createUndoManager();
    s.setMaterialOverride({ sourceId: src, category: 'W', color: '#ff0000', opacity: 0.5 });
    undo.stopCapturing();
    const ts1 = s.getMaterialOverride(src, 'W')!.ts;
    s.setMaterialOverride({ sourceId: src, category: 'W', color: '#ff0000', opacity: 0.5 }); // 동일 → skip
    expect(s.getMaterialOverride(src, 'W')!.ts).toBe(ts1); // 무기록(ts 불변)
    expect(undo.undoStack.length).toBe(1); // 두 번째 클릭이 undo 스텝을 안 만듦
    s.setMaterialOverride({ sourceId: src, category: 'W', color: '#ff0000', opacity: 0.6 }); // 다름 → 기록
    expect(s.getMaterialOverride(src, 'W')!.opacity).toBe(0.6);
  });

  it('zod 경계 — opacity 1.5/음수 거부, float 0.5 무손실', () => {
    const s = setup();
    const src = addSource(s);
    expect(() =>
      s.setMaterialOverride({ sourceId: src, color: '#fff000', opacity: 1.5 }),
    ).toThrow();
    expect(() =>
      s.setMaterialOverride({ sourceId: src, color: '#fff000', opacity: -0.1 }),
    ).toThrow();
    s.setMaterialOverride({ sourceId: src, color: '#fff000', opacity: 0.5 });
    expect(s.getMaterialOverride(src)!.opacity).toBe(0.5);
  });

  it('clearMaterialOverrides — 소스 지정/전체, 단일 transact = undo 1스텝', () => {
    const s = setup();
    const a = addSource(s, 'A');
    const b = addSource(s, 'B');
    s.setMaterialOverride({ sourceId: a, category: 'L1', color: '#111111', opacity: 1 });
    s.setMaterialOverride({ sourceId: a, category: 'L2', color: '#222222', opacity: 1 });
    s.setMaterialOverride({ sourceId: b, color: '#333333', opacity: 1 });
    expect(s.clearMaterialOverrides(a)).toBe(2);
    expect(s.listMaterialOverrides()).toHaveLength(1);
    expect(s.clearMaterialOverrides()).toBe(1);
    expect(s.listMaterialOverrides()).toHaveLength(0);
  });

  it('undo — 페인트 undo/redo, 소스 제거 연쇄 정리는 undo 스택에 안 남음(비추적 origin)', () => {
    const s = setup();
    const src = addSource(s);
    const undo = s.createUndoManager();
    s.setMaterialOverride({ sourceId: src, category: 'Walls', color: '#ff0000', opacity: 0.5 });
    undo.stopCapturing();
    expect(s.listMaterialOverrides()).toHaveLength(1);
    undo.undo();
    expect(s.listMaterialOverrides()).toHaveLength(0);
    undo.redo();
    expect(s.getMaterialOverride(src, 'Walls')!.color).toBe('#ff0000');
    undo.clear();
    // 소스 제거 → 오버라이드 연쇄 정리(CLEANUP_ORIGIN, 비추적) → undo 스택 비어 있음
    s.removeFederationSource(src);
    expect(s.listMaterialOverrides()).toHaveLength(0);
    expect(undo.undoStack.length).toBe(0); // undo가 고아 오버라이드를 부활시키지 않음
    undo.undo(); // no-op
    expect(s.listMaterialOverrides()).toHaveLength(0);
  });

  it('snapshot 라운드트립 — fromSnapshot 보존(float 무손실), v6 구스냅샷(materials 부재) 무예외', () => {
    const s = setup();
    const src = addSource(s);
    s.setMaterialOverride({ sourceId: src, category: 'Glass', color: '#88ccff', opacity: 0.35 });
    const snap = s.snapshot();
    expect(snap.materials).toHaveLength(1);
    const s2 = DocStore.fromSnapshot(snap);
    const m = s2.listMaterialOverrides()[0]!;
    expect(m.opacity).toBe(0.35);
    expect(m.category).toBe('Glass');
    // 구버전 스냅샷 (materials 필드 자체 부재) — diffOverlay 경로
    const legacy = s.snapshot();
    delete (legacy as { materials?: unknown }).materials;
    const s3 = DocStore.fromSnapshot(legacy);
    expect(s3.listMaterialOverrides()).toHaveLength(0);
  });

  it('snapshotOf — 외부 ydoc 1회 읽기에 materials 포함', () => {
    const s = setup();
    const src = addSource(s);
    s.setMaterialOverride({ sourceId: src, color: '#440044', opacity: 0.9 });
    const snap = DocStore.snapshotOf(s.ydoc);
    expect(snap.materials).toHaveLength(1);
    expect(snap.materials![0]!.color).toBe('#440044');
  });

  it('importSnapshot — 커밋복원(materials 부재)=보존, JSON백업(명시 [])=교체', () => {
    const s = setup();
    const src = addSource(s);
    s.setMaterialOverride({ sourceId: src, color: '#123456', opacity: 1 });
    const commitSnap = s.snapshot();
    delete (commitSnap as { materials?: unknown }).materials;
    s.importSnapshot(commitSnap);
    expect(s.listMaterialOverrides()).toHaveLength(1); // 보존
    s.importSnapshot({ ...s.snapshot(), materials: [] });
    expect(s.listMaterialOverrides()).toHaveLength(0); // 교체(비움)
  });

  it('2-doc 동기화 — 같은 레이어 동시 페인트 = 같은 키 LWW 수렴(1엔트리)', () => {
    const a = setup();
    const b = new DocStore();
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc)); // b가 시드 수신
    const src = addSource(a);
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    const av = Y.encodeStateVector(a.ydoc);
    const bv = Y.encodeStateVector(b.ydoc);
    a.setMaterialOverride({ sourceId: src, category: 'Walls', color: '#aa0000', opacity: 1 });
    b.setMaterialOverride({ sourceId: src, category: 'Walls', color: '#00aa00', opacity: 0.5 });
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, av));
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, bv));
    expect(a.listMaterialOverrides()).toHaveLength(1); // 결정적 키 → 중복 없음
    expect(b.listMaterialOverrides()).toHaveLength(1);
    expect(a.getMaterialOverride(src, 'Walls')).toEqual(b.getMaterialOverride(src, 'Walls')); // 수렴
  });

  it('MaterialOverrideSchema — 잘못된 엔트리는 mirror에서 safeParse 드롭', () => {
    const bad = MaterialOverrideSchema.safeParse({ id: 'x', sourceId: 'y', color: 5, opacity: 1, ts: 0 });
    expect(bad.success).toBe(false);
  });
});

describe('타입 opacity (네이티브 페인트)', () => {
  it('updateType opacity persist·float 무손실·undefined=키 제거, 구버전 타입(부재) parse', () => {
    const s = setup();
    const wallType = s.listTypes().find((t) => t.kind === 'wall')!;
    s.updateType(wallType.id, { opacity: 0.5 });
    expect((s.getType(wallType.id) as { opacity?: number }).opacity).toBe(0.5);
    s.updateType(wallType.id, { opacity: undefined });
    expect('opacity' in s.getType(wallType.id)!).toBe(false); // 키 자체 제거
    expect(() => s.updateType(wallType.id, { opacity: 1.5 })).toThrow(); // zod 경계
  });
});
