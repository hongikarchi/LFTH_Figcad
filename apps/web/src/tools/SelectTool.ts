import * as THREE from 'three';
import {
  elementFootprint,
  footprintCrossesRect,
  footprintInRect,
  infiniteLineIntersect,
  rectFromPoints,
  resolveOpening,
  snapPoint,
  type Element,
  type Footprint,
  type OpeningType,
  type Pt,
  type Rect,
  type WallElement,
  type WallType,
} from '@figcad/core';
import { pickElement, worldToScreen } from '../engine/Picker';
import { useUiStore, type EditAction } from '../state/uiStore';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const HANDLE_PX = 14; // 끝점 핸들 픽킹 반경 (화면 px)
const SNAP_PX = 12;
const GRID_MM = 100;
const WRITE_THROTTLE_MS = 33; // 드래그 중 문서 쓰기 ~30Hz (Yjs 문서 비대화 방지)
const BOX_THRESHOLD_PX = 5; // 이 이상 끌어야 박스 선택 (미만은 클릭=해제)

type DragMode =
  | { kind: 'none' }
  | { kind: 'wall'; id: string; startDoc: Pt; origA: Pt; origB: Pt }
  | { kind: 'endpoint'; id: string; which: 'a' | 'b' }
  | { kind: 'opening'; id: string }
  | { kind: 'slab'; id: string; startDoc: Pt; origBoundary: Pt[] }
  | { kind: 'grid'; id: string; startDoc: Pt; origA: Pt; origB: Pt }
  | { kind: 'column'; id: string; startDoc: Pt; origAt: Pt }
  | { kind: 'box'; startX: number; startY: number; armed: boolean };

/**
 * 선택/이동: 클릭 픽킹 → 선택, 선택된 벽 드래그 = 평행 이동,
 * 끝점 핸들 드래그 = 단일 끝점 이동(스냅 적용). Delete는 main의 키 핸들러가 처리.
 * 드래그 시작 시 awareness editing 발행(소프트 락), 타인 락 대상은 드래그 거부.
 */
export class SelectTool implements Tool {
  private drag: DragMode = { kind: 'none' };
  private handleA: THREE.Mesh;
  private handleB: THREE.Mesh;
  private lastWrite = 0;
  private pendingWrite: (() => void) | null = null;
  // 편집 액션 상태머신 (이동/복사/배열/대칭의 수집된 점)
  private actionPoints: Pt[] = [];
  private rubber: THREE.Line;

