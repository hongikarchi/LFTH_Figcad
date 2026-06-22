// blob 저장 추상화 — federation 페이로드 + version 커밋을 백엔드 독립으로.
// R2(Cloudflare) ↔ Disk(Node/Railway) 둘 다 같은 핸들러(federation.ts·version.ts) 구동 = 비-fork.
// node:fs 의존 없음(이 파일은 CF Worker 번들에도 들어감) — DiskBlobStore는 blobStoreDisk.ts(Node 전용).

/** R2Object의 부분집합 — federation/version이 쓰는 읽기 메서드만. */
export interface StoredBlob {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface BlobStore {
  get(key: string): Promise<StoredBlob | null>;
  put(key: string, data: ArrayBuffer | Uint8Array | string, contentType?: string): Promise<void>;
}

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
}
