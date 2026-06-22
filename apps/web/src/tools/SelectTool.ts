import * as THREE from 'three';
import {
  elementFootprint,
  footprintCrossesRect,
  footprintInRect,
  rectFromPoints,
  resolveOpening,
  snapPoint,
  type CurtainWallElement,
  type OpeningType,
  type Pt,
  type Rect,
  type RoofElement,
  type SlabElement,
  type WallElement,
  type WallType,
  type ZoneElement,
} from '@figcad/core';
import { pickElement } from '../engine/Picker';
import { useUiStore } from '../state/uiStore';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';
import { EditActionController } from './EditActionController';
import { projectFootprint } from './selectFootprint';

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
  | { kind: 'vertex'; id: string; vertexIndex: number; origBoundary: Pt[]; levelId: string }
  | { kind: 'grid'; id: string; startDoc: Pt; origA: Pt; origB: Pt }
  | { kind: 'column'; id: string; startDoc: Pt; origAt: Pt }
  | { kind: 'beam'; id: string; startDoc: Pt; origA: Pt; origB: Pt }
  | { kind: 'box'; startX: number; startY: number; armed: boolean };

/**
 * 선택/이동: 클릭 픽킹 → 선택, 선택된 벽 드래그 = 평행 이동,
 * 끝점 핸들 드래그 = 단일 끝점 이동(스냅 적용). Delete는 main의 키 핸들러가 처리.
 * 드래그 시작 시 awareness editing 발행(소프트 락), 타인 락 대상은 드래그 거부.
 * 편집 액션(이동/복사/배열/대칭/분할/트림/회전)은 EditActionController에 위임.
 */
export class SelectTool implements Tool {
  private drag: DragMode = { kind: 'none' };
  private handleA: THREE.Mesh;
  private handleB: THREE.Mesh;
  private gripPool: THREE.Mesh[] = []; // 폴리곤 정점 그립 (필요분만 lazy 생성, 재사용)
  private lastWrite = 0;
  private pendingWrite: (() => void) | null = null;
  private action: EditActionController;