  constructor(private ctx: EditorContext) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a84ff });
    this.handleA = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
    this.handleB = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat.clone());
    this.handleA.visible = this.handleB.visible = false;
    this.rubber = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x0a84ff }),
    );
    this.rubber.visible = false;
    ctx.engine.scene.add(this.handleA, this.handleB, this.rubber);

    useUiStore.subscribe(() => this.refreshHandles());
    ctx.store.observe(() => this.refreshHandles());
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const ui = useUiStore.getState();

    // 편집 액션 무장 상태 — 클릭 = 액션 점 수집/실행 (선택/드래그 안 함)
    if (ui.editAction && ui.selection.length) {
      this.handleAction(ui.editAction, ui.selection, info);
      return;
    }

    const selectedWall = this.selectedWall();

    // 1. 끝점 핸들 픽킹 (선택된 벽이 있을 때)
    if (selectedWall) {
      const tolMm = HANDLE_PX * info.mmPerPixel;
      const dA = Math.hypot(info.doc[0] - selectedWall.a[0], info.doc[1] - selectedWall.a[1]);
      const dB = Math.hypot(info.doc[0] - selectedWall.b[0], info.doc[1] - selectedWall.b[1]);
      if (dA <= tolMm || dB <= tolMm) {
        if (this.refuseIfLocked(selectedWall.id)) return;
        this.drag = {
          kind: 'endpoint',
          id: selectedWall.id,
          which: dA <= dB ? 'a' : 'b',
        };
        this.ctx.collab.setEditing(selectedWall.id);
        return;
      }
    }

    // 2. 요소 픽킹 — 종류별 드래그 준비
    const hit = pickElement(info.clientX, info.clientY, this.ctx.rig.active, this.ctx.scene.pickables);
    if (!hit) {
      // 빈 공간 — 박스 선택 대기 (즉시 해제하지 않음. 끌면 박스, 안 끌면 up에서 해제)
      this.drag = { kind: 'box', startX: info.clientX, startY: info.clientY, armed: false };
      return;
    }
    this.setSelection([hit]);
    const el = this.ctx.store.getElement(hit);
    if (!el) return;
    if (this.refuseIfLocked(hit)) return; // 선택은 허용, 드래그만 거부
    if (el.kind === 'wall') {
      this.drag = { kind: 'wall', id: hit, startDoc: info.doc, origA: el.a, origB: el.b };
    } else if (el.kind === 'opening') {
      this.drag = { kind: 'opening', id: hit };
    } else if (el.kind === 'slab') {
      this.drag = { kind: 'slab', id: hit, startDoc: info.doc, origBoundary: el.boundary };
    } else if (el.kind === 'grid') {
      this.drag = { kind: 'grid', id: hit, startDoc: info.doc, origA: el.a, origB: el.b };
    } else if (el.kind === 'column') {
      this.drag = { kind: 'column', id: hit, startDoc: info.doc, origAt: el.at };
    }
    if (this.drag.kind !== 'none') this.ctx.collab.setEditing(hit);
  }

  /** 선택 갱신 — uiStore + 씬 하이라이트 동기 */
  private setSelection(ids: string[]): void {
    useUiStore.getState().setSelection(ids);
    this.ctx.scene.setSelected(ids);
  }

  move(info: ToolPointerInfo): void {
    if (this.drag.kind === 'box') {
      const d = this.drag;
      if (!d.armed && Math.hypot(info.clientX - d.startX, info.clientY - d.startY) >= BOX_THRESHOLD_PX)
        d.armed = true;
      if (d.armed) {
        const crossing = info.clientX < d.startX; // 우→좌 = crossing (Rhino)
        this.ctx.hud.showDragBox(d.startX, d.startY, info.clientX, info.clientY, crossing);
        this.ctx.engine.requestRender();
      }
      return;
    }
    if (!info.doc) return;
    const ui = useUiStore.getState();
    if (ui.editAction) {
      this.updateActionPreview(info);
      return;
    }
    if (this.drag.kind === 'wall') {
      const dx = Math.round((info.doc[0] - this.drag.startDoc[0]) / GRID_MM) * GRID_MM;
      const dy = Math.round((info.doc[1] - this.drag.startDoc[1]) / GRID_MM) * GRID_MM;
      const drag = this.drag;
      this.throttledWrite(() =>
        this.ctx.store.updateElement(drag.id, {
          a: [drag.origA[0] + dx, drag.origA[1] + dy],
          b: [drag.origB[0] + dx, drag.origB[1] + dy],
        }),
      );
      this.showLength(this.drag.id);
    } else if (this.drag.kind === 'endpoint') {
      const el = this.ctx.store.getElement(this.drag.id);
      if (el?.kind !== 'wall') return;
      const which = this.drag.which;
      const other = which === 'a' ? el.b : el.a;
      const snap = snapPoint([info.doc[0], info.doc[1]], {
        endpoints: this.ctx.store.wallEndpoints(el.levelId, el.id),
        endpointTolerance: SNAP_PX * info.mmPerPixel,
        grid: GRID_MM,
        axisFrom: other,
      });
      // 0길이 붕괴 방지 — WallTool과 동일한 50mm 최소 길이
      if (Math.hypot(snap.point[0] - other[0], snap.point[1] - other[1]) < 50) return;
      const id = this.drag.id;
      this.throttledWrite(() => this.ctx.store.updateElement(id, { [which]: snap.point }));
      this.showLength(this.drag.id);
    } else if (this.drag.kind === 'opening') {
      // 호스트 중심선에 투영 → resolveOpening으로 클램프된 offset만 기록
      // (OpeningTool 배치와 동일 — 문서값과 렌더값이 벌어지지 않게)
      const el = this.ctx.store.getElement(this.drag.id);
      if (el?.kind !== 'opening') return;
      const host = this.ctx.store.getElement(el.hostId);
      if (host?.kind !== 'wall') return;
      const type = this.ctx.store.getType(el.typeId) as OpeningType | undefined;
      const hostWall = host as WallElement;
      const level = this.ctx.store.getLevel(hostWall.levelId);
      const hostType = this.ctx.store.getType(hostWall.typeId) as WallType | undefined;
      if (!type || type.kind !== 'opening' || !level || !hostType) return;
      const len = Math.hypot(hostWall.b[0] - hostWall.a[0], hostWall.b[1] - hostWall.a[1]);
      if (len === 0) return;
      const dir = [(hostWall.b[0] - hostWall.a[0]) / len, (hostWall.b[1] - hostWall.a[1]) / len] as const;
      const projected = Math.round(
        (info.doc[0] - hostWall.a[0]) * dir[0] + (info.doc[1] - hostWall.a[1]) * dir[1],
      );
      const r = resolveOpening(
        { ...el, offset: projected },
        type,
        hostWall,
        hostWall.height ?? level.height,
      );
      if (!r) return;
      const id = this.drag.id;
      this.throttledWrite(() => this.ctx.store.updateElement(id, { offset: r.offset }));
    } else if (this.drag.kind === 'slab') {
      const dx = Math.round((info.doc[0] - this.drag.startDoc[0]) / GRID_MM) * GRID_MM;
      const dy = Math.round((info.doc[1] - this.drag.startDoc[1]) / GRID_MM) * GRID_MM;
      const drag = this.drag;
      this.throttledWrite(() =>
        this.ctx.store.updateElement(drag.id, {
          boundary: drag.origBoundary.map(([x, y]) => [x + dx, y + dy]),
        }),
      );
    } else if (this.drag.kind === 'grid') {
      const dx = Math.round((info.doc[0] - this.drag.startDoc[0]) / GRID_MM) * GRID_MM;
      const dy = Math.round((info.doc[1] - this.drag.startDoc[1]) / GRID_MM) * GRID_MM;
      const drag = this.drag;
      this.throttledWrite(() =>
        this.ctx.store.updateElement(drag.id, {
          a: [drag.origA[0] + dx, drag.origA[1] + dy],
          b: [drag.origB[0] + dx, drag.origB[1] + dy],
        }),
      );
    } else if (this.drag.kind === 'column') {
      const dx = Math.round((info.doc[0] - this.drag.startDoc[0]) / GRID_MM) * GRID_MM;
      const dy = Math.round((info.doc[1] - this.drag.startDoc[1]) / GRID_MM) * GRID_MM;
      const drag = this.drag;
      this.throttledWrite(() =>
        this.ctx.store.updateElement(drag.id, {
          at: [drag.origAt[0] + dx, drag.origAt[1] + dy],
        }),
      );
    }
  }

  up(info: ToolPointerInfo): void {
    if (this.drag.kind === 'box') {
      const d = this.drag;
      this.ctx.hud.hideDragBox();
      if (d.armed) {
        const crossing = info.clientX < d.startX;
        this.boxSelect(d.startX, d.startY, info.clientX, info.clientY, crossing);
      } else {
        this.setSelection([]); // 끌지 않은 클릭 = 해제
      }
      this.drag = { kind: 'none' };
      this.ctx.engine.requestRender();
      return;
    }
    if (useUiStore.getState().editAction) return; // 액션 모드 — down에서 처리
    this.flushWrite(); // 마지막 정확값 1회 기록
    if (this.drag.kind !== 'none') this.ctx.collab.setEditing(null);
    this.drag = { kind: 'none' };
    this.ctx.hud.hideDimension();
  }

  /**
   * 박스 선택 — 화면 px 사각형 안/교차 요소 선택 (Rhino window/crossing).
   * 판정은 화면 공간: 각 요소 풋프린트(문서 mm)를 카메라로 투영해 비교 (원근/평면 모두 정확).
   */
  private boxSelect(x1: number, y1: number, x2: number, y2: number, crossing: boolean): void {
    const rect: Rect = rectFromPoints([x1, y1], [x2, y2]);
    const camera = this.ctx.rig.active;
    const hits: string[] = [];
    for (const el of this.ctx.store.listElements()) {
      const fp = elementFootprint(el, this.ctx.store);
      const screen = this.projectFootprint(fp, el, camera);
      if (!screen) continue;
      if (crossing ? footprintCrossesRect(screen, rect) : footprintInRect(screen, rect))
        hits.push(el.id);
    }
    this.setSelection(hits);
  }

  /** 요소 풋프린트(문서 mm)를 화면 px 풋프린트로 투영 */
  private projectFootprint(fp: Footprint, el: Element, camera: THREE.Camera): Footprint {
    if (!fp) return null;
    const elevMm = this.elevationOf(el);
    const toScreen = (p: Pt): Pt => {
      const s = worldToScreen(new THREE.Vector3(p[0] / 1000, elevMm / 1000, p[1] / 1000), camera);
      return [s.x, s.y];
    };
    if (fp.kind === 'point') return { kind: 'point', p: toScreen(fp.p) };
    if (fp.kind === 'segment') return { kind: 'segment', a: toScreen(fp.a), b: toScreen(fp.b) };
    return { kind: 'polygon', pts: fp.pts.map(toScreen) };
  }

  private elevationOf(el: Element): number {
    if (el.kind === 'grid') return 0;
    if (el.kind === 'opening') {
      const host = this.ctx.store.getElement(el.hostId);
      const lv = host && 'levelId' in host ? this.ctx.store.getLevel(host.levelId) : undefined;
      return lv?.elevation ?? 0;
    }
    return this.ctx.store.getLevel(el.levelId)?.elevation ?? 0;
  }

  cancel(): void {
    const ui = useUiStore.getState();
    if (ui.editAction) {
      // Esc 1단계: 액션만 해제, 선택 유지
      this.clearActionState();
      ui.setEditAction(null);
      return;
    }
    this.flushWrite();
    if (this.drag.kind !== 'none') this.ctx.collab.setEditing(null);
    this.drag = { kind: 'none' };
    this.ctx.hud.hideDragBox();
    this.setSelection([]);
    this.ctx.hud.hideDimension();
  }

  /** RMB 클릭 = Enter — 진행 중 액션 종료 (copy 반복 종료 등) */
  enter(): void {
    const ui = useUiStore.getState();
    if (ui.editAction) {
      this.clearActionState();
      ui.setEditAction(null);
    }
  }

  // ===== 편집 액션 상태머신 =====

  private handleAction(action: EditAction, ids: string[], info: ToolPointerInfo): void {
    const selId = ids[0]!;
    const el = this.ctx.store.getElement(selId);
    if (!el) {
      this.finishAction();
      return;
    }
    if (this.refuseIfLocked(selId)) return;
    const p = this.snapActionPoint(info);

    switch (action) {
      case 'move': {
        if (!this.actionPoints.length) {
          this.actionPoints.push(p);
        } else {
          const base = this.actionPoints[0]!;
          this.ctx.store.moveElements(ids, [p[0] - base[0], p[1] - base[1]]);
          this.finishAction();
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
          this.finishAction();
        }
        break;
      }
      case 'mirror': {
        this.actionPoints.push(p);
        if (this.actionPoints.length === 2) {
          this.ctx.store.mirrorElements(ids, this.actionPoints[0]!, this.actionPoints[1]!);
          this.finishAction();
        }
        break;
      }
      case 'split': {
        const result = this.ctx.store.splitWall(selId, p);
        if (result) {
          this.setSelection([result[0]]);
        } else {
          this.ctx.hud.toast('끝에서 너무 가까워 분할할 수 없습니다');
        }
        this.finishAction();
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
          this.finishAction();
          break;
        }
        const dA = Math.hypot(cross[0] - el.a[0], cross[1] - el.a[1]);
        const dB = Math.hypot(cross[0] - el.b[0], cross[1] - el.b[1]);
        const ok = this.ctx.store.trimExtendWall(selId, dA < dB ? 'a' : 'b', target);
        if (!ok) this.ctx.hud.toast('연장/자르기 결과가 유효하지 않습니다');
        this.finishAction();
        break;
      }
      case 'rotate': {
        const deg = useUiStore.getState().rotateAngle;
        this.ctx.store.rotateElements(ids, p, (deg * Math.PI) / 180);
        this.finishAction();
        break;
      }
    }
    this.ctx.engine.requestRender();
  }

  private snapActionPoint(info: ToolPointerInfo): Pt {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: this.ctx.store.wallEndpoints(this.ctx.levelId()),
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
      ...(this.actionPoints.length
        ? { axisFrom: this.actionPoints[this.actionPoints.length - 1]! }
        : {}),
    }).point;
  }

  private updateActionPreview(info: ToolPointerInfo): void {
    if (!this.actionPoints.length || !info.doc) return;
    const base = this.actionPoints[this.actionPoints.length - 1]!;
    const p = this.snapActionPoint(info);
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

  private clearActionState(): void {
    this.actionPoints = [];
    this.rubber.visible = false;
    this.ctx.hud.hideDimension();
    this.ctx.engine.requestRender();
  }

  private finishAction(): void {
    this.clearActionState();
    useUiStore.getState().setEditAction(null);
  }

  /** 타인이 편집 중이면 토스트 + true */
  private refuseIfLocked(id: string): boolean {
    const owner = this.ctx.collab.lockOwner(id);
    if (owner) {
      this.ctx.hud.toast(`✏ ${owner} 님이 편집 중입니다`);
      return true;
    }
    return false;
  }

  private throttledWrite(write: () => void): void {
    const now = performance.now();
    if (now - this.lastWrite >= WRITE_THROTTLE_MS) {
      this.lastWrite = now;
      this.pendingWrite = null;
      write();
    } else {
      this.pendingWrite = write;
    }
  }

  private flushWrite(): void {
    if (this.pendingWrite) {
      this.pendingWrite();
      this.pendingWrite = null;
    }
  }

  private selectedWall(): WallElement | null {
    // 끝점 핸들·길이칩은 단일 벽 선택일 때만
    const sel = useUiStore.getState().selection;
    if (sel.length !== 1) return null;
    const el = this.ctx.store.getElement(sel[0]!);
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
