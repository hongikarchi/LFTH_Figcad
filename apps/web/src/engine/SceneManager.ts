import * as THREE from 'three';
import { DeriveCache, type DocStore, type Id } from '@figcad/core';
import type { Engine } from './Engine';

const EDGE_COLOR = 0x16181b;
const SELECT_EMISSIVE = 0x2266ff;

interface SceneEntry {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  baseColor: string;
}

/**
 * 문서 → 씬 reconciler. 불변 규칙 1이 사는 곳:
 * 스토어 이벤트를 받아 파라미터에서 지오메트리를 파생(캐시 경유)해 씬을 패치한다.
 * 메시는 요소당 1개 (M1 규모에서 충분 — 배칭은 M6 최적화).
 */
export class SceneManager {
  private entries = new Map<Id, SceneEntry>();
  private derive = new DeriveCache();
  private edgeMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
  private selected: Id | null = null;

  constructor(
    private store: DocStore,
    private engine: Engine,
  ) {
    store.observe((change) => {
      for (const id of [...change.added, ...change.updated]) this.upsert(id);
      for (const id of change.removed) this.remove(id);
      engine.requestRender();
    });
  }

  /** 픽킹 대상 메시 목록 */
  get pickables(): THREE.Object3D[] {
    return [...this.entries.values()].map((e) => e.mesh);
  }

  setSelected(id: Id | null): void {
    if (this.selected && this.entries.has(this.selected)) {
      const prev = this.entries.get(this.selected)!;
      (prev.mesh.material as THREE.MeshLambertMaterial).emissive.setHex(0x000000);
    }
    this.selected = id;
    if (id) {
      const entry = this.entries.get(id);
      if (entry) {
        const mat = entry.mesh.material as THREE.MeshLambertMaterial;
        mat.emissive.setHex(SELECT_EMISSIVE);
        mat.emissiveIntensity = 0.35;
      }
    }
    this.engine.requestRender();
  }

  private upsert(id: Id): void {
    const geo = this.derive.derive(this.store, id);
    if (!geo) {
      this.remove(id);
      return;
    }
    const el = this.store.getElement(id);
    const type = el ? this.store.getType(el.typeId) : undefined;
    const color = type && 'color' in type ? type.color : '#cccccc';

    let entry = this.entries.get(id);
    if (!entry) {
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.userData['elementId'] = id;
      const edges = new THREE.LineSegments(new THREE.BufferGeometry(), this.edgeMat);
      this.engine.scene.add(mesh, edges);
      entry = { mesh, edges, baseColor: color };
      this.entries.set(id, entry);
    } else if (entry.baseColor !== color) {
      (entry.mesh.material as THREE.MeshLambertMaterial).color.set(color);
      entry.baseColor = color;
    }

    setBufferGeometry(entry.mesh.geometry, geo.positions, geo.normals);
    setLineGeometry(entry.edges.geometry, geo.edges);

    if (this.selected === id) {
      const mat = entry.mesh.material as THREE.MeshLambertMaterial;
      mat.emissive.setHex(SELECT_EMISSIVE);
      mat.emissiveIntensity = 0.35;
    }
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

export function setBufferGeometry(
  geometry: THREE.BufferGeometry,
  positions: Float32Array,
  normals: Float32Array,
): void {
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
}

export function setLineGeometry(geometry: THREE.BufferGeometry, positions: Float32Array): void {
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
}
