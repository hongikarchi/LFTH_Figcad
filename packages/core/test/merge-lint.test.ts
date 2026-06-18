import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore, seedDocument, SEED_IDS, type DocChange } from '../src/store';
import { lint, findingsOn } from '../src/lint';

// M13-B 협업 병합 lint 알림 — DocChange.remote(원격 머지 구분) + findingsOn(머지된 ids 한정).

describe('DocChange.remote — 원격 머지 출신 구분', () => {
  it('로컬 변경 = remote false, 원격 머지 = remote true', () => {
    const a = new DocStore();
    seedDocument(a);
    const b = new DocStore();
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc)); // b가 시드를 받음(초기 로드 — live 전)
    b.setLive(); // 초기 동기화 완료 — 이후 비로컬 변경만 '원격 머지'

    let last: DocChange | null = null;
    b.observe((c) => {
      if (c.added.length || c.updated.length || c.removed.length) last = c;
    });

    // b의 로컬 변경 → remote false
    b.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [3000, 0] });
    expect(last).not.toBeNull();
    expect(last!.remote).toBe(false);

    // a의 변경을 b에 머지 → remote true
    a.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 1000], b: [3000, 1000] });
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)));
    expect(last!.remote).toBe(true);
  });

  it('초기 로드(live 전)·등록된 로컬 origin(undo/캐시) = remote 아님 — 오탐 가드(리뷰)', () => {
    const a = new DocStore();
    seedDocument(a);
    a.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [3000, 0] });
    const b = new DocStore();
    // 불리언만 캡처(객체 last? 클로저-narrowing 회피) — remote 플래그 자체가 관심사.
    let lastRemote: boolean | undefined;
    b.observe((c) => {
      if (c.added.length || c.updated.length || c.removed.length) lastRemote = c.remote;
    });

    // 1) live 전 초기 로드(캐시/서버 sync) = 원격 아님 — 첫 로드 시 기존 요소 가짜 배너 방지
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    expect(lastRemote ?? false).toBe(false);

    // 2) live 후, 등록된 로컬 origin(undo manager·indexeddb 흉내) = 원격 아님
    b.setLive();
    const localOrigin = { kind: 'undo-or-cache' };
    b.registerLocalOrigin(localOrigin);
    a.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 1000], b: [3000, 1000] });
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), localOrigin);
    expect(lastRemote).toBe(false);

    // 3) live 후 비로컬 origin = 원격
    a.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 1500], b: [3000, 1500] });
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)));
    expect(lastRemote).toBe(true);
  });
});

describe('협업 병합 유효성 — findingsOn이 머지로 생긴 겹침을 잡는다', () => {
  it('각 fork엔 겹침 없으나 머지 후 overlap-wall — 머지된 id로 스코프해 검출', () => {
    const a = new DocStore();
    seedDocument(a);
    const b = new DocStore();
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));

    // 각 피어가 벽 하나씩 — 각자엔 겹침 없음 (30mm 측면 평행, 한쪽엔 한 벽뿐)
    a.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const wB = b.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 30], b: [4000, 30] });
    expect(lint(a).some((f) => f.code === 'overlap-wall')).toBe(false);
    expect(lint(b).some((f) => f.code === 'overlap-wall')).toBe(false);

    // 상호 머지
    const av = Y.encodeStateVector(a.ydoc);
    const bv = Y.encodeStateVector(b.ydoc);
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, av));
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, bv));

    // 머지 결과 = 두 평행벽 겹침 → overlap-wall 출현 (수렴했으나 무효 = 경로A 핵심 케이스)
    const merged = lint(a);
    expect(merged.some((f) => f.code === 'overlap-wall')).toBe(true);

    // a 관점에서 원격 머지된 벽(wB)로 스코프 → 그 겹침을 잡는다 (LintPanel 배너가 쓸 경로)
    const flagged = findingsOn(merged, new Set([wB]));
    expect(flagged.some((f) => f.code === 'overlap-wall')).toBe(true);
    // 무관한 id로 스코프하면 안 잡힘
    expect(findingsOn(merged, new Set(['nope'])).length).toBe(0);
  });
});
