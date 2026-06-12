import * as THREE from 'three';
import { snapPoint, type Pt, type WallElement } from '@figcad/core';
import { pickElement } from '../engine/Picker';
import { useUiStore } from '../state/uiStore';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const HANDLE_PX = 14; // 끝점 핸들 픽킹 반경 (화면 px)
const SNAP_PX = 12;
const GRID_MM = 100;

type DragMode =
  | { kind: 'none' }
  | { kind: 'wall'; id: string; startDoc: Pt; origA: Pt; origB: Pt }
  | { kind: 'endpoint'; id: string; which: 'a' | 'b' };

/**
 * 선택/이동: 클릭 픽킹 → 선택, 선택된 벽 드래그 = 평행 이동,
 * 끝점 핸들 드래그 = 단일 끝점 이동(스냅 적용). Delete는 main의 키 핸들러가 처리.
 */
export class SelectTool implements Tool {
  private drag: DragMode = { kind: 'none' };
  private handleA: THREE.Mesh;
  private handleB: THREE.Mesh;

  constructor(private ctx: EditorContext) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x2266ff });
    this.handleA = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
    this.handleB = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat.clone());
    this.handleA.visible = this.handleB.visible = false;
    ctx.engine.scene.add(this.handleA, this.handleB);

    // 선택 변경/문서 변경 시 핸들 위치 갱신
    useUiStore.subscribe(() => this.refreshHandles());
    ctx.store.observe(() => this.refreshHandles());
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const ui = useUiStore.getState();
    const selectedWall = this.selectedWall();

    // 1. 끝점 핸들 픽킹 (선택된 벽이 있을 때)
    if (selectedWall) {
      const tolMm = HANDLE_PX * info.mmPerPixel;
      const dA = Math.hypot(info.doc[0] - selectedWall.a[0], info.doc[1] - selectedWall.a[1]);
      const dB = Math.hypot(info.doc[0] - selectedWall.b[0], info.doc[1] - selectedWall.b[1]);
      if (dA <= tolMm || dB <= tolMm) {
        this.drag = {
          kind: 'endpoint',
          id: selectedWall.id,
          which: dA <= dB ? 'a' : 'b',
        };
        return;
      }
    }

    // 2. 요소 픽킹
    const hit = pickElement(info.clientX, info.clientY, this.ctx.rig.active, this.ctx.scene.pickables);
    ui.setSelection(hit);
    this.ctx.scene.setSelected(hit);
    if (hit) {
      const el = this.ctx.store.getElement(hit);
      if (el?.kind === 'wall') {
        this.drag = { kind: 'wall', id: hit, startDoc: info.doc, origA: el.a, origB: el.b };
      }
    }
  }

  move(info: ToolPointerInfo): void {
    if (!info.doc) return;
    if (this.drag.kind === 'wall') {
      // 평행 이동 — 델타를 그리드에 스냅
      const dx = Math.round((info.doc[0] - this.drag.startDoc[0]) / GRID_MM) * GRID_MM;
      const dy = Math.round((info.doc[1] - this.drag.startDoc[1]) / GRID_MM) * GRID_MM;
      this.ctx.store.updateElement(this.drag.id, {
        a: [this.drag.origA[0] + dx, this.drag.origA[1] + dy],
        b: [this.drag.origB[0] + dx, this.drag.origB[1] + dy],
      });
      this.showLength(this.drag.id);
    } else if (this.drag.kind === 'endpoint') {
      const el = this.ctx.store.getElement(this.drag.id);
      if (el?.kind !== 'wall') return;
      const other = this.drag.which === 'a' ? el.b : el.a;
      const snap = snapPoint([info.doc[0], info.doc[1]], {
        endpoints: this.ctx.store.wallEndpoints(el.levelId, el.id),
        endpointTolerance: SNAP_PX * info.mmPerPixel,
        grid: GRID_MM,
        axisFrom: other,
      });
      this.ctx.store.updateElement(this.drag.id, { [this.drag.which]: snap.point });
      this.showLength(this.drag.id);
    }
  }

  up(): void {
    this.drag = { kind: 'none' };
    this.ctx.hud.hideDimension();
  }

  cancel(): void {
    this.drag = { kind: 'none' };
    useUiStore.getState().setSelection(null);
    this.ctx.scene.setSelected(null);
    this.ctx.hud.hideDimension();
  }

  private selectedWall(): WallElement | null {
    const id = useUiStore.getState().selection;
    if (!id) return null;
    const el = this.ctx.store.getElement(id);
    return el?.kind === 'wall' ? el : null;
  }

  private refreshHandles(): void {
    const wall = this.selectedWall();
    if (!wall || useUiStore.getState().activeTool !== 'select') {
      this.handleA.visible = this.handleB.visible = false;
      this.ctx.engine.requestRender();
      return;
    }
    const level = this.ctx.store.getLevel(wall.levelId);
    const elev = (level?.elevation ?? 0) / 1000;
    this.handleA.position.set(wall.a[0] / 1000, elev + 0.02, wall.a[1] / 1000);
    this.handleB.position.set(wall.b[0] / 1000, elev + 0.02, wall.b[1] / 1000);
    this.handleA.scale.setScalar(0.07);
    this.handleB.scale.setScalar(0.07);
    this.handleA.visible = this.handleB.visible = true;
    this.ctx.engine.requestRender();
  }

  private showLength(id: string): void {
    const el = this.ctx.store.getElement(id);
    if (el?.kind !== 'wall') return;
    const level = this.ctx.store.getLevel(el.levelId);
    const elev = (level?.elevation ?? 0) / 1000;
    const lenMm = Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]);
    const mid = new THREE.Vector3(
      (el.a[0] + el.b[0]) / 2000,
      elev,
      (el.a[1] + el.b[1]) / 2000,
    );
    this.ctx.hud.showDimension(mid, lenMm, this.ctx.rig.active);
  }
}
