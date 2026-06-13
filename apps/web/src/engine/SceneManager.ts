import * as THREE from 'three';
import { buildDeriveIndex, DeriveCache, type DeriveIndex, type DocStore, type Id } from '@figcad/core';
import type { Engine } from './Engine';
import type { DerivedGeometry } from '@figcad/core';

const EDGE_COLOR = 0x2a2a2e;
const GRID_COLOR = 0xc0392b;
const SELECT_EMISSIVE = 0x0a84ff; // Apple blue
const GHOST_OPACITY = 0.12;

interface SceneEntry {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  baseColor: string;
  kind: string;
  levelId: Id | null; // 그리드 = null (전 층 공통, 고스팅 제외)
  labelText: string | null; // 그리드 버블 텍스트
  sprites: THREE.Sprite[];
  lastGeo: DerivedGeometry | null;
}

/** 그리드 버블 — 원 + 라벨 텍스트 스프라이트 */
function makeLabelSprite(text: string): THREE.Sprite {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#c0392b';
  g.stroke();
  g.fillStyle = '#1d1d1f';
  g.font = `bold ${size * 0.42}px -apple-system, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, size / 2, size / 2 + 2);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }),
  );
  sprite.scale.setScalar(0.5);
  sprite.renderOrder = 5;
  return sprite;
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
  private gridEdgeMat = new THREE.LineBasicMaterial({ color: GRID_COLOR });
  private ghostEdgeMat = new THREE.LineBasicMaterial({
    color: EDGE_COLOR,
    transparent: true,
    opacity: 0.15,
  });
  private selected = new Set<Id>(); // 내 선택 (다중)
  private remoteHighlights = new Map<Id, string>(); // 원격 사용자 선택 (id → 사용자 색)
  private viewMode: '3d' | 'plan' = '3d';
  private activeLevelId: Id | null = null;

  constructor(
    private store: DocStore,
    private engine: Engine,
  ) {
    store.observe((change) => {
      for (const id of change.removed) this.remove(id);
      // 조인 때문에 전체 벽 재요청 (캐시가 무변경을 걸러낸다).
      // 의존 인덱스를 변경당 1회 구축 — 없으면 요소마다 전체 스캔 = 변경당 O(n²)
      const index = buildDeriveIndex(store);
      for (const el of store.listElements()) this.upsert(el.id, index);
      engine.requestRender();
    });
  }

  get pickables(): THREE.Object3D[] {
    return [...this.entries.values()].map((e) => e.mesh);
  }

  setSelected(ids: Id[]): void {
    const affected = new Set<Id>([...this.selected, ...ids]);
    this.selected = new Set(ids);
    for (const id of affected) this.applyHighlight(id);
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
    if (this.selected.has(id)) {
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
    if (entry.kind === 'grid') return; // 그리드는 전 층 공통 — 고스팅 제외
    const ghosted =
      this.viewMode === 'plan' &&
      this.activeLevelId !== null &&
      entry.levelId !== null &&
      entry.levelId !== this.activeLevelId;
    const mat = entry.mesh.material as THREE.MeshLambertMaterial;
    const baseOpacity = entry.kind === 'opening:window' ? 0.55 : 1;
    mat.transparent = ghosted || baseOpacity < 1;
    mat.opacity = ghosted ? GHOST_OPACITY : baseOpacity;
    mat.needsUpdate = true;
    entry.edges.material = ghosted ? this.ghostEdgeMat : this.edgeMat;
  }

  private upsert(id: Id, index?: DeriveIndex): void {
    const geo = this.derive.derive(this.store, id, index);
    if (!geo) {
      this.remove(id);
      return;
    }
    const el = this.store.getElement(id);
    if (!el) return;

    // 종류별 시각 속성
    const elType = 'typeId' in el ? this.store.getType(el.typeId) : undefined;
    const color =
      el.kind === 'grid' ? '#c0392b' : elType && 'color' in elType ? elType.color : '#cccccc';
    const kind =
      el.kind === 'opening' && elType?.kind === 'opening'
        ? `opening:${elType.opening.kind}`
        : el.kind;
    // 개구부의 레벨 = 호스트 벽의 레벨 (고스팅용)
    let levelId: Id | null = null;
    if ('levelId' in el) levelId = el.levelId;
    else if (el.kind === 'opening') {
      const host = this.store.getElement(el.hostId);
      levelId = host && 'levelId' in host ? host.levelId : null;
    }

    let entry = this.entries.get(id);
    if (!entry) {
      const mat = new THREE.MeshLambertMaterial({ color });
      if (el.kind === 'grid') {
        // 그리드 리본 = 픽킹 전용 (거의 안 보이게)
        mat.transparent = true;
        mat.opacity = 0.04;
        mat.depthWrite = false;
      }
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.userData['elementId'] = id;
      const edges = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        el.kind === 'grid' ? this.gridEdgeMat : this.edgeMat,
      );
      this.engine.scene.add(mesh, edges);
      entry = {
        mesh,
        edges,
        baseColor: color,
        kind,
        levelId,
        labelText: null,
        sprites: [],
        lastGeo: null,
      };
      this.entries.set(id, entry);
      this.applyGhosting(entry);
    }
    if (entry.baseColor !== color) {
      (entry.mesh.material as THREE.MeshLambertMaterial).color.set(color);
      entry.baseColor = color;
    }
    if (entry.levelId !== levelId || entry.kind !== kind) {
      entry.levelId = levelId;
      entry.kind = kind;
      this.applyGhosting(entry);
    }

    if (entry.lastGeo !== geo) {
      setBufferGeometry(entry.mesh.geometry, geo.positions, geo.normals);
      setLineGeometry(entry.edges.geometry, geo.edges);
      entry.lastGeo = geo;
      this.updateGridBubbles(entry, el, geo);
    } else if (el.kind === 'grid' && entry.labelText !== el.label) {
      this.updateGridBubbles(entry, el, geo);
    }

    this.applyHighlight(id);
  }

  /** 그리드 양끝 버블 스프라이트 (라벨 변경/이동 시 재생성·재배치) */
  private updateGridBubbles(entry: SceneEntry, el: { kind: string }, geo: DerivedGeometry): void {
    if (el.kind !== 'grid') return;
    const grid = el as { kind: 'grid'; label: string };
    if (entry.labelText !== grid.label) {
      for (const s of entry.sprites) {
        this.engine.scene.remove(s);
        s.material.map?.dispose();
        s.material.dispose();
      }
      entry.sprites = [makeLabelSprite(grid.label), makeLabelSprite(grid.label)];
      for (const s of entry.sprites) this.engine.scene.add(s);
      entry.labelText = grid.label;
    }
    entry.sprites[0]?.position.set(...geo.anchors.a);
    entry.sprites[1]?.position.set(...geo.anchors.b);
  }

  private remove(id: Id): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.engine.scene.remove(entry.mesh, entry.edges, ...entry.sprites);
    entry.mesh.geometry.dispose();
    entry.edges.geometry.dispose();
    (entry.mesh.material as THREE.Material).dispose();
    for (const s of entry.sprites) {
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.entries.delete(id);
    this.derive.evict(id);
    this.selected.delete(id);
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
