import { describe, expect, it, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DiskBlobStore } from '../src/blob/disk';

const root = path.join(os.tmpdir(), `figcad-blob-test-${process.pid}`);
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('DiskBlobStore — R2 대체 (Node/Railway)', () => {
  it('put → get 라운드트립 (bytes·문자열·json)', async () => {
    const s = new DiskBlobStore(root);
    await s.put('federation/demo/a.glb', new Uint8Array([1, 2, 3]), 'model/gltf-binary');
    const got = await s.get('federation/demo/a.glb');
    expect(got).not.toBeNull();
    expect(new Uint8Array(await got!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    await s.put('projects/demo/log.json', JSON.stringify({ head: 'h', commits: [] }), 'application/json');
    expect((await (await s.get('projects/demo/log.json'))!.json())).toEqual({ head: 'h', commits: [] });
  });

  it('없는 key = null', async () => {
    const s = new DiskBlobStore(root);
    expect(await s.get('federation/demo/missing.glb')).toBeNull();
  });

  it('프리픽스 가드 — federation/projects 밖 + .. 차단', async () => {
    const s = new DiskBlobStore(root);
    // 허용 안 된 프리픽스 → get null, put throw
    expect(await s.get('secrets/x')).toBeNull();
    await expect(s.put('secrets/x', 'nope')).rejects.toThrow();
    // 경로 탈출 차단
    expect(await s.get('federation/demo/../../etc/passwd')).toBeNull();
    await expect(s.put('federation/demo/../escape', 'nope')).rejects.toThrow();
    // 룸 이름 형식 위반
    expect(await s.get('federation//x')).toBeNull();
  });
});
