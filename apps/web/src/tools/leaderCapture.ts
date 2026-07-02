import * as THREE from 'three';
import { snapPoint, type Element, type Pt, type SnapResult } from '@figcad/core';
import { pickElement } from '../engine/Picker';
import { refSnapAt } from '../engine/refSnap';
import type { RefObjectInfo } from '../engine/refIdentity';
import { updateSnapMarker3d, REF_MARKER_COLORS } from './snapMarker';
import { useUiStore } from '../state/uiStore';
import type { EditorContext } from './context';
import type { ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;

export interface LeaderResult {
  /** 지시선 시작점(앵커) — doc mm. 클릭1 위치. */
  anchor: Pt;
  /** 앵커에서 픽된 요소(있으면) — 라벨 targetId / 코멘트 anchorId 후보 */
  anchorEl: Element | null;
  /** 앵커 레벨 (요소 위면 그 요소 레벨, 아니면 활성 레벨) */
  anchorLevelId: string;
  /** 텍스트/말풍선 위치 — doc mm. 클릭2 위치. */
  textAt: Pt;
  /** 클릭2가 오버레이/메시 표면을 맞혔으면 그 3D 높이(월드 mm) — 3D 코멘트 핀. 평면 바닥이면 undefined. */
  textZ?: number;
  /** 클릭1이 요소가 아닌 임포트(연동 모델) 메시 위였을 때의 객체 식별 — 라벨 프리필용 (anchorEl===null일 때만). */
  refHit?: RefObjectInfo;
}

/**
 * 2클릭 지시선(leader) 캡처 — 클릭1=지시선 시작점(앵커), 클릭2=텍스트 위치 (iter-2 3-2).
 * 레이블·코멘트가 공유(같은 생성 UX, 색만 다름: 레이블=주황, 코멘트=파랑).
 * up마다 단계 진행, onComplete(result) 후 리셋. cancel/enter = 취소. 입력잠금은 호출 도구가 게이트.
 */
export class LeaderCapture {
  private marker: THREE.Mesh;
  private line: THREE.Line;
  private anchor: { pt: Pt; el: Element | null; levelId: string; refInfo?: RefObjectInfo } | null = null;
  private lastHoverTs = 0; // 3D 호버 레이캐스트 스로틀 — 대형 임포트(BVH 없는 수백만 tri)서 per-move 비용 상한

  constructor(
    private ctx: EditorContext,
    private color: number,
    private onComplete: (r: LeaderResult) => void,
  ) {
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color }),
    );
    this.marker.visible = false;
    this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }));
    this.line.visible = false;
    ctx.engine.scene.add(this.marker, this.line);
  }

  /** true = 지시선 시작점 대기(클릭1 전), false = 텍스트 위치 대기(클릭1 후) */
  get awaitingAnchor(): boolean {
    return this.anchor === null;
  }

  move(info: ToolPointerInfo): void {
    // 3D 모드 — 메시 피처 스냅(꼭짓점>에지, 임포트 포함) 지점에 마커 (기존엔 3D서 마커 미표시였음).
    if (useUiStore.getState().viewMode === '3d') {
      // ~30Hz 스로틀 — 이 호버 레이캐스트는 신규 비용(기존엔 up에서만). 드래그 기록 스로틀 관례와 동일.
      const now = performance.now();
      if (now - this.lastHoverTs < 33) return;
      this.lastHoverTs = now;
      const roots = this.ctx.overlayRoot ? [this.ctx.overlayRoot, ...this.ctx.scene.pickables] : this.ctx.scene.pickables;
      const r = refSnapAt(info.clientX, info.clientY, this.ctx.rig.active, roots, SNAP_PX);
      if (r) {
        updateSnapMarker3d(this.marker, r.point, r.kind === 'face' ? this.color : REF_MARKER_COLORS[r.kind], info.mmPerPixel);
        if (this.anchor) this.updateLine([Math.round(r.point.x * 1000), Math.round(r.point.z * 1000)]);
        this.ctx.engine.requestRender();
        return;
      }
    }
    if (!info.doc) return;
    const pt = this.snap(info).point;
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(this.color); // 3D 스냅 색 복원
    this.updateMarker(pt, info.mmPerPixel);
    if (this.anchor) this.updateLine(pt);
    this.ctx.engine.requestRender();
  }

  up(info: ToolPointerInfo): void {
    // 3D 모드면 메시 피처 스냅 히트 우선(z 포함, 임포트 꼭짓점/에지 스냅), 평면은 지면 스냅만
    // (perf: 평면선 60MB 레이캐스트 스킵).
    const is3d = useUiStore.getState().viewMode === '3d';
    const roots = this.ctx.overlayRoot ? [this.ctx.overlayRoot, ...this.ctx.scene.pickables] : this.ctx.scene.pickables;
    const r = is3d ? refSnapAt(info.clientX, info.clientY, this.ctx.rig.active, roots, SNAP_PX) : null;
    const ground = info.doc ? this.snap(info).point : null;
    // 배치점 = 메시 히트(3D점) 우선 > 지면 스냅. 둘 다 없으면(수평선 위·지면 밖 탭) 취소.
    const pt: Pt | null = r ? [Math.round(r.point.x * 1000), Math.round(r.point.z * 1000)] : ground;
    const hitY = r ? r.point.y : undefined; // refSnap 결과는 스크래치 — 즉시 값으로 복사
    if (!pt) return;
    if (!this.anchor) {
      // 클릭1 = 지시선 시작점 (요소 위면 그 요소를 앵커로 — 요소 픽 우선, 임포트는 refInfo로 보조)
      const hit = pickElement(info.clientX, info.clientY, this.ctx.rig.active, this.ctx.scene.pickables);
      const el = hit ? (this.ctx.store.getElement(hit) ?? null) : null;
      const levelId = el && 'levelId' in el ? el.levelId : this.ctx.levelId();
      this.anchor = { pt, el, levelId, ...(!el && r?.info ? { refInfo: r.info } : {}) };
      this.line.visible = true;
      this.updateLine(pt);
      this.ctx.engine.requestRender();
      return;
    }
    // 클릭2 = 텍스트/핀 위치 → 완료. 메시 표면이면 그 3D 높이(textZ) = 모델 위 3D 코멘트.
    const a = this.anchor;
    const textZ = hitY !== undefined ? hitY * 1000 : undefined;
    this.reset();
    this.onComplete({
      anchor: a.pt,
      anchorEl: a.el,
      anchorLevelId: a.levelId,
      textAt: pt,
      ...(textZ !== undefined ? { textZ } : {}),
      ...(a.el === null && a.refInfo ? { refHit: a.refInfo } : {}),
    });
  }

  cancel(): void {
    this.reset();
    this.ctx.engine.requestRender();
  }

  /** 마커·지시선·단계 초기화 (완료/취소 공통) */
  reset(): void {
    this.anchor = null;
    this.marker.visible = false;
    this.line.visible = false;
  }

  private snap(info: ToolPointerInfo): SnapResult {
    const tol = SNAP_PX * info.mmPerPixel;
    const near: Pt = [info.doc![0], info.doc![1]];
    return snapPoint(near, {
      endpoints: [
        ...this.ctx.store.wallEndpoints(this.ctx.levelId()),
        ...(this.ctx.importSnapCandidates?.(near, tol) ?? []), // 빽도면 끝점 (읽기전용 트레이싱)
      ],
      endpointTolerance: tol,
      grid: GRID_MM,
    });
  }

  private anchorElev(): number {
    return (this.ctx.store.getLevel(this.anchor?.levelId ?? this.ctx.levelId())?.elevation ?? 0) / 1000;
  }

  private updateMarker(pt: Pt, mmPerPixel: number): void {
    const elev = (this.ctx.store.getLevel(this.ctx.levelId())?.elevation ?? 0) / 1000;
    this.marker.visible = true;
    this.marker.position.set(pt[0] / 1000, elev + 0.02, pt[1] / 1000);
    this.marker.scale.setScalar(Math.max((6 * mmPerPixel) / 1000, 0.01));
  }

  private updateLine(cursor: Pt): void {
    if (!this.anchor) return;
    const elev = this.anchorElev() + 0.02;
    const a = this.anchor.pt;
    this.line.geometry.setFromPoints([
      new THREE.Vector3(a[0] / 1000, elev, a[1] / 1000),
      new THREE.Vector3(cursor[0] / 1000, elev, cursor[1] / 1000),
    ]);
  }
}
