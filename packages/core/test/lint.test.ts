import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore, lint, seedDocument, SEED_IDS, LINT_SEVERITY_RANK } from '../src';

/** 시드 + 정상 방(모서리 공유 벽 4 + 문 + 슬라브) — 깨끗한 기준 문서 */
function cleanRoom(): { store: DocStore; wallIds: string[] } {
  const store = new DocStore();
  seedDocument(store);
  const L = SEED_IDS.level;
  const T = SEED_IDS.wall200;
  const wallIds = [
    store.createWall({ levelId: L, typeId: T, a: [0, 0], b: [4000, 0] }),
    store.createWall({ levelId: L, typeId: T, a: [4000, 0], b: [4000, 3000] }),
    store.createWall({ levelId: L, typeId: T, a: [4000, 3000], b: [0, 3000] }),
    store.createWall({ levelId: L, typeId: T, a: [0, 3000], b: [0, 0] }),
  ];
  store.createOpening({ hostId: wallIds[0]!, typeId: SEED_IDS.door900, offset: 2000 });
  store.createSlab({
    levelId: L,
    typeId: SEED_IDS.slab150,
    boundary: [
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [0, 3000],
    ],
  });
  return { store, wallIds };
}

describe('lint — 깨끗한 문서', () => {
  it('정상 방은 무발견', () => {
    const { store } = cleanRoom();
    expect(lint(store)).toEqual([]);
  });

  it('빈 문서도 무발견', () => {
    const store = new DocStore();
    seedDocument(store);
    expect(lint(store)).toEqual([]);
  });

  it('lint()는 순수 — 문서 상태 무변경', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [40, 0] });
    const before = Y.encodeStateAsUpdate(store.ydoc);
    lint(store);
    expect(Y.encodeStateAsUpdate(store.ydoc)).toEqual(before);
  });
});

describe('lint — 깨진 참조', () => {
  it('고아 개구부 (호스트 삭제됨) → error + 삭제 fix', () => {
    const { store, wallIds } = cleanRoom();
    // deleteElements는 연쇄 삭제하므로 ydoc을 직접 조작하지 않고
    // 스냅샷 경유로 고아를 만든다: 벽만 빼고 재구성
    const snap = store.snapshot();
    snap.elements = snap.elements.filter((e) => e.id !== wallIds[0]);
    const broken = DocStore.fromSnapshot(snap);
    const found = lint(broken).filter((f) => f.code === 'orphan-opening');
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe('error');
    expect(found[0]!.fix?.deleteIds).toHaveLength(1);
  });

  it('존재하지 않는 레벨/타입 참조 → error', () => {
    const { store, wallIds } = cleanRoom();
    const snap = store.snapshot();
    const wall = snap.elements.find((e) => e.id === wallIds[1])!;
    (wall as { levelId: string }).levelId = 'L-ghost';
    const broken = DocStore.fromSnapshot(snap);
    const refs = lint(broken).filter((f) => f.code === 'missing-ref');
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0]!.severity).toBe('error');
    expect(refs[0]!.elementIds[0]).toBe(wallIds[1]);
  });

  it('타입 kind 불일치 (벽이 문 타입 참조) → error', () => {
    const { store, wallIds } = cleanRoom();
    const snap = store.snapshot();
    const wall = snap.elements.find((e) => e.id === wallIds[1])!;
    (wall as { typeId: string }).typeId = SEED_IDS.door900;
    const broken = DocStore.fromSnapshot(snap);
    expect(broken.getElement(wallIds[1]!)).toBeDefined();
    const refs = lint(broken).filter((f) => f.code === 'missing-ref');
    expect(refs).toHaveLength(1);
    expect(refs[0]!.message).toContain('종류 불일치');
  });
});

describe('lint — 개구부 적합성', () => {
  it('벽보다 큰 개구부 → 축소 표시 warning / 못 들어가는 벽 → error', () => {
    const { store } = cleanRoom();
    const shortWall = store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [10000, 0],
      b: [10600, 0], // 600mm 벽 — 900mm 문이 500mm로 축소 표시됨
    });
    store.createOpening({ hostId: shortWall, typeId: SEED_IDS.door900, offset: 300 });
    const tinyWall = store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [20000, 0],
      b: [20120, 0], // 120mm 벽 — 클램프해도 50mm 미만 → 표시 불가
    });
    store.createOpening({ hostId: tinyWall, typeId: SEED_IDS.door900, offset: 60 });
    const found = lint(store).filter((f) => f.code === 'opening-misfit');
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.severity).sort()).toEqual(['error', 'warning']);
  });

  it('벽 밖 offset → opening-clamped info', () => {
    const { store, wallIds } = cleanRoom();
    store.createOpening({ hostId: wallIds[0]!, typeId: SEED_IDS.door900, offset: 9999 });
    const found = lint(store).filter((f) => f.code === 'opening-clamped');
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe('info');
  });
});

