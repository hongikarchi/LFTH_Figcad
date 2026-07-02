import * as THREE from 'three';
import { DocStore, buildDeriveIndex, DeriveCache, KIND_LABEL, type DocSnapshot, type FederationSource } from '@figcad/core';
import { gltfPositionsToFigcad } from '@figcad/interop/coords';
import type { ReferenceMesh, ReferenceResult } from '../engine/ReferenceLayer';
import { getIfcApi, parseIfc } from './ifcClient';
import { parseDwgUnderlay } from './dwgClient';
import type { DwgUnderlay } from '@figcad/interop/dwg-underlay';
import { backendOrigin } from '../config/backend';

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
export type Extractor = (ref: string) => Promise<ReferenceResult>;

/** ?op=pull HTTP base — config/backend 단일 소스. */
function pullBase(): string {
  return backendOrigin();
}

/**
 * 다른 Figcad 룸의 라이브 DocSnapshot을 `?op=pull`로 가져온다 — 오버레이 derive(extractFigcadRoom)와
 * 머지 캡처(Slice9 머지 게이트)가 공유. ROOM_KEY는 fetch 시점 URL서만(ref 미저장 — 키 유출 방지).
 */
export async function fetchFigcadRoomSnapshot(ref: string): Promise<DocSnapshot> {
  const roomId = ref.trim();
  if (!roomId) throw new Error('빈 룸 id');
  const key = new URL(location.href).searchParams.get('key');
  const keyQ = key ? `&key=${encodeURIComponent(key)}` : '';
  const res = await fetch(`${pullBase()}/parties/doc/${encodeURIComponent(roomId)}?op=pull${keyQ}`);
  if (!res.ok) {
    throw new Error(`룸 "${roomId}" 페치 실패 (${res.status}${res.status === 401 ? ' — ROOM_KEY 필요' : ''})`);
  }
  return (await res.json()) as DocSnapshot;
}

/** 머지 가능한 소스 타입 — native 파라메트릭 요소를 얻을 수 있는 것만(메시전용 gltf/.3dm/3dtiles 제외). */
export const MERGEABLE_SOURCES: ReadonlySet<FederationSource['sourceType']> = new Set([
  'figcad-room',
  'ifc',
]);

/**
 * 머지 게이트(Slice9) — 소스에서 native DocSnapshot 획득(소스 무관 mergeSnapshot 입력).
 * figcad-room = pull 스냅샷(무손실) · ifc = blob bytes → importIfc(파라메트릭, 자유곡면·일부 kind 손실).
 * 메시전용(gltf/.3dm/3dtiles) = null(lift 축, 머지 불가 — 로드맵 G).
 */
export async function acquireMergeSnapshot(source: FederationSource): Promise<DocSnapshot | null> {
  if (source.sourceType === 'figcad-room') return fetchFigcadRoomSnapshot(source.ref);
  if (source.sourceType === 'ifc') {
    const res = await fetch(source.ref);
    if (!res.ok) throw new Error(`IFC 페치 실패 (${res.status})`);
    const { snapshot } = await parseIfc(new Uint8Array(await res.arrayBuffer()));
    return snapshot;
  }
  return null;
}

/** A4 — 다른 Figcad 룸을 읽기전용 오버레이로. 라이브 스냅샷 → derive → 메시. */
export async function extractFigcadRoom(ref: string): Promise<ReferenceResult> {
  const snap = await fetchFigcadRoomSnapshot(ref);
  // throwaway 스토어: derive 후 참조 버림 → GC (provider 미부착, observer 누수 무관).
  const store = DocStore.fromSnapshot(snap);
  const index = buildDeriveIndex(store);
  const cache = new DeriveCache();
  const out: ReferenceMesh[] = [];
  for (const el of store.listElements()) {
    const geo = cache.derive(store, el.id, index);
    if (!geo) continue;
    // 객체 정체성 — 스냅 정보·라벨 프리필·AI 매니페스트 (category=한글 kind 라벨, 패널도 부모 요소 정체성).
    const ident = {
      objectId: el.id,
      category: KIND_LABEL[el.kind],
      name:
        'name' in el && typeof (el as { name?: unknown }).name === 'string'
          ? (el as { name: string }).name
          : undefined,
    };
    if (geo.positions.length) out.push({ positions: geo.positions, normals: geo.normals, ...ident });
    // 커튼월 유리 패널 등 보조 메시
    if (geo.panels && geo.panels.positions.length)
      out.push({ positions: geo.panels.positions, normals: geo.panels.normals, ...ident });
  }
  return { meshes: out };
}

/**
 * A5a — glTF/GLB를 읽기전용 오버레이로.
 * glTF 스펙 좌표 = 미터·Y-up·오른손 = Three world와 정확히 동일 → 단위/축 변환 0.
 * 유일한 변환 = 노드 계층의 matrixWorld(노드별 변환·인스턴싱) 적용. correct-by-construction.
 * GLTFLoader는 무거우니 동적 import (interop WASM과 동급 — iPad 핫패스 밖).
 */
