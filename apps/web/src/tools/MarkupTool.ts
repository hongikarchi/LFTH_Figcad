import * as THREE from 'three';
import type { Pt, SketchElement } from '@figcad/core';
import { screenToWorldPlane } from '../engine/Picker';
import { useUiStore } from '../state/uiStore';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const MIN_SEG_MM = 40; // 정점 최소 간격(데시메이트 — Y.Doc 비대화·draw call 예산)

interface DrawPlane {
  origin: THREE.Vector3; // m
  right: THREE.Vector3; // 단위
  up: THREE.Vector3; // 단위
  normal: THREE.Vector3; // 단위 (카메라 시선)
}

/**
 * 마크업 펜 (iter-3 스케치 업그레이드) — 프리핸드 스트로크를 영속 SketchElement로 커밋.
 * 평면뷰 = 레벨 바닥(uv=문서 mm) · 3D뷰 = 카메라 정면 자유 평면(frame, uv=평면-로컬 mm, S4).
 * 스타일·모드 = uiStore. 프리뷰만 명령형 Three 라인(불변③). grid-snap 안 함. 펜=도구(InputManager 자동).
 */
export class MarkupTool implements Tool {
  private group: THREE.Group;
  private mat: THREE.LineBasicMaterial;
  private points: Pt[] = []; // 평면-로컬 uv (mm)
  private drawing = false;
  private plane: DrawPlane | null = null; // 3D 자유평면 — null=레벨 바닥(평면뷰)

  constructor(private ctx: EditorContext) {
    this.group = new THREE.Group();
    this.mat = new THREE.LineBasicMaterial({ color: 0x0a84ff });
    ctx.engine.scene.add(this.group);
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    this.drawing = true;
    this.mat.color.set(useUiStore.getState().sketchStyle.color);
    // 3D뷰 = 카메라 정면 자유 평면, 평면뷰 = 레벨 바닥
    this.plane = useUiStore.getState().viewMode === '3d' ? this.buildCameraPlane() : null;
    const p = this.capture(info);
    this.points = p ? [p] : [];
    this.redraw();
  }

  move(info: ToolPointerInfo): void {
    if (!this.drawing) return;
    const p = this.capture(info);
    if (!p) return;
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_SEG_MM) return; // 데시메이트
    this.points.push(p);
    this.redraw();
    this.ctx.engine.requestRender();
  }

  up(info: ToolPointerInfo): void {
    if (!this.drawing) return;
    this.drawing = false;
    const p = this.capture(info);
    const last = this.points[this.points.length - 1];
    if (p && last && Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1) this.points.push(p);
    this.commit();
    this.clearPreview();
  }

  cancel(): void {
    this.drawing = false;
    this.clearPreview();
  }

  /** 포인터 → 평면-로컬 uv (mm). 3D=카메라평면 투영, 평면=레벨 바닥(info.doc). */
  private capture(info: ToolPointerInfo): Pt | null {
    if (!this.plane) return info.doc ?? null;
    const hit = screenToWorldPlane(info.clientX, info.clientY, this.ctx.rig.active, this.plane.origin, this.plane.normal);
    if (!hit) return null;
    const d = hit.sub(this.plane.origin);
    return [d.dot(this.plane.right) * 1000, d.dot(this.plane.up) * 1000]; // m→mm
  }

  private buildCameraPlane(): DrawPlane {
    const cam = this.ctx.rig.active;
    const normal = cam.getWorldDirection(new THREE.Vector3());
    const origin = cam.position.clone().addScaledVector(normal, this.ctx.rig.viewDistance); // ~궤도 타깃
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    return { origin, right, up, normal };
  }

  private frameForCommit(): SketchElement['frame'] | undefined {
    if (!this.plane) return undefined;
    const o = this.plane.origin;
    return {
      o: [o.x * 1000, o.y * 1000, o.z * 1000],
      x: [this.plane.right.x, this.plane.right.y, this.plane.right.z],
      y: [this.plane.up.x, this.plane.up.y, this.plane.up.z],
    };
  }

  private commit(): void {
    if (this.points.length < 2) return;
    const ui = useUiStore.getState();
    this.ctx.store.createSketch({
      levelId: this.ctx.levelId(),
      mode: ui.sketchMode,
      boundary: this.points,
      style: ui.sketchStyle,
      frame: this.frameForCommit(),
    });
    this.ctx.engine.requestRender();
  }

  private clearPreview(): void {
    for (const c of this.group.children) (c as THREE.Line).geometry.dispose();
    this.group.clear();
    this.points = [];
    this.plane = null;
    this.ctx.engine.requestRender();
  }

  /** uv(mm) → 월드(m): 3D=origin+u·right+v·up, 평면=레벨 바닥. */
  private toWorld(u: number, v: number): THREE.Vector3 {
    if (this.plane) {
      return this.plane.origin
        .clone()
        .addScaledVector(this.plane.right, u * 0.001)
        .addScaledVector(this.plane.up, v * 0.001);
    }
    const y = (this.ctx.store.getLevel(this.ctx.levelId())?.elevation ?? 0) / 1000 + 0.031;
    return new THREE.Vector3(u * 0.001, y, v * 0.001);
  }

  private redraw(): void {
    for (const c of this.group.children) (c as THREE.Line).geometry.dispose();
    this.group.clear();
    if (this.points.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(this.points.map(([u, v]) => this.toWorld(u, v)));
    this.group.add(new THREE.Line(geo, this.mat));
  }
}
