import * as THREE from 'three';
import {
  buildDeriveIndex,
  DeriveCache,
  DocStore,
  type DocSnapshot,
  type Element,
  type SnapshotDiff,
} from '@figcad/core';

/**
 * 버전 비교 3D 시각화 (항목4) — 커밋 스냅샷 대비 현재 문서의 변화를 색으로 오버레이.
 * 요소 머티리얼을 건드리지 않는 별도 그룹(선택 하이라이트와 무충돌) — 파생 지오메트리로 임시 메시 생성.
 *   추가(현재 신규, 복원 시 사라짐)   = 초록 윤곽
 *   삭제(커밋엔 있고 현재 없음, 복원 시 돌아옴) = 빨강 반투명 고스트 + 윤곽  ← 복원 판단의 핵심
 *   변경(현재 주황 윤곽 + 옛 위치 고스트, 복원 시 되돌아감)
 * 지오메트리는 파라미터 순수함수라 삭제/옛 상태를 스냅샷에서 재파생(fromSnapshot 임시 store).
 */

const ADD = 0x30d158; // green
const DEL = 0xff453a; // red
const CHG = 0xff9f0a; // orange

export class DiffOverlay {
  private group = new THREE.Group();
  private edgeMats = new Map<number, THREE.LineBasicMaterial>();
  private fillMats = new Map<number, THREE.MeshBasicMaterial>();
  private snapStore: DocStore | null = null;
  active = false;

  constructor(private scene: THREE.Scene) {
    this.group.frustumCulled = false;
    scene.add(this.group);
  }

  private edgeMat(color: number): THREE.LineBasicMaterial {
    let m = this.edgeMats.get(color);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
      this.edgeMats.set(color, m);
    }
    return m;
  }
  private fillMat(color: number): THREE.MeshBasicMaterial {
    let m = this.fillMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
      this.fillMats.set(color, m);
    }
    return m;
  }

  /** 파생 geo에서 오버레이 메시/윤곽 생성(월드 m — geo는 이미 미터). fill=undefined면 윤곽만. */
  private add(store: DocStore, cache: DeriveCache, index: ReturnType<typeof buildDeriveIndex>, el: Element, edge: number, fill?: number): void {
    const geo = cache.derive(store, el.id, index);
    if (!geo) return;
    if (fill !== undefined && geo.positions.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
      const mesh = new THREE.Mesh(g, this.fillMat(fill));
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    if (geo.edges.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(geo.edges, 3));
      const lines = new THREE.LineSegments(g, this.edgeMat(edge));
      lines.renderOrder = 6;
      lines.frustumCulled = false;
      this.group.add(lines);
    }
  }

  /** 커밋 스냅샷(before) 대비 현재 문서(current)의 diff를 3D 오버레이로 표시. */
  show(current: DocStore, snapshot: DocSnapshot, diff: SnapshotDiff): void {
    this.clear();
    // 현재 문서서 파생 — 추가(초록 윤곽) + 변경(주황 윤곽, 현재 상태)
    const curCache = new DeriveCache();
    const curIndex = buildDeriveIndex(current);
    for (const el of diff.added) this.add(current, curCache, curIndex, el, ADD);
    const changedIds = new Set(diff.changed.map((c) => c.id));
    for (const el of current.listElements()) if (changedIds.has(el.id)) this.add(current, curCache, curIndex, el, CHG);
    // 스냅샷서 파생 — 삭제(빨강 고스트+윤곽) + 변경의 옛 상태(주황 고스트)
    this.snapStore = DocStore.fromSnapshot(snapshot);
    const snapCache = new DeriveCache();
    const snapIndex = buildDeriveIndex(this.snapStore);
    for (const el of diff.removed) this.add(this.snapStore, snapCache, snapIndex, el, DEL, DEL);
    for (const el of snapshot.elements) if (changedIds.has(el.id)) this.add(this.snapStore, snapCache, snapIndex, el, CHG, CHG);
    this.active = this.group.children.length > 0;
  }

  clear(): void {
    for (const child of this.group.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) child.geometry.dispose();
    }
    this.group.clear();
    this.snapStore = null; // fromSnapshot의 내부 ydoc은 참조 해제 시 GC (외부 long-lived doc 아님)
    this.active = false;
  }
}