export async function extractGltf(ref: string): Promise<ReferenceResult> {
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
    // glTF world(north=-Z) → Figcad world(north=+Z): Z 부호반전(박스 실험 측정 확정, @figcad/interop/coords).
    // Z반전=winding 뒤집힘 → 노멀 드롭, ReferenceLayer가 computeVertexNormals(importIfcMeshes 패턴).
    const positions = gltfPositionsToFigcad(new Float32Array(posAttr.array as ArrayLike<number>));
    geo.dispose();
    // 노드명 보존 — 무명 메시는 부모 노드명 폴백 (glTF exporter가 메시를 익명 자식으로 감싸는 관례).
    out.push({ positions, name: obj.name || obj.parent?.name || undefined });
  });
  return { meshes: out };
}

/**
 * A5b — IFC(STEP)를 읽기전용 오버레이로. 충실한 *전체* 삼각망 (importIfc의 파라메트릭
 * 재구성과 다름 — 자유형 B-rep까지 보존). 변환 핵심은 @figcad/interop importIfcMeshes에
 * 격리·테스트됨(ifc-meshes.test.ts): web-ifc가 미터·Y-up으로 굽고, north 부호만 +로 돌려
 * Figcad world 규약(extractFigcadRoom)과 일치. 여기선 fetch + WASM 로딩만.
 */
export async function extractIfc(ref: string): Promise<ReferenceResult> {
  const url = ref.trim();
  if (!url) throw new Error('빈 IFC ref');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IFC 페치 실패 "${url}" (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const [{ importIfcMeshes }, api] = await Promise.all([import('@figcad/interop/ifc'), getIfcApi()]);
  // importIfcMeshes는 노멀을 빈 배열로 둔다(축교환 반사로 winding 뒤집힘) → normals 생략해
  // ReferenceLayer가 computeVertexNormals 하게. (빈 Float32Array는 truthy라 그냥 넘기면
  // position 수와 안 맞아 지오메트리가 깨진다.)
  return {
    meshes: importIfcMeshes(api, bytes).map((m) => ({
      positions: m.positions,
      name: m.name,
      objectId: m.expressId !== undefined ? String(m.expressId) : undefined,
      category: m.ifcType,
    })),
  };
}

/**
 * D — .3dm 네이티브를 읽기전용 오버레이로. **명시 Mesh 객체만**(raw Brep=v1.5). 변환은
 * @figcad/interop import3dmMeshes에 격리·테스트됨(rhino-meshes.test.ts): rhino mm·Z-up →
 * Figcad world m·Y-up [x,z,y]*.001. WASM 로더는 ifcClient.rhinoWasmUrl 패턴(vite ?url).
 * glTF가 Rhino7+ 이미 커버 → 한계적(Mesh 없는 .3dm은 빈 오버레이 + skip 카운트).
 */
export async function extract3dm(ref: string): Promise<ReferenceResult> {
  const url = ref.trim();
  if (!url) throw new Error('빈 .3dm ref');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`.3dm 페치 실패 "${url}" (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const [{ import3dmRefs }, wasmUrl] = await Promise.all([
    import('@figcad/interop/rhino'),
    import('rhino3dm/rhino3dm.wasm?url').then((m) => m.default),
  ]);
  // "있는 그대로": Brep/Extrusion/Mesh = 캐시 렌더메시 솔리드(import_3dm 방식 face.getMesh),
  // standalone Curve = edge 와이어프레임, 블록 재귀. normals 생략 → ReferenceLayer 계산.
  const { meshes, edges, skipped, capped } = await import3dmRefs(bytes, { wasmUrl });
  if (capped) console.warn('[federation .3dm] 지오메트리 상한 도달 — 대형 모델 일부만 표시');
  if (meshes.length === 0 && edges.length === 0)
    throw new Error(`.3dm에서 표시할 지오메트리 없음 (객체 ${skipped}개 — 텍스트/포인트뿐?)`);
  // groups = 병합 버퍼 내 객체 range(name/uuid/layer) — layer는 category로 (표시명 폴백 체인).
  return {
    meshes: meshes.map((m) => ({
      positions: m.positions,
      groups: m.groups?.map((gr) => ({
        start: gr.start,
        count: gr.count,
        name: gr.name,
        objectId: gr.id,
        category: gr.layer,
      })),
    })),
    edges,
  };
}

/**
 * CAD 2D 언더레이(빽도면) — DWG/DXF blob을 ref에서 페치 → libredwg WASM 파싱 → 평면 라인워크.
 * 메시 추출기(ReferenceMesh[])와 반환이 다르다(DwgUnderlay = 세그먼트·라벨·레이어) → reconciler가
 * 별도 경로로 ref.addUnderlay(배치 적용). 불변① 정합: 라인워크는 ref(blob)서 파생, Y.Doc 미진입.
 */
export type UnderlayExtractor = (ref: string, kind: 'dwg' | 'dxf') => Promise<DwgUnderlay>;
export async function fetchDwgUnderlay(ref: string, kind: 'dwg' | 'dxf'): Promise<DwgUnderlay> {
  const url = ref.trim();
  if (!url) throw new Error(`빈 ${kind.toUpperCase()} ref`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${kind.toUpperCase()} 페치 실패 "${url}" (${res.status})`);
  return parseDwgUnderlay(await res.arrayBuffer(), kind);
}

/** sourceType → 추출기. 미등록(3D-Tiles)은 v1.5 — reconciler가 error 표시. */
export const FEDERATION_EXTRACTORS: Partial<
  Record<'3dm' | 'ifc' | 'figcad-room' | 'gltf' | '3dtiles', Extractor>
> = {
  'figcad-room': extractFigcadRoom,
  gltf: extractGltf,
  ifc: extractIfc,
  '3dm': extract3dm,
};
