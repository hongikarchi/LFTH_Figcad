import * as THREE from 'three';
import { DeriveCache, type DocStore, type Id } from '@figcad/core';
import type { Engine } from './Engine';
import type { DerivedGeometry } from '@figcad/core';

const EDGE_COLOR = 0x2a2a2e;
const SELECT_EMISSIVE = 0x0a84ff; // Apple blue
const GHOST_OPACITY = 0.12;

interface SceneEntry {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  baseColor: string;
  levelId: Id;
  lastGeo: DerivedGeometry | null;
}

/**
 * 문서 → 씬 reconciler. 변경 시 모든 벽에 derive를 다시 요청한다 —
 * 캐시 키에 조인 정보가 들어 있어 이웃이 움직인 벽만 실제 재파생되고,
 * 나머지는 같은 geo 객체가 돌아와(lastGeo 비교) GPU 업로드를 스킵한다.
 */
export class SceneManager {
  private entries = new Map<Id, SceneEntry>();
  private derive = new DeriveCache();
  private edgeMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
  private ghostEdgeMat = new THREE.LineBasicMaterial({
    color: EDGE_COLOR,
    transparent: true,
    opacity: 0.15,
  });
  private selected: Id | null = null;
  private remoteHighlights = new Map<Id, string>(); // 원격 사용자 선택 (id → 사용자 색)
  private viewMode: '3d' | 'plan' = '3d';
  private activeLevelId: Id | null = null;

  constructor(
    private store: DocStore,
    private engine: Engine,
  ) {
    store.observe((change) => {
      for (const id of change.removed) this.remove(id);
      // 조인 때문에 전체 벽 재요청 (캐시가 무변경을 걸러낸다)
      for (const el of store.listElements()) this.upsert(el.id);
      engine.requestRender();
    });
  }

  get pickables(): THREE.Object3D[] {
    return [...this.entries.values()].map((e) => e.mesh);
  }

  setSelected(id: Id | null): void {
    const prev = this.selected;
    this.selected = id;
    if (prev) this.applyHighlight(prev);
    if (id) this.applyHighlight(id);
    this.engine.requestRender();
  }

  /** 원격 사용자 선택/편집 표시 — awareness 변경 시 호출 */
  setRemoteHighlights(highlights: Map<Id, string>): void {
    const affected = new Set([...this.remoteHighlights.keys(), ...highlights.keys()]);
    this.remoteHighlights = highlights;
    for (const id of affected) this.applyHighlight(id);
    this.engine.requestRender();
  }

  /** 우선순위: 내 선택 > 원격 하이라이트 > 없음 */
  private applyHighlight(id: Id): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const mat = entry.mesh.material as THREE.MeshLambertMaterial;
    if (this.selected === id) {
      mat.emissive.setHex(SELECT_EMISSIVE);
      mat.emissiveIntensity = 0.3;
    } else {
      const remote = this.remoteHighlights.get(id);
      if (remote) {
        mat.emissive.set(remote);
        mat.emissiveIntensity = 0.25;
      } else {
        mat.emissive.setHex(0x000000);
      }
    }
  }

  /** 평면 모드에서 비활성 레벨 고스팅 (15% — ArchiCAD 고스트 스토리 식) */
  setViewContext(mode: '3d' | 'plan', activeLevelId: Id | null): void {
    this.viewMode = mode;
    this.activeLevelId = activeLevelId;
    for (const entry of this.entries.values()) this.applyGhosting(entry);
    this.engine.requestRender();
  }

  private applyGhosting(entry: SceneEntry): void {
    const ghosted =
      this.viewMode === 'plan' &&
      this.activeLevelId !== null &&
      entry.levelId !== this.activeLevelId;
    const mat = entry.mesh.material as THREE.MeshLambertMaterial;
    mat.transparent = ghosted;
    mat.opacity = ghosted ? GHOST_OPACITY : 1;
    mat.needsUpdate = true;
    entry.edges.material = ghosted ? this.ghostEdgeMat : this.edgeMat;
  }

  private upsert(id: Id): void {
    const geo = this.derive.derive(this.store, id);
    if (!geo) {
      this.remove(id);
      return;
    }
    const el = this.store.getElement(id);
    if (!el) return;
    const type = this.store.getType(el.typeId);
    const color = type && 'color' in type ? type.color : '#cccccc';

    let entry = this.entries.get(id);
    if (!entry) {
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.userData['elementId'] = id;
      const edges = new THREE.LineSegments(new THREE.BufferGeometry(), this.edgeMat);
      this.engine.scene.add(mesh, edges);
      entry = { mesh, edges, baseColor: color, levelId: el.levelId, lastGeo: null };
      this.entries.set(id, entry);
      this.applyGhosting(entry);
    }
    if (entry.baseColor !== color) {
      (entry.mesh.material as THREE.MeshLambertMaterial).color.set(color);
      entry.baseColor = color;
    }
    if (entry.levelId !== el.levelId) {
      entry.levelId = el.levelId;
      this.applyGhosting(entry);
    }

    if (entry.lastGeo !== geo) {
      setBufferGeometry(entry.mesh.geometry, geo.positions, geo.normals);
      setLineGeometry(entry.edges.geometry, geo.edges);
      entry.lastGeo = geo;
    }

    this.applyHighlight(id);
  }

  private remove(id: Id): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.engine.scene.remove(entry.mesh, entry.edges);
    entry.mesh.geometry.dispose();
    entry.edges.geometry.dispose();
    (entry.mesh.material as THREE.Material).dispose();
    this.entries.delete(id);
    this.derive.evict(id);
    if (this.selected === id) this.selected = null;
  }
}

/**
 * 어트리뷰트 갱신 — 길이가 같으면 기존 GL 버퍼에 복사(needsUpdate),
 * 다를 때만 새 BufferAttribute (드래그 중 매 프레임 버퍼 재생성으로 인한
 * GPU 메모리 churn 방지 — three는 교체된 어트리뷰트의 GL 버퍼를 GC까지 못 푼다).
 */
function updateAttr(geometry: THREE.BufferGeometry, name: string, array: Float32Array): void {
  const attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (attr && attr.array.length === array.length) {
    (attr.array as Float32Array).set(array);
    attr.needsUpdate = true;
  } else {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, 3));
  }
}

export function setBufferGeometry(
  geometry: THREE.BufferGeometry,
  positions: Float32Array,
  normals: Float32Array,
): void {
  updateAttr(geometry, 'position', positions);
  updateAttr(geometry, 'normal', normals);
  geometry.computeBoundingSphere();
}

export function setLineGeometry(geometry: THREE.BufferGeometry, positions: Float32Array): void {
  updateAttr(geometry, 'position', positions);
  geometry.computeBoundingSphere();
}
