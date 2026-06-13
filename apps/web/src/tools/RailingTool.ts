import * as THREE from 'three';
import {
  deriveRailing,
  snapPoint,
  type RailingElement,
  type RailingType,
  type Pt,
  type SnapResult,
} from '@figcad/core';
import { setBufferGeometry, setLineGeometry } from '../engine/SceneManager';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;
const DRAG_COMMIT_PX = 8;

const MARKER_COLORS: Record<SnapResult['kind'], number> = {
  endpoint: 0xff9500,
  grid: 0x0a84ff,
  none: 0x1d1d1f,
};

/**
 * 난간 그리기 — a→b 2점 체인 (WallTool/BeamTool 패턴). 슬라브 가장자리·계단을 따라 친다.
 */
export class RailingTool implements Tool {
  private chainStart: Pt | null = null;
  private downClient: { x: number; y: number } | null = null;

  private ghostMesh: THREE.Mesh;
  private ghostEdges: THREE.LineSegments;
  private marker: THREE.Mesh;

  constructor(private ctx: EditorContext) {
    this.ghostMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ color: 0x9ec3ff, transparent: true, opacity: 0.45 }),
    );
    this.ghostEdges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x0a84ff }),
    );
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.ghostMesh.visible = this.ghostEdges.visible = this.marker.visible = false;
    ctx.engine.scene.add(this.ghostMesh, this.ghostEdges, this.marker);
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const snap = this.snap(info);
    if (this.chainStart) this.commit(snap.point);
    else this.chainStart = snap.point;
    this.downClient = { x: info.clientX, y: info.clientY };
  }

  move(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const snap = this.snap(info);
    this.updateMarker(snap, info.mmPerPixel);
    if (this.chainStart) this.updateGhost(this.chainStart, snap.point);
    this.ctx.engine.requestRender();
  }

  up(info: ToolPointerInfo): void {
    if (!this.chainStart || !this.downClient || !info.doc) return;
    const dragPx = Math.hypot(info.clientX - this.downClient.x, info.clientY - this.downClient.y);
    if (dragPx > DRAG_COMMIT_PX) {
      this.commit(this.snap(info).point);
      this.chainStart = null;
      this.marker.visible = false;
      this.ctx.engine.requestRender();
    }
    this.downClient = null;
  }

  cancel(): void {
    this.chainStart = null;
    this.downClient = null;
    this.hideGhost();
    this.marker.visible = false;
    this.ctx.engine.requestRender();
  }

  enter(): void {
    this.chainStart = null;
    this.downClient = null;
    this.hideGhost();
    this.ctx.engine.requestRender();
  }

  private commit(end: Pt): void {
    const start = this.chainStart!;
    const lenMm = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (lenMm >= 50) {
      this.ctx.store.createRailing({
        levelId: this.ctx.levelId(),
        typeId: this.ctx.typeId('railing'),
        a: start,
        b: end,
      });
      this.chainStart = end; // 체인 계속 (연속 난간)
    }
    this.hideGhost();
  }

  private snap(info: ToolPointerInfo): SnapResult {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: this.ctx.store.wallEndpoints(this.ctx.levelId()),
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
      ...(this.chainStart ? { axisFrom: this.chainStart } : {}),
    });
  }

  private updateGhost(a: Pt, b: Pt): void {
    const type = this.ctx.store.getType(this.ctx.typeId('railing')) as RailingType | undefined;
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    if (type?.kind !== 'railing' || !level) return;
    const lenMm = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (lenMm < 1) {
      this.hideGhost();
      return;
    }
    const ghost: RailingElement = { id: '__ghost__', kind: 'railing', levelId: level.id, typeId: type.id, a, b };
    const geo = deriveRailing({ railing: ghost, type, level });
    setBufferGeometry(this.ghostMesh.geometry, geo.positions, geo.normals);
    setLineGeometry(this.ghostEdges.geometry, geo.edges);
    this.ghostMesh.visible = this.ghostEdges.visible = true;
    const mid = new THREE.Vector3(
      (geo.anchors.a[0] + geo.anchors.b[0]) / 2,
      geo.anchors.a[1],
      (geo.anchors.a[2] + geo.anchors.b[2]) / 2,
    );
    this.ctx.hud.showDimension(mid, lenMm, this.ctx.rig.active);
  }

  private hideGhost(): void {
    this.ghostMesh.visible = this.ghostEdges.visible = false;
    this.ctx.hud.hideDimension();
    this.ctx.engine.requestRender();
  }

  private updateMarker(snap: SnapResult, mmPerPixel: number): void {
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    const elev = (level?.elevation ?? 0) / 1000;
    this.marker.visible = true;
    this.marker.position.set(snap.point[0] / 1000, elev + 0.02, snap.point[1] / 1000);
    const r = Math.max((6 * mmPerPixel) / 1000, 0.01);
    this.marker.scale.setScalar(r);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(MARKER_COLORS[snap.kind]);
  }
}
