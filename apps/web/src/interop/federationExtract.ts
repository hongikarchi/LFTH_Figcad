import * as THREE from 'three';
import { DocStore, buildDeriveIndex, DeriveCache, type DocSnapshot } from '@figcad/core';
import type { ReferenceMesh } from '../engine/ReferenceLayer';
import { getIfcApi } from './ifcClient';

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

/**
 * A5a — glTF/GLB를 읽기전용 오버레이로.
 * glTF 스펙 좌표 = 미터·Y-up·오른손 = Three world와 정확히 동일 → 단위/축 변환 0.
 * 유일한 변환 = 노드 계층의 matrixWorld(노드별 변환·인스턴싱) 적용. correct-by-construction.
 * GLTFLoader는 무거우니 동적 import (interop WASM과 동급 — iPad 핫패스 밖).
 */
export async function extractGltf(ref: string): Promise<ReferenceMesh[]> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(ref);
  gltf.scene.updateMatrixWorld(true);
  const out: ReferenceMesh[] = [];
  gltf.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    // 지오메트리를 복제해 노드의 월드 변환을 굽는다 (원본 불변, 인스턴스별 위치 보존).
    let geo = (obj.geometry as THREE.BufferGeometry).clone();
    geo.applyMatrix4(obj.matrixWorld);
    if (geo.index) {
      const ni = geo.toNonIndexed();
      geo.dispose();
      geo = ni;
    }
    const posAttr = geo.getAttribute('position');
    if (!posAttr) {
      geo.dispose();
      return;
    }
    const positions = new Float32Array(posAttr.array as ArrayLike<number>);
    const normAttr = geo.getAttribute('normal');
    const normals = normAttr ? new Float32Array(normAttr.array as ArrayLike<number>) : undefined;
    geo.dispose();
    out.push(normals ? { positions, normals } : { positions });
  });
  return out;
}

/**
 * A5b — IFC(STEP)를 읽기전용 오버레이로. 충실한 *전체* 삼각망 (importIfc의 파라메트릭
 * 재구성과 다름 — 자유형 B-rep까지 보존). 변환 핵심은 @figcad/interop importIfcMeshes에
 * 격리·테스트됨(ifc-meshes.test.ts): web-ifc가 미터·Y-up으로 굽고, north 부호만 +로 돌려
 * Figcad world 규약(extractFigcadRoom)과 일치. 여기선 fetch + WASM 로딩만.
 */
export async function extractIfc(ref: string): Promise<ReferenceMesh[]> {
  const url = ref.trim();
  if (!url) throw new Error('빈 IFC ref');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IFC 페치 실패 "${url}" (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const [{ importIfcMeshes }, api] = await Promise.all([import('@figcad/interop/ifc'), getIfcApi()]);
  // importIfcMeshes는 노멀을 빈 배열로 둔다(축교환 반사로 winding 뒤집힘) → normals 생략해
  // ReferenceLayer가 computeVertexNormals 하게. (빈 Float32Array는 truthy라 그냥 넘기면
  // position 수와 안 맞아 지오메트리가 깨진다.)
  return importIfcMeshes(api, bytes).map((m) => ({ positions: m.positions }));
}

/** sourceType → 추출기. 미등록(.3dm·3D-Tiles)은 v1.5 — reconciler가 error 표시. */
export const FEDERATION_EXTRACTORS: Partial<
  Record<'3dm' | 'ifc' | 'figcad-room' | 'gltf' | '3dtiles', Extractor>
> = {
  'figcad-room': extractFigcadRoom,
  gltf: extractGltf,
  ifc: extractIfc,
};
