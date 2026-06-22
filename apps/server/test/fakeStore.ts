import type { BlobStore, StoredBlob } from '../src/blobStore';

/** 인메모리 BlobStore (테스트) — federation/version 핸들러 구동. .store로 내부 검사. */
export function fakeStore(): BlobStore & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  const norm = (d: ArrayBuffer | Uint8Array | string): Uint8Array =>
    typeof d === 'string' ? new TextEncoder().encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d);
  return {
    store,
    put: async (key, data) => {
      store.set(key, norm(data));
    },
    get: async (key): Promise<StoredBlob | null> => {
      const v = store.get(key);
      if (!v) return null;
      const ab = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
      return {
        arrayBuffer: async () => ab,
        text: async () => new TextDecoder().decode(v),
        json: async () => JSON.parse(new TextDecoder().decode(v)),
      };
    },
  };
}