describe('lint — 중복', () => {
  it('동일 벽 (방향 뒤집힘 포함) → duplicate warning + 삭제 fix', () => {
    const { store } = cleanRoom();
    const dup = store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [4000, 0], // 첫 벽의 b→a (뒤집힌 방향)
      b: [0, 0],
    });
    const found = lint(store).filter((f) => f.code === 'duplicate');
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe('warning');
    expect(found[0]!.fix?.deleteIds).toEqual([dup]);
  });

  it('같은 자리 같은 타입 개구부 2개 → duplicate', () => {
    const { store, wallIds } = cleanRoom();
    store.createOpening({ hostId: wallIds[0]!, typeId: SEED_IDS.door900, offset: 2000 });
    const found = lint(store).filter((f) => f.code === 'duplicate');
    expect(found).toHaveLength(1);
  });

  it('시작점/와인딩만 다른 동일 슬라브 → duplicate', () => {
    const { store } = cleanRoom();
    store.createSlab({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.slab150,
      boundary: [
        // 같은 사각형 — 다른 시작점 + 반대 와인딩
        [4000, 0],
        [0, 0],
        [0, 3000],
        [4000, 3000],
      ],
    });
    const found = lint(store).filter((f) => f.code === 'duplicate');
    expect(found).toHaveLength(1);
  });

  it('fix 삭제 → undo로 복원 가능 (LOCAL_ORIGIN)', () => {
    const store = new DocStore();
    seedDocument(store);
    const undo = store.createUndoManager();
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    undo.stopCapturing(); // captureTimeout 배칭 차단 — 실사용 타이밍 재현
    const dup = store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [4000, 0], b: [0, 0] });
    undo.stopCapturing();
    const finding = lint(store).find((f) => f.code === 'duplicate');
    expect(finding?.fix?.deleteIds).toEqual([dup]);
    store.deleteElements(finding!.fix!.deleteIds);
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(0);
    undo.undo();
    expect(store.getElement(dup)).toBeDefined();
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(1);
  });

  it('같은 자리 그리드 — 라벨이 달라도 중복', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createGridLine({ a: [0, 0], b: [0, 10000], label: 'A' });
    store.createGridLine({ a: [0, 0], b: [0, 10000], label: 'B' });
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(1);
  });

  it('높이가 다르면 중복 아님', () => {
    const { store } = cleanRoom();
    store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [0, 0],
      b: [4000, 0],
      height: 2400,
    });
    expect(lint(store).filter((f) => f.code === 'duplicate')).toHaveLength(0);
  });
});

describe('lint — 겹침 벽', () => {
  it('30mm 간격 평행 겹침 → overlap-wall warning', () => {
    const { store } = cleanRoom();
    store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall100,
      a: [1000, 30],
      b: [3000, 30], // 첫 벽(y=0)과 30mm 간격, 2000mm 겹침
    });
    const found = lint(store).filter((f) => f.code === 'overlap-wall');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('2000mm');
  });

  it('직각 벽·모서리 공유 체인은 겹침 아님 (정상 방 = 무발견으로 커버)', () => {
    const { store } = cleanRoom();
    // 동일선상이지만 끝점만 공유하는 연속 벽 — 겹침 길이 0
    store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [4000, 0],
      b: [8000, 0],
    });
    expect(lint(store).filter((f) => f.code === 'overlap-wall')).toHaveLength(0);
  });

  it('같은 선상 완전 일치 — 타입이 다르면 duplicate 대신 overlap으로 잡음 (미탐 방지)', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall100, a: [0, 0], b: [4000, 0] });
    const found = lint(store);
    expect(found.filter((f) => f.code === 'duplicate')).toHaveLength(0);
    expect(found.filter((f) => f.code === 'overlap-wall')).toHaveLength(1);
  });

  it('수직 분리된 같은 자리 벽(문 위 인방벽)은 겹침 아님', () => {
    const store = new DocStore();
    seedDocument(store);
    // 허리벽 (바닥~900) + 그 위 고창 위 인방벽 (2100~3000) — 평면상 같은 위치
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [3000, 0], height: 900 });
    store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [0, 0],
      b: [3000, 0],
      baseOffset: 2100,
      height: 900,
    });
    expect(lint(store).filter((f) => f.code === 'overlap-wall')).toHaveLength(0);
    // 수직으로 겹치면 (0~3000 vs 2100~3000) 경고
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall100, a: [0, 30], b: [3000, 30] });
    expect(lint(store).filter((f) => f.code === 'overlap-wall').length).toBeGreaterThanOrEqual(1);
  });

  it('100mm 떨어진 평행 벽(이중벽)은 허용', () => {
    const { store } = cleanRoom();
    store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall100,
      a: [0, 200],
      b: [4000, 200], // 중심선 간격 200mm > 50mm
    });
    expect(lint(store).filter((f) => f.code === 'overlap-wall')).toHaveLength(0);
  });
});

