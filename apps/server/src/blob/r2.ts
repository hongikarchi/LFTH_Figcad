// Cloudflare R2 BlobStore 구현. blob/store.ts 인터페이스 만족 (CF Worker 번들 전용).
import type { BlobStore, StoredBlob } from './store';

/** Cloudflare R2 래퍼. R2Object가 StoredBlob을 구조적으로 만족 → get은 그대로 통과. */
export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2Bucket) {}
  async get(key: string): Promise<StoredBlob | null> {
    return (await this.bucket.get(key)) as StoredBlob | null;
  }
  async put(key: string, data: ArrayBuffer | Uint8Array | string, contentType?: string): Promise<void> {
    await this.bucket.put(
      key,
      data as ArrayBuffer | string,
      contentType ? { httpMetadata: { contentType } } : undefined,
    );
  }
  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
