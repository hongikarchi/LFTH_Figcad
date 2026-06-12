import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore, seedDocument } from '../src/store';

/**
 * 두 doc을 양방향 라이브 연결 (로컬 WebSocket 대체).
 * 실제 프로바이더의 접속 시 전체 상태 교환(syncStep1/2)에 해당하는 초기 merge 포함 —
 * 없으면 상대 히스토리에 의존하는 업데이트가 pending으로 보류된다.
 */
function connect(a: Y.Doc, b: Y.Doc): void {
  merge(a, b);
  a.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'sync-b') Y.applyUpdate(b, u, 'sync-a');
  });
  b.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'sync-a') Y.applyUpdate(a, u, 'sync-b');
  });
}

/** 오프라인 편집 후 일괄 병합 */
function merge(a: Y.Doc, b: Y.Doc): void {
  const ua = Y.encodeStateAsUpdate(a);
  const ub = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, ub);
  Y.applyUpdate(b, ua);
}

function pair() {
  const sa = new DocStore();
  const sb = new DocStore();
  const seedA = seedDocument(sa);
  seedDocument(sb);
  return { sa, sb, seed: seedA };
}

describe('DocStore 동기화 (Yjs)', () => {
  it('고정 id 시드 — 양쪽이 독립 시드 후 병합해도 레벨 1개/타입 2개', () => {
    const { sa, sb } = pair();
    merge(sa.ydoc, sb.ydoc);
    expect(sa.listLevels()).toHaveLength(1);
    expect(sa.listTypes('wall')).toHaveLength(2);
    expect(sb.listLevels()).toHaveLength(1);
    expect(sb.listTypes('wall')).toHaveLength(2);
  });

  it('라이브 연결 — A가 만든 벽이 B 미러에 나타난다', () => {
    const { sa, sb, seed } = pair();
    connect(sa.ydoc, sb.ydoc);
    const id = sa.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [4000, 0],
    });
    const wall = sb.getElement(id);
    expect(wall?.kind).toBe('wall');
  });

  it('동시 편집 다른 필드 — A 끝점 + B 높이 둘 다 생존 (필드별 LWW)', () => {
    const { sa, sb, seed } = pair();
    merge(sa.ydoc, sb.ydoc);
    const id = sa.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [4000, 0],
    });
    merge(sa.ydoc, sb.ydoc);

    // 오프라인 동시 편집
    sa.updateElement(id, { b: [5000, 0] });
    sb.updateElement(id, { height: 2400 });
    merge(sa.ydoc, sb.ydoc);

    for (const s of [sa, sb]) {
      const w = s.getElement(id);
      expect(w?.kind).toBe('wall');
      if (w?.kind === 'wall') {
        expect(w.b).toEqual([5000, 0]); // A의 편집
        expect(w.height).toBe(2400); // B의 편집
      }
    }
  });

  it('같은 필드 경합 — LWW로 양쪽 수렴 (값 동일)', () => {
    const { sa, sb, seed } = pair();
    merge(sa.ydoc, sb.ydoc);
    const id = sa.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [4000, 0],
    });
    merge(sa.ydoc, sb.ydoc);

    sa.updateElement(id, { height: 2100 });
    sb.updateElement(id, { height: 2700 });
    merge(sa.ydoc, sb.ydoc);
    merge(sa.ydoc, sb.ydoc);

    const ha = (sa.getElement(id) as { height?: number }).height;
    const hb = (sb.getElement(id) as { height?: number }).height;
    expect(ha).toBe(hb); // 어느 쪽이든 결정론적으로 같은 값
    expect([2100, 2700]).toContain(ha);
  });

  it('삭제가 편집을 이긴다', () => {
    const { sa, sb, seed } = pair();
    merge(sa.ydoc, sb.ydoc);
    const id = sa.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [4000, 0],
    });
    merge(sa.ydoc, sb.ydoc);

    sa.updateElement(id, { height: 2400 }); // A는 편집
    sb.deleteElements([id]); // B는 삭제
    merge(sa.ydoc, sb.ydoc);

    expect(sa.getElement(id)).toBeUndefined();
    expect(sb.getElement(id)).toBeUndefined();
  });

  it('사용자별 undo — A의 undo는 A의 벽만 되돌린다', () => {
    const { sa, sb, seed } = pair();
    connect(sa.ydoc, sb.ydoc);
    const undoA = sa.createUndoManager();

    const wallA = sa.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [4000, 0],
    });
    const wallB = sb.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 5000],
      b: [4000, 5000],
    });

    undoA.undo();
    expect(sa.getElement(wallA)).toBeUndefined(); // A 것만 사라짐
    expect(sa.getElement(wallB)).toBeDefined(); // B 것은 유지
    expect(sb.getElement(wallA)).toBeUndefined(); // 동기화됨
  });

  it('원격 변경도 observe 이벤트로 전달 (씬 reconciler 경로)', () => {
    const { sa, sb, seed } = pair();
    connect(sa.ydoc, sb.ydoc);
    const events: string[] = [];
    sb.observe((c) => {
      if (c.added.length) events.push('added');
      if (c.updated.length) events.push('updated');
      if (c.removed.length) events.push('removed');
    });
    const id = sa.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [4000, 0],
    });
    sa.updateElement(id, { height: 2400 });
    sa.deleteElements([id]);
    expect(events).toEqual(['added', 'updated', 'removed']);
  });

  it('시드는 undo 대상이 아니다', () => {
    const sa = new DocStore();
    const undoA = sa.createUndoManager();
    seedDocument(sa);
    expect(undoA.canUndo()).toBe(false);
  });
});
