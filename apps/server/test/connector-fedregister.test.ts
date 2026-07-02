import { describe, expect, it } from 'vitest';
import { DocStore } from '@figcad/core';
import { handleConnectorRequest } from '../src/handlers/apply';

const ROOM = 'demo';
const REF = `https://x/parties/doc/${ROOM}?op=fed-blob&key=${encodeURIComponent(`federation/${ROOM}/abc123.3dm`)}`;

async function fedRegister(
  store: DocStore,
  body: unknown,
  room = ROOM,
): Promise<{ status: number; json: any }> {
  const u = `https://x/parties/doc/${room}?op=fed-register`;
  const res = await handleConnectorRequest(
    new Request(u, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }),
    room,
    store,
    async () => {},
    undefined,
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('커넥터 ?op=fed-register (Lane-2 통과)', () => {
  it('유효 등록 → 200 {id} + federation 소스 추가', async () => {
    const store = new DocStore();
    expect(store.listFederationSources().length).toBe(0);
    const r = await fedRegister(store, { name: 'Lane-2 잔여 · PushBreps', sourceType: '3dm', ref: REF });
    expect(r.status).toBe(200);
    expect(typeof r.json.id).toBe('string');
    const srcs = store.listFederationSources();
    expect(srcs.length).toBe(1);
    expect(srcs[0].sourceType).toBe('3dm');
    expect(srcs[0].ref).toBe(REF);
    expect(srcs[0].visible).toBe(true);
    expect(srcs[0].addedBy).toContain('커넥터');
  });

  it('replace: 같은 name+sourceType 재등록 = 교체(1개 유지, 재푸시 멱등)', async () => {
    const store = new DocStore();
    await fedRegister(store, { name: 'Lane-2 잔여 · PushBreps', sourceType: '3dm', ref: REF, replace: 'lane2' });
    const REF2 = `https://x/parties/doc/${ROOM}?op=fed-blob&key=${encodeURIComponent(`federation/${ROOM}/def456.3dm`)}`;
    await fedRegister(store, { name: 'Lane-2 잔여 · PushBreps', sourceType: '3dm', ref: REF2, replace: 'lane2' });
    const srcs = store.listFederationSources();
    expect(srcs.length).toBe(1); // 중첩 안 됨
    expect(srcs[0].ref).toBe(REF2); // 최신으로 교체
  });

  it('다른 이름은 교체 안 함(각각 등록)', async () => {
    const store = new DocStore();
    await fedRegister(store, { name: 'Lane-2 A', sourceType: '3dm', ref: REF, replace: 'lane2' });
    await fedRegister(store, { name: 'Lane-2 B', sourceType: '3dm', ref: REF, replace: 'lane2' });
    expect(store.listFederationSources().length).toBe(2);
  });

  it('ref가 이 룸 fed-blob URL 아니면 400 (SSRF 방어)', async () => {
    const store = new DocStore();
    // 다른 룸의 key
    const badRoom = `https://x/parties/doc/${ROOM}?op=fed-blob&key=${encodeURIComponent('federation/other/x.3dm')}`;
    expect((await fedRegister(store, { name: 'x', sourceType: '3dm', ref: badRoom })).status).toBe(400);
    // op이 fed-blob 아님
    const badOp = `https://x/parties/doc/${ROOM}?op=apply&key=${encodeURIComponent(`federation/${ROOM}/x.3dm`)}`;
    expect((await fedRegister(store, { name: 'x', sourceType: '3dm', ref: badOp })).status).toBe(400);
    // .. 경로 이스케이프 시도
    const dotdot = `https://x/parties/doc/${ROOM}?op=fed-blob&key=${encodeURIComponent(`federation/${ROOM}/../secret.3dm`)}`;
    expect((await fedRegister(store, { name: 'x', sourceType: '3dm', ref: dotdot })).status).toBe(400);
    // 절대 URL 아님
    expect((await fedRegister(store, { name: 'x', sourceType: '3dm', ref: 'not a url' })).status).toBe(400);
    expect(store.listFederationSources().length).toBe(0);
  });

  it('잘못된 sourceType(enum 밖) → 400 (500 아님)', async () => {
    const store = new DocStore();
    const r = await fedRegister(store, { name: 'x', sourceType: 'exe', ref: REF });
    expect(r.status).toBe(400);
    expect(store.listFederationSources().length).toBe(0);
  });

  it('본문/필드 검증: 비JSON·name 누락·ref 누락 → 400', async () => {
    const store = new DocStore();
    expect((await fedRegister(store, 'not json{')).status).toBe(400);
    expect((await fedRegister(store, { sourceType: '3dm', ref: REF })).status).toBe(400); // name 없음
    expect((await fedRegister(store, { name: 'x', sourceType: '3dm' })).status).toBe(400); // ref 없음
  });
});
