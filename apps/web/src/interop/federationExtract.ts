import { DocStore, buildDeriveIndex, DeriveCache, type DocSnapshot } from '@figcad/core';
import type { ReferenceMesh } from '../engine/ReferenceLayer';

/**
 * Federation 소스 추출기 — `ref`(외부 소스 식별자)에서 읽기전용 메시를 만든다.
 * 불변① 정합: 메시는 *별도 표현*(클라 로컬 뷰), Y.Doc 미진입 — federation 채널엔 ref만.
 *
 * figcad-room(A4) = 가장 싼 실소스: 새 지오코드 0. 다른 Figcad 룸의 라이브 스냅샷을
 * `?op=pull`로 받아 **derive 재사용**(buildDeriveIndex + DeriveCache)으로 메시 산출.
 * `DerivedGeometry.positions/normals`는 이미 월드 미터(deriveWall MM=0.001) = ReferenceMesh shape.
 *
 * glTF·IFC·.3dm·3D-Tiles 추출기는 A5/v1.5 — 미등록 sourceType은 reconciler가 error 표시.
 */
export type Extractor = (ref: string) => Promise<ReferenceMesh[]>;

/** 같은 서버의 다른 룸으로 가는 ?op=pull HTTP base (collab/provider.ts 호스트 규칙과 동일). */
function pullBase(): string {
  const host = import.meta.env.DEV ? `${location.hostname}:8787` : location.host;
  const proto = location.protocol === 'https:' ? 'https' : 'http';
  return `${proto}://${host}`;
}

/** A4 — 다른 Figcad 룸을 읽기전용 오버레이로. 라이브 스냅샷 → derive → 메시. */
export async function extractFigcadRoom(ref: string): Promise<ReferenceMesh[]> {
  const roomId = ref.trim();
  if (!roomId) throw new Error('빈 룸 id');
  const res = await fetch(`${pullBase()}/parties/doc/${encodeURIComponent(roomId)}?op=pull`);
  if (!res.ok) {
    // 타겟 룸이 ROOM_KEY 설정 시 401 — 메시지로 surface
    throw new Error(`룸 "${roomId}" 페치 실패 (${res.status}${res.status === 401 ? ' — ROOM_KEY 필요' : ''})`);
  }
  const snap = (await res.json()) as DocSnapshot;
  // throwaway 스토어: derive 후 참조 버림 → GC (provider 미부착, observer 누수 무관).
  const store = DocStore.fromSnapshot(snap);
  const index = buildDeriveIndex(store);
  const cache = new DeriveCache();
  const out: ReferenceMesh[] = [];
  for (const el of store.listElements()) {
    const geo = cache.derive(store, el.id, index);
    if (!geo) continue;
    if (geo.positions.length) out.push({ positions: geo.positions, normals: geo.normals });
    // 커튼월 유리 패널 등 보조 메시
    if (geo.panels && geo.panels.positions.length)
      out.push({ positions: geo.panels.positions, normals: geo.panels.normals });
  }
  return out;
}

/** sourceType → 추출기. 미등록(glTF·IFC·.3dm·3D-Tiles)은 A5/v1.5 — reconciler가 error 표시. */
export const FEDERATION_EXTRACTORS: Partial<
  Record<'3dm' | 'ifc' | 'figcad-room' | 'gltf' | '3dtiles', Extractor>
> = {
  'figcad-room': extractFigcadRoom,
};
