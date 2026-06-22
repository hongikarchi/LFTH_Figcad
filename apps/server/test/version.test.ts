import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS } from '@figcad/core';
import { canonicalSnapshotJson, createCommit, isSafeRoom, sha256Hex } from '../src/handlers/version';
import { fakeStore } from './fakeStore';

/** 저장된 blob(Uint8Array) → JSON 파싱 (테스트 검사용). */
const readJson = (store: Map<string, Uint8Array>, key: string) =>
  JSON.parse(new TextDecoder().decode(store.get(key)!));

function snap(walls: number) {
  const s = new DocStore();
  seedDocument(s);
  for (let i = 0; i < walls; i++) {
    s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, i * 1000], b: [3000, i * 1000] });
  }
  return s.snapshot();
}

describe('canonicalSnapshotJson / sha256', () => {
  it('요소 순서·키 순서가 달라도 같은 해시', async () => {
    const a = snap(3);
    const b = structuredClone(a);
    b.elements.reverse();
    b.types.reverse();
    // 키 순서 교란
    b.elements = b.elements.map((e) => JSON.parse(JSON.stringify(e, Object.keys(e).sort().reverse())));
    expect(await sha256Hex(canonicalSnapshotJson(a))).toBe(await sha256Hex(canonicalSnapshotJson(b)));
  });

  it('내용이 다르면 다른 해시', async () => {
    expect(await sha256Hex(canonicalSnapshotJson(snap(1)))).not.toBe(
      await sha256Hex(canonicalSnapshotJson(snap(2))),
    );
  });
});

describe('isSafeRoom', () => {
  it('nanoid류 통과, 경로 주입 후보 거부', () => {
    expect(isSafeRoom('V1StGXR8_Z5jdHi6B-my')).toBe(true);
    expect(isSafeRoom('a/commits/x')).toBe(false);
    expect(isSafeRoom('..')).toBe(false);
    expect(isSafeRoom('')).toBe(false);
    expect(isSafeRoom('한글룸')).toBe(false);
    expect(isSafeRoom('x'.repeat(65))).toBe(false);
  });
});

describe('createCommit', () => {
  it('커밋 → log 갱신, 무변경 재커밋 → 스킵', async () => {
    const bucket = fakeStore();
    const s = snap(2);
    const r1 = await createCommit(bucket, 'room1', s, '작성자', '첫 커밋');
    expect(r1.skipped).toBe(false);
    expect(r1.meta!.parent).toBeNull();

    const r2 = await createCommit(bucket, 'room1', s, '작성자', '같은 내용');
    expect(r2.skipped).toBe(true);

    const log = readJson(bucket.store, 'projects/room1/log.json');
    expect(log.commits).toHaveLength(1);
    expect(log.head).toBe(r1.hash);
    // blob 존재 + 파싱 가능
    const blob = readJson(bucket.store, `projects/room1/commits/${r1.hash}.json`);
    expect(blob.elements).toHaveLength(2);
  });

  it('parent 체인 + 복원-재커밋(같은 해시 재등장) 허용', async () => {
    const bucket = fakeStore();
    const a = snap(1);
    const b = snap(2);
    const r1 = await createCommit(bucket, 'r', a, 'x', 'A');
    const r2 = await createCommit(bucket, 'r', b, 'x', 'B');
    expect(r2.meta!.parent).toBe(r1.hash);
    // A로 복원 후 커밋 — head(B)와 다르므로 기록되고 같은 해시가 재등장
    const r3 = await createCommit(bucket, 'r', a, 'x', 'A 복원');
    expect(r3.skipped).toBe(false);
    expect(r3.hash).toBe(r1.hash);
    const log = readJson(bucket.store, 'projects/r/log.json');
    expect(log.commits).toHaveLength(3);
    expect(log.commits[2].parent).toBe(r2.hash);
  });

  it('메시지/작성자 길이 제한 + 빈 값 기본', async () => {
    const bucket = fakeStore();
    const r = await createCommit(
      bucket,
      'r',
      snap(1),
      'A'.repeat(100),
      'B'.repeat(500),
    );
    expect(r.meta!.author).toHaveLength(40);
    expect(r.meta!.message).toHaveLength(200);
    const r2 = await createCommit(bucket, 'r', snap(2), '', '');
    expect(r2.meta!.author).toBe('익명');
    expect(r2.meta!.message).toBe('(메시지 없음)');
  });
});
