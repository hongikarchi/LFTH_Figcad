// 디스크 기반 BlobStore (Node/Railway — R2 대체). 영속 볼륨 디렉토리에 key→파일.
// node:fs 의존 → **Node 서버에서만 import**(CF Worker 번들 금지). 인터페이스=store.ts, R2 구현=r2.ts.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { BlobStore, StoredBlob } from './store';

/** key 안전성: federation/<room>/... · projects/<room>/... 만, '..' 금지(경로 탈출 차단). */
function safeKey(key: string): boolean {
  if (key.includes('..') || key.includes('\0')) return false;
  return /^(federation|projects)\/[A-Za-z0-9_-]{1,64}\//.test(key);
}

export class DiskBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string | null {
    if (!safeKey(key)) return null;
    const full = path.resolve(this.root, key);
    // 정규화 후에도 root 안인지 재확인 (이중 가드)
    const base = path.resolve(this.root);
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    return full;
  }

  async get(key: string): Promise<StoredBlob | null> {
    const full = this.resolve(key);
    if (!full) return null;
    let buf: Buffer;
    try {
      buf = await fs.readFile(full);
    } catch {
      return null;
    }
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return {
      arrayBuffer: async () => ab,
      text: async () => buf.toString('utf8'),
      json: async () => JSON.parse(buf.toString('utf8')),
    };
  }

  async put(key: string, data: ArrayBuffer | Uint8Array | string, _contentType?: string): Promise<void> {
    const full = this.resolve(key);
    if (!full) throw new Error(`unsafe blob key: ${key}`);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data as ArrayBuffer);
    await fs.writeFile(full, body);
    // contentType은 디스크선 미저장 — federation/version이 ext/경로로 content-type 재유도(핸들러 책임).
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    if (!full) return;
    try {
      await fs.unlink(full);
    } catch {
      // 없는 파일 = no-op (GC 재시도 안전)
    }
  }
}
