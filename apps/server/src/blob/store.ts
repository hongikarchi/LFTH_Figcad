// blob 저장 추상화 인터페이스 — federation 페이로드 + version 커밋을 백엔드 독립으로.
// R2(Cloudflare) ↔ Disk(Node/Railway) 둘 다 같은 핸들러(handlers/federation.ts·version.ts) 구동 = 비-fork.
// 순수 인터페이스(node:fs·R2 의존 0) — 구현은 r2.ts(CF)·disk.ts(Node).

/** R2Object의 부분집합 — federation/version이 쓰는 읽기 메서드만. */
export interface StoredBlob {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface BlobStore {
  get(key: string): Promise<StoredBlob | null>;
  put(key: string, data: ArrayBuffer | Uint8Array | string, contentType?: string): Promise<void>;
  /** 없는 키 삭제는 no-op. 미구현 스토어(옵셔널)면 GC가 조용히 건너뜀 — 기능 저하 없음(누적만). */
  delete?(key: string): Promise<void>;
}
