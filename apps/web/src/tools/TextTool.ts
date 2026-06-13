import * as THREE from 'three';
import { snapPoint, type SnapResult } from '@figcad/core';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;

/**
 * 텍스트 주석 — 클릭한 점에 떠있는 입력(HUD DOM) → 문자열 입력 → createText.
 * 캔버스에 직접 타이핑 불가하므로 명령형 input 사용(불변 규칙: React 아님).
 */
export class TextTool implements Tool {
  private marker: THREE.Mesh;
  private editing = false;

  constructor(private ctx: EditorContext) {
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x0a84ff }),
    );
    this.marker.visible = false;
    ctx.engine.scene.add(this.marker);
  }

  down(): void {}

  move(info: ToolPointerInfo): void {
    if (!info.doc || this.editing) return;
    this.updateMarker(this.snap(info), info.mmPerPixel);
    this.ctx.engine.requestRender();
  }

  // 입력창은 up(클릭 릴리즈)에서 띄운다 — down에서 띄우면 이어지는 mouseup이 포커스를 뺏어 즉시 blur
  up(info: ToolPointerInfo): void {
    if (!info.doc || this.editing) return;
    const at = this.snap(info).point;
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    const elev = (level?.elevation ?? 0) / 1000;
    const world = new THREE.Vector3(at[0] / 1000, elev + 0.02, at[1] / 1000);
    this.editing = true;
    this.marker.visible = false;
    void this.ctx.hud.promptText(world, this.ctx.rig.active).then((text) => {
      this.editing = false;
      if (text) {
        this.ctx.store.createText({ levelId: this.ctx.levelId(), at, text });
        this.ctx.engine.requestRender();
      }
    });
  }

  cancel(): void {
    this.marker.visible = false;
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

  private updateMarker(snap: SnapResult, mmPerPixel: number): void {
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    const elev = (level?.elevation ?? 0) / 1000;
    this.marker.visible = true;
    this.marker.position.set(snap.point[0] / 1000, elev + 0.02, snap.point[1] / 1000);
    this.marker.scale.setScalar(Math.max((6 * mmPerPixel) / 1000, 0.01));
  }
}
