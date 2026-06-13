import * as THREE from 'three';
import { deriveColumn, snapPoint, type ColumnElement, type ColumnType, type Pt, type SnapResult } from '@figcad/core';
import { setBufferGeometry, setLineGeometry } from '../engine/SceneManager';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;

const MARKER_COLORS: Record<SnapResult['kind'], number> = {
  endpoint: 0xff9500, // 그리드 교차점·벽 끝점 = 연결점
  grid: 0x0a84ff,
  none: 0x1d1d1f,
};

/** 기둥 배치: 한 점 클릭 (그리드 교차점에 스냅). 호버 = 고스트 + 마커. */
export class ColumnTool implements Tool {
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
    const at = this.snap(info).point;
    this.ctx.store.createColumn({
      levelId: this.ctx.levelId(),
      typeId: this.ctx.typeId('column'),
      at,
    });
    this.ctx.engine.requestRender();
  }

  move(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const snap = this.snap(info);
    this.updateMarker(snap, info.mmPerPixel);
    this.updateGhost(snap.point);
    this.ctx.engine.requestRender();
  }

  up(): void {}

  cancel(): void {
    this.ghostMesh.visible = this.ghostEdges.visible = this.marker.visible = false;
    this.ctx.engine.requestRender();
  }

  enter(): void {
    this.cancel();
  }

  private snap(info: ToolPointerInfo): SnapResult {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: this.ctx.store.wallEndpoints(this.ctx.levelId()),
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
    });
  }

  private updateGhost(at: Pt): void {
    const type = this.ctx.store.getType(this.ctx.typeId('column')) as ColumnType | undefined;
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    if (type?.kind !== 'column' || !level) {
      this.ghostMesh.visible = this.ghostEdges.visible = false;
      return;
    }
    const ghost: ColumnElement = {
      id: '__ghost__',
      kind: 'column',
      levelId: level.id,
      typeId: type.id,
      at,
    };
    const geo = deriveColumn({ column: ghost, type, level });
    setBufferGeometry(this.ghostMesh.geometry, geo.positions, geo.normals);
    setLineGeometry(this.ghostEdges.geometry, geo.edges);
    this.ghostMesh.visible = this.ghostEdges.visible = true;
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
