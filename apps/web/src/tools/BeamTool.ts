import * as THREE from 'three';
import {
  deriveBeam,
  snapPoint,
  type BeamElement,
  type BeamType,
  type Pt,
  type SnapResult,
} from '@figcad/core';
import { setBufferGeometry, setLineGeometry } from '../engine/SceneManager';
import { createSnapMarker, updateSnapMarker } from './snapMarker';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;
const DRAG_COMMIT_PX = 8;

/**
 * 보 그리기 — WallTool과 동일한 입력 패턴(클릭-클릭 체인 + 펜다운→드래그→리프트).
 * 보통 기둥 머리를 잇는다(끝점 스냅이 그리드 교차점·기둥 자리를 잡음).
 */
export class BeamTool implements Tool {
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
    this.marker = createSnapMarker();
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
      this.ctx.store.createBeam({
        levelId: this.ctx.levelId(),
        typeId: this.ctx.typeId('beam'),
        a: start,
        b: end,
      });
      this.chainStart = end; // 체인 계속
    }
    this.hideGhost();
  }

  private snap(info: ToolPointerInfo): SnapResult {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: [
        ...this.ctx.store.wallEndpoints(this.ctx.levelId()),
        ...(this.ctx.importSnapCandidates?.([info.doc![0], info.doc![1]], SNAP_PX * info.mmPerPixel) ?? []), // 빽도면 끝점 트레이싱
      ],
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
      ...(this.chainStart ? { axisFrom: this.chainStart } : {}),
    });
  }

  private updateGhost(a: Pt, b: Pt): void {
    const type = this.ctx.store.getType(this.ctx.typeId('beam')) as BeamType | undefined;
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    if (type?.kind !== 'beam' || !level) return;
    const lenMm = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (lenMm < 1) {
      this.hideGhost();
      return;
    }
    const ghost: BeamElement = { id: '__ghost__', kind: 'beam', levelId: level.id, typeId: type.id, a, b };
    const geo = deriveBeam({ beam: ghost, type, level });
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
    updateSnapMarker(this.marker, snap, mmPerPixel, elev);
  }
}