  constructor(private ctx: EditorContext) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a84ff });
    this.handleA = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
    this.handleB = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat.clone());
    this.handleA.visible = this.handleB.visible = false;
    ctx.engine.scene.add(this.handleA, this.handleB);
    this.action = new EditActionController(ctx, {
      setSelection: (ids) => this.setSelection(ids),
      refuseIfLocked: (id) => this.refuseIfLocked(id),
    });

    useUiStore.subscribe(() => this.refreshHandles());
    ctx.store.observe(() => this.refreshHandles());
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const ui = useUiStore.getState();

    // 편집 액션 무장 상태 — 클릭 = 액션 점 수집/실행 (선택/드래그 안 함)
    if (ui.editAction && ui.selection.length) {
      this.action.handle(ui.editAction, ui.selection, info);
      return;
    }

    const doc = info.doc;
    const tolMm = HANDLE_PX * info.mmPerPixel;

    // 1. 끝점 핸들 픽킹 (선택된 세그먼트 = 벽/커튼월)
    const seg = this.selectedSegment();
    if (seg) {
      const dA = Math.hypot(doc[0] - seg.a[0], doc[1] - seg.a[1]);
      const dB = Math.hypot(doc[0] - seg.b[0], doc[1] - seg.b[1]);
      if (dA <= tolMm || dB <= tolMm) {
        if (this.refuseIfLocked(seg.id)) return;
        this.drag = { kind: 'endpoint', id: seg.id, which: dA <= dB ? 'a' : 'b' };
        this.ctx.collab.setEditing(seg.id);
        return;
      }
    }

    // 1b. 폴리곤 정점 그립 픽킹 (선택된 슬라브/지붕/존) — 그립 안이면 정점편집, 밖이면 본체로 폴백
    const poly = this.selectedPolygon();
    if (poly) {
      let best = -1;
      let bestD = tolMm;
      poly.boundary.forEach((v, i) => {
        const d = Math.hypot(doc[0] - v[0], doc[1] - v[1]);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        if (this.refuseIfLocked(poly.id)) return;
        this.drag = { kind: 'vertex', id: poly.id, vertexIndex: best, origBoundary: poly.boundary, levelId: poly.levelId };
        this.ctx.collab.setEditing(poly.id);
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
    } else if (el.kind === 'slab' || el.kind === 'roof' || el.kind === 'zone') {
      // 경계 폴리곤 mover (roof·zone은 slab과 동일 — boundary 평행이동). 정점 그립은 본체 픽 전에 처리됨.
      this.drag = { kind: 'slab', id: hit, startDoc: info.doc, origBoundary: el.boundary };
    } else if (el.kind === 'grid') {
      this.drag = { kind: 'grid', id: hit, startDoc: info.doc, origA: el.a, origB: el.b };
    } else if (el.kind === 'column' || el.kind === 'text') {
      // 점 mover (text는 column과 동일 — at 평행이동)
      this.drag = { kind: 'column', id: hit, startDoc: info.doc, origAt: el.at };
    } else if (
      el.kind === 'beam' ||
      el.kind === 'stair' ||
      el.kind === 'railing' ||
      el.kind === 'curtainwall'
    ) {
      // a/b 세그먼트 mover (stair·railing·커튼월은 beam과 동일 — a/b 평행이동)
      this.drag = { kind: 'beam', id: hit, startDoc: info.doc, origA: el.a, origB: el.b };
    }
    // dimension은 드래그 분기 없음 — 선택만(이미 setSelection). 가동 파라미터=offset(InfoBox).
    // 바인딩된 치수의 a/b 드래그는 derive가 무시하므로 의도적으로 제외(advisor).
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
      this.action.updatePreview(info);
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
      if (el?.kind !== 'wall' && el?.kind !== 'curtainwall') return;
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
    } else if (this.drag.kind === 'vertex') {
      const drag = this.drag;
      const snap = snapPoint([info.doc[0], info.doc[1]], {
        endpoints: this.ctx.store.wallEndpoints(drag.levelId), // 폴리곤 자기 레벨 (활성 레벨 아님 — 끝점 분기와 동일)
        endpointTolerance: SNAP_PX * info.mmPerPixel,
        grid: GRID_MM,
      });
      // 이웃 정점에 겹치면 0길이 변 → isSimplePolygon이 못 잡으니 명시 50mm 가드
      const m = drag.origBoundary.length;
      const prev = drag.origBoundary[(drag.vertexIndex + m - 1) % m]!;
      const next = drag.origBoundary[(drag.vertexIndex + 1) % m]!;
      if (Math.hypot(snap.point[0] - prev[0], snap.point[1] - prev[1]) < 50) return;
      if (Math.hypot(snap.point[0] - next[0], snap.point[1] - next[1]) < 50) return;
      // 자가교차는 updateElement의 isSimplePolygon이 조용히 거부 → 그립이 직전 유효 위치에 머묾
      const boundary = drag.origBoundary.map((v, i) => (i === drag.vertexIndex ? snap.point : v));
      this.throttledWrite(() => this.ctx.store.updateElement(drag.id, { boundary }));
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
    } else if (this.drag.kind === 'beam') {
      const dx = Math.round((info.doc[0] - this.drag.startDoc[0]) / GRID_MM) * GRID_MM;
      const dy = Math.round((info.doc[1] - this.drag.startDoc[1]) / GRID_MM) * GRID_MM;
      const drag = this.drag;
      this.throttledWrite(() =>
        this.ctx.store.updateElement(drag.id, {
          a: [drag.origA[0] + dx, drag.origA[1] + dy],
          b: [drag.origB[0] + dx, drag.origB[1] + dy],
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
      const screen = projectFootprint(fp, el, camera, this.ctx.store);
      if (!screen) continue;
      if (crossing ? footprintCrossesRect(screen, rect) : footprintInRect(screen, rect))
        hits.push(el.id);
    }
    this.setSelection(hits);
  }

  cancel(): void {
    const ui = useUiStore.getState();
    if (ui.editAction) {
      // Esc 1단계: 액션만 해제, 선택 유지
      this.action.clear();
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
      this.action.clear();
      ui.setEditAction(null);
    }
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

  /** 단일 선택된 세그먼트(벽/커튼월) — 끝점 핸들·드래그용 */
  private selectedSegment(): WallElement | CurtainWallElement | null {
    const sel = useUiStore.getState().selection;
    if (sel.length !== 1) return null;
    const el = this.ctx.store.getElement(sel[0]!);
    return el?.kind === 'wall' || el?.kind === 'curtainwall' ? el : null;
  }

  /** 단일 선택된 경계 폴리곤(슬라브/지붕/존) — 정점 그립 편집용 */
  private selectedPolygon(): SlabElement | RoofElement | ZoneElement | null {
    const sel = useUiStore.getState().selection;
    if (sel.length !== 1) return null;
    const el = this.ctx.store.getElement(sel[0]!);
    return el?.kind === 'slab' || el?.kind === 'roof' || el?.kind === 'zone' ? el : null;
  }

  private segElev(seg: WallElement | CurtainWallElement): number {
    const base = this.ctx.store.getLevel(seg.levelId)?.elevation ?? 0;
    const off = seg.kind === 'curtainwall' ? (seg.baseOffset ?? 0) : 0;
    return (base + off) / 1000 + 0.02;
  }

  private polyElev(poly: SlabElement | RoofElement | ZoneElement): number {
    const level = this.ctx.store.getLevel(poly.levelId);
    const base = level?.elevation ?? 0;
    if (poly.kind === 'roof') return (base + (level?.height ?? 0) + (poly.baseOffset ?? 0)) / 1000;
    if (poly.kind === 'zone') return base / 1000 + 0.015;
    return base / 1000 + 0.02; // slab
  }

  private ensureGrip(i: number): THREE.Mesh {
    let g = this.gripPool[i];
    if (!g) {
      g = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), this.handleA.material as THREE.Material);
      this.ctx.engine.scene.add(g);
      this.gripPool[i] = g;
    }
    return g;
  }

  private hideGrips(from = 0): void {
    for (let i = from; i < this.gripPool.length; i++) this.gripPool[i]!.visible = false;
  }

  private refreshHandles(): void {
    if (useUiStore.getState().activeTool !== 'select') {
      this.handleA.visible = this.handleB.visible = false;
      this.hideGrips();
      this.ctx.engine.requestRender();
      return;
    }
    const seg = this.selectedSegment();
    if (seg) {
      const elev = this.segElev(seg);
      this.handleA.position.set(seg.a[0] / 1000, elev, seg.a[1] / 1000);
      this.handleB.position.set(seg.b[0] / 1000, elev, seg.b[1] / 1000);
      this.handleA.scale.setScalar(0.07);
      this.handleB.scale.setScalar(0.07);
      this.handleA.visible = this.handleB.visible = true;
      this.hideGrips();
      this.ctx.engine.requestRender();
      return;
    }
    const poly = this.selectedPolygon();
    if (poly) {
      this.handleA.visible = this.handleB.visible = false;
      const elev = this.polyElev(poly);
      poly.boundary.forEach((v, i) => {
        const g = this.ensureGrip(i);
        g.position.set(v[0] / 1000, elev, v[1] / 1000);
        g.scale.setScalar(0.07);
        g.visible = true;
      });
      this.hideGrips(poly.boundary.length);
      this.ctx.engine.requestRender();
      return;
    }
    this.handleA.visible = this.handleB.visible = false;
    this.hideGrips();
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
