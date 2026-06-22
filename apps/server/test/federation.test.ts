import { describe, expect, it } from 'vitest';
import { handleFederationBlob } from '../src/handlers/federation';
import type { BlobStore } from '../src/blob/store';
import { fakeStore } from './fakeStore';

const ROOM = 'demo';
const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

async function upload(store: BlobStore, room: string, body: ArrayBuffer, ext = 'glb', key?: string) {
  const u = `https://x/parties/doc/${room}?op=fed-upload&ext=${ext}${key ? `&key=${key}` : ''}`;
  return handleFederationBlob(
    new Request(u, { method: 'POST', body, headers: { 'content-length': String(body.byteLength) } }),
    room,
    store,
    key !== undefined ? 'SECRET' : undefined,
  );
}
async function blob(store: BlobStore, room: string, key: string) {
  return handleFederationBlob(
    new Request(`https://x/parties/doc/${room}?op=fed-blob&key=${encodeURIComponent(key)}`, { method: 'GET' }),
    room,
    store,
    undefined,
  );
}

describe('M13-F federation 페이로드 — 업로드/서빙 라운드트립', () => {
  it('업로드 → 같은 bytes 회수 (협업자 공유 가능)', async () => {
    const bucket = fakeStore();
    const payload = bytes('GLB-BINARY-CONTENT-여기');
    const up = await upload(bucket, ROOM, payload);
    expect(up.status).toBe(200);
    const { key, url } = (await up.json()) as { key: string; url: string };
    expect(key.startsWith(`federation/${ROOM}/`)).toBe(true);
    expect(url).toContain('op=fed-blob');

    const got = await blob(bucket, ROOM, key);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array(payload));
  });

  it('콘텐츠 해시 키 = dedup (같은 bytes 두 번 업로드 = 같은 key)', async () => {
    const bucket = fakeStore();
    const p = bytes('same');
    const a = (await (await upload(bucket, ROOM, p)).json()) as { key: string };
    const b = (await (await upload(bucket, ROOM, p)).json()) as { key: string };
    expect(a.key).toBe(b.key);
    expect(bucket.store.size).toBe(1);
  });

  it('보안: federation/<room>/ 밖 key 읽기 차단 (커밋 blob·타룸 누출 방지)', async () => {
    const bucket = fakeStore();
    bucket.store.set('commits/demo/secret.json', new Uint8Array(bytes('SECRET-COMMIT')));
    bucket.store.set('federation/other/x.glb', new Uint8Array(bytes('OTHER-ROOM')));
    expect((await blob(bucket, ROOM, 'commits/demo/secret.json')).status).toBe(400);
    expect((await blob(bucket, ROOM, 'federation/other/x.glb')).status).toBe(400);
    expect((await blob(bucket, ROOM, 'federation/demo/../../commits/demo/secret.json')).status).toBe(400);
  });

  it('ROOM_KEY 설정 시 업로드는 키 필요', async () => {
    const bucket = fakeStore();
    const noKey = await upload(bucket, ROOM, bytes('x'), 'glb', ''); // roomKey=SECRET, 잘못된 키('')
    expect(noKey.status).toBe(401);
  });
});
