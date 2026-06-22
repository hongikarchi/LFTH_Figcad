import * as THREE from 'three';
import { infiniteLineIntersect, snapPoint, type Pt } from '@figcad/core';
import { pickElement } from '../engine/Picker';
import { useUiStore, type EditAction } from '../state/uiStore';
import type { EditorContext } from './context';
import type { ToolPointerInfo } from './ToolController';

const SNAP_PX = 12; // = SelectTool과 동일
const GRID_MM = 100;

/**
 * 편집 액션 상태머신 — 이동/복사/배열/대칭/분할/트림/회전의 점 수집·실행.
 * SelectTool이 위임(down→handle, move→updatePreview, cancel/enter→clear).
 * 자체 고무줄(rubber) + 수집점(actionPoints) 소유. 선택/락은 deps 콜백.
 */
export class EditActionController {
  private actionPoints: Pt[] = [];
  private rubber: THREE.Line;

  constructor(
    private ctx: EditorContext,
    private deps: {
      setSelection: (ids: string[]) => void;
      refuseIfLocked: (id: string) => boolean;
    },
  ) {
    this.rubber = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x0a84ff }),
    );
    this.rubber.visible = false;
    ctx.engine.scene.add(this.rubber);
  }

  handle(action: EditAction, ids: string[], info: ToolPointerInfo): void {
    const selId = ids[0]!;
    const el = this.ctx.store.getElement(selId);
    if (!el) {
      this.finish();
      return;
    }
    if (this.deps.refuseIfLocked(selId)) return;
    const p = this.snap(info);

    switch (action) {
      case 'move': {
        if (!this.actionPoints.length) {
          this.actionPoints.push(p);
        } else {
          const base = this.actionPoints[0]!;
          this.ctx.store.moveElements(ids, [p[0] - base[0], p[1] - base[1]]);
          this.finish();
        }
        break;
      }
      case 'copy': {
        if (!this.actionPoints.length) {
          this.actionPoints.push(p);
        } else {
          const base = this.actionPoints[0]!;
          this.ctx.store.duplicateElements(ids, [p[0] - base[0], p[1] - base[1]]);
          // 무장 유지 — 같은 기준점으로 반복 복사 (Esc/우클릭으로 종료)
        }
        break;
      }
      case 'array': {
        if (!this.actionPoints.length) {
          this.actionPoints.push(p);
        } else {
          const base = this.actionPoints[0]!;
          this.ctx.store.arrayElements(
            ids,
            [p[0] - base[0], p[1] - base[1]],
            useUiStore.getState().arrayCount,
          );
          this.finish();
        }
        break;
      }
      case 'mirror': {
        this.actionPoints.push(p);
        if (this.actionPoints.length === 2) {
          this.ctx.store.mirrorElements(ids, this.actionPoints[0]!, this.actionPoints[1]!);
          this.finish();
        }
        break;
      }
      case 'split': {
        const result = this.ctx.store.splitWall(selId, p);
        if (result) {
          this.deps.setSelection([result[0]]);
        } else {
          this.ctx.hud.toast('끝에서 너무 가까워 분할할 수 없습니다');
        }
        this.finish();
        break;
      }
      case 'trim': {
        const hit = pickElement(
          info.clientX,
          info.clientY,
          this.ctx.rig.active,
          this.ctx.scene.pickables,
        );
        const target = hit && hit !== selId ? this.ctx.store.getElement(hit) : undefined;
        if (target?.kind !== 'wall' || el.kind !== 'wall') {
          this.ctx.hud.toast('기준이 될 다른 벽을 클릭하세요');
          break;
        }
        const cross = infiniteLineIntersect(el.a, el.b, target.a, target.b);
        if (!cross) {
          this.ctx.hud.toast('평행한 벽으로는 연장/자르기 불가');
          this.finish();
          break;
        }
        const dA = Math.hypot(cross[0] - el.a[0], cross[1] - el.a[1]);
        const dB = Math.hypot(cross[0] - el.b[0], cross[1] - el.b[1]);
        const ok = this.ctx.store.trimExtendWall(selId, dA < dB ? 'a' : 'b', target);
        if (!ok) this.ctx.hud.toast('연장/자르기 결과가 유효하지 않습니다');
        this.finish();
        break;
      }
      case 'rotate': {
        const deg = useUiStore.getState().rotateAngle;
        this.ctx.store.rotateElements(ids, p, (deg * Math.PI) / 180);
        this.finish();
        break;
      }
    }
    this.ctx.engine.requestRender();
  }

  private snap(info: ToolPointerInfo): Pt {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: this.ctx.store.wallEndpoints(this.ctx.levelId()),
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
      ...(this.actionPoints.length
        ? { axisFrom: this.actionPoints[this.actionPoints.length - 1]! }
        : {}),
    }).point;
  }

  updatePreview(info: ToolPointerInfo): void {
    if (!this.actionPoints.length || !info.doc) return;
    const base = this.actionPoints[this.actionPoints.length - 1]!;
    const p = this.snap(info);
    const elev = (this.ctx.store.getLevel(this.ctx.levelId())?.elevation ?? 0) / 1000;
    this.rubber.geometry.setFromPoints([
      new THREE.Vector3(base[0] / 1000, elev + 0.03, base[1] / 1000),
      new THREE.Vector3(p[0] / 1000, elev + 0.03, p[1] / 1000),
    ]);
    this.rubber.visible = true;
    const lenMm = Math.hypot(p[0] - base[0], p[1] - base[1]);
    this.ctx.hud.showDimension(
      new THREE.Vector3((base[0] + p[0]) / 2000, elev + 0.03, (base[1] + p[1]) / 2000),
      lenMm,
      this.ctx.rig.active,
    );
    this.ctx.engine.requestRender();
  }

  clear(): void {
    this.actionPoints = [];
    this.rubber.visible = false;
    this.ctx.hud.hideDimension();
    this.ctx.engine.requestRender();
  }

  private finish(): void {
    this.clear();
    useUiStore.getState().setEditAction(null);
  }
}