describe('lint — 미접합 끝점', () => {
  it('15mm 갭 → unjoined-endpoint warning (쌍당 1건)', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [3000, 0] });
    store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [3015, 0], // 15mm 갭
      b: [3015, 3000],
    });
    const found = lint(store).filter((f) => f.code === 'unjoined-endpoint');
    expect(found).toHaveLength(1); // 대칭 중복 제거
    expect(found[0]!.message).toContain('15mm');
  });

  it('중복 벽이 있어도 인접 15mm 갭은 계속 잡힘 (일치 끝점이 갭을 가리면 안 됨)', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [3000, 0] });
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [3015, 0], b: [3015, 3000] });
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [3000, 0] }); // 중복
    const found = lint(store);
    expect(found.filter((f) => f.code === 'duplicate')).toHaveLength(1);
    expect(found.filter((f) => f.code === 'unjoined-endpoint')).toHaveLength(1);
  });

  it('벽 몸체 15mm 미달 (T자 미접합) → warning', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [2000, 15], // 첫 벽 몸체에서 15mm 떠 있음
      b: [2000, 3000],
    });
    const found = lint(store).filter((f) => f.code === 'unjoined-endpoint');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('몸체');
  });

  it('정확한 T자 접합이 다른 벽 모서리 250mm 이내여도 오탐 없음', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [200, 0], // 첫 벽 몸체 위 정확히 (d=0) — 유효한 T자, 단 w1.a에서 200mm
      b: [200, 3000],
    });
    expect(lint(store).filter((f) => f.code === 'unjoined-endpoint')).toHaveLength(0);
  });

  it('정확한 모서리 공유·정확한 T자·250mm 초과 갭은 무발견', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [4000, 0], b: [4000, 3000] }); // 정확 공유
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [2000, 0], b: [2000, 3000] }); // 정확 T자
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 5000], b: [4000, 5000] }); // 멀리 독립
    expect(lint(store).filter((f) => f.code === 'unjoined-endpoint')).toHaveLength(0);
  });
});

describe('lint — 극단 치수', () => {
  it('100mm 미만 벽 → warning + 삭제 fix', () => {
    const store = new DocStore();
    seedDocument(store);
    const stub = store.createWall({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.wall200,
      a: [0, 0],
      b: [40, 0],
    });
    const found = lint(store).filter((f) => f.code === 'extreme-dimension');
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0]!.fix?.deleteIds).toEqual([stub]);
  });

  it('극소 슬라브 (0.0025㎡) → warning', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createSlab({
      levelId: SEED_IDS.level,
      typeId: SEED_IDS.slab150,
      boundary: [
        [0, 0],
        [50, 0],
        [50, 50],
        [0, 50],
      ],
    });
    const found = lint(store).filter((f) => f.code === 'extreme-dimension');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('슬라브');
  });

  it('높이 100mm 벽 → warning, 15000mm 벽 → info', () => {
    const store = new DocStore();
    seedDocument(store);
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [3000, 0], height: 100 });
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 5000], b: [3000, 5000], height: 15000 });
    const found = lint(store).filter((f) => f.code === 'extreme-dimension');
    expect(found.map((f) => f.severity).sort()).toEqual(['info', 'warning']);
  });
});

describe('lint — 정렬', () => {
  it('error → warning → info 순서로 반환', () => {
    const { store, wallIds } = cleanRoom();
    // info: 클램프된 개구부
    store.createOpening({ hostId: wallIds[0]!, typeId: SEED_IDS.door900, offset: 9999 });
    // warning: 중복 벽
    store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    // error: 고아 개구부 (스냅샷 조작)
    const snap = store.snapshot();
    snap.elements.push({
      id: 'ghost-op',
      kind: 'opening',
      typeId: SEED_IDS.door900,
      hostId: 'no-such-wall',
      offset: 500,
    });
    const broken = DocStore.fromSnapshot(snap);
    const ranks = lint(broken).map((f) => LINT_SEVERITY_RANK[f.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(3); // 세 심각도 전부 존재
  });
});
