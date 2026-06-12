import * as THREE from 'three';
import {
  deriveWall,
  snapPoint,
  type Pt,
  type SnapResult,
  type WallElement,
  type WallType,
} from '@figcad/core';
import { setBufferGeometry, setLineGeometry } from '../engine/SceneManager';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12; // 끝점 스냅 반경 (화면 px)
const GRID_MM = 100;
const DRAG_COMMIT_PX = 8; // down→up 이동이 이보다 크면 펜 스트로크 커밋

const MARKER_COLORS: Record<SnapResult['kind'], number> = {
  endpoint: 0xff9f43,
  grid: 0x5b9dff,
  none: 0xffffff,
};

/**
 * 벽 그리기: 클릭-클릭 체인(마우스) + 펜다운→드래그→리프트(펜) 통합.
 * down에서 시작점 고정, move에서 고스트+치수칩, up에서 드래그면 커밋.
 * 클릭이면 다음 down이 커밋. Esc/도구 전환으로 체인 종료.
 */
export class WallTool implements Tool {
  private chainStart: Pt | null = null;
  private downClient: { x: number; y: number } | null = null;
  private lastSnap: Pt | null = null;

  private ghostMesh: THREE.Mesh;
  private ghostEdges: THREE.LineSegments;
  private marker: THREE.Mesh;

  constructor(private ctx: EditorContext) {
    this.ghostMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ color: 0xd8d2c4, transparent: true, opacity: 0.55 }),
    );
    this.ghostEdges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x5b9dff }),
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
    if (this.chainStart) {
      // 클릭-클릭 모드: 두 번째 클릭 = 커밋
      this.commit(snap.point);
    } else {
      this.chainStart = snap.point;
    }
    this.downClient = { x: info.clientX, y: info.clientY };
  }

  move(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const snap = this.snap(info);
    this.lastSnap = snap.point;
    this.updateMarker(snap, info.mmPerPixel);
    if (this.chainStart) this.updateGhost(this.chainStart, snap.point);
    this.ctx.engine.requestRender();
  }

  up(info: ToolPointerInfo): void {
    if (!this.chainStart || !this.downClient || !info.doc) return;
    const dragPx = Math.hypot(
      info.clientX - this.downClient.x,
      info.clientY - this.downClient.y,
    );
    if (dragPx > DRAG_COMMIT_PX) {
      // 스트로크 모드: 리프트 = 커밋 + 체인 종료 (다음 펜다운이 새 벽 시작.
      // 이어 그리기는 끝점 스냅이 해결). 클릭-클릭 모드는 체인 유지.
      this.commit(this.snap(info).point);
      this.chainStart = null;
      this.ctx.hud.hideDimension();
      this.marker.visible = false;
    }
    this.downClient = null;
  }

  cancel(): void {
    this.chainStart = null;
    this.downClient = null;
    this.hideGhost();
    this.marker.visible = false;
    this.ctx.hud.hideDimension();
    this.ctx.engine.requestRender();
  }

  private commit(end: Pt): void {
    const start = this.chainStart!;
    const lenMm = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (lenMm >= 50) {
      // 50mm 미만은 무시 (실수 클릭)
      this.ctx.store.createWall({
        levelId: this.ctx.levelId(),
        typeId: this.ctx.wallTypeId(),
        a: start,
        b: end,
      });
      this.chainStart = end; // 체인 계속
    }
    this.hideGhost();
  }

  private snap(info: ToolPointerInfo): SnapResult {
    return snapPoint(
      [info.doc![0], info.doc![1]],
      {
        endpoints: this.ctx.store.wallEndpoints(this.ctx.levelId()),
        endpointTolerance: SNAP_PX * info.mmPerPixel,
        grid: GRID_MM,
        ...(this.chainStart ? { axisFrom: this.chainStart } : {}),
      },
    );
  }

  private updateGhost(a: Pt, b: Pt): void {
    const type = this.ctx.store.getType(this.ctx.wallTypeId()) as WallType | undefined;
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    if (!type || !level) return;
    const lenMm = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (lenMm < 1) {
      this.hideGhost();
      return;
    }
    const ghostWall: WallElement = {
      id: '__ghost__',
      kind: 'wall',
      levelId: level.id,
      typeId: type.id,
      a,
      b,
    };
    const geo = deriveWall({ wall: ghostWall, type, level });
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
