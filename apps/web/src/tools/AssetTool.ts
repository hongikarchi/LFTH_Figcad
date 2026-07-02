import * as THREE from 'three';
import { deriveAsset, snapPoint, type AssetElement, type AssetKind, type Pt, type SnapResult } from '@figcad/core';
import { setBufferGeometry, setLineGeometry } from '../engine/SceneManager';
import { createSnapMarker, updateSnapMarker } from './snapMarker';
import { useUiStore } from '../state/uiStore';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;

/** 오브젝트(엔투라지) 배치(항목7): 한 점 클릭. 종류(assetKind)는 uiStore(InfoBox 셀렉트). 호버=고스트+마커. */
export class AssetTool implements Tool {
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

  private assetKind(): AssetKind {
    return useUiStore.getState().assetKind;
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const at = this.snap(info).point;
    this.ctx.store.createAsset({ levelId: this.ctx.levelId(), assetKind: this.assetKind(), at });
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
      endpoints: [
        ...this.ctx.store.wallEndpoints(this.ctx.levelId()),
        ...(this.ctx.importSnapCandidates?.([info.doc![0], info.doc![1]], SNAP_PX * info.mmPerPixel) ?? []), // 빽도면 끝점 트레이싱
      ],
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
    });
  }

  private updateGhost(at: Pt): void {
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    if (!level) {
      this.ghostMesh.visible = this.ghostEdges.visible = false;
      return;
    }
    const ghost: AssetElement = {
      id: '__ghost__',
      kind: 'asset',
      levelId: level.id,
      assetKind: this.assetKind(),
      at,
    };
    const geo = deriveAsset({ asset: ghost, level });
    setBufferGeometry(this.ghostMesh.geometry, geo.positions, geo.normals);
    setLineGeometry(this.ghostEdges.geometry, geo.edges);
    this.ghostMesh.visible = this.ghostEdges.visible = true;
  }

  private updateMarker(snap: SnapResult, mmPerPixel: number): void {
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    const elev = (level?.elevation ?? 0) / 1000;
    updateSnapMarker(this.marker, snap, mmPerPixel, elev);
  }
}
