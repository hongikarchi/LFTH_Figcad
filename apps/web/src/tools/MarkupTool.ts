import * as THREE from 'three';
import type { Pt } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const MIN_SEG_MM = 40; // 정점 최소 간격(데시메이트 — Y.Doc 비대화·draw call 예산)

/**
 * 마크업 펜 (iter-3 스케치 업그레이드) — 프리핸드 스트로크를 영속 SketchElement로 커밋.
 * 평면=레벨 바닥, 3D=활성 레벨 바닥(screenToDoc; 자유 3D 평면은 S4). 스타일·모드는 uiStore.
 * 프리뷰만 명령형 Three 라인(불변③). grid-snap 안 함(프리핸드 계단현상). 펜=도구라 InputManager 자동 라우팅.
 */
export class MarkupTool implements Tool {
  private group: THREE.Group;
  private mat: THREE.LineBasicMaterial;
  private points: Pt[] = [];
  private drawing = false;

  constructor(private ctx: EditorContext) {
    this.group = new THREE.Group();
    this.mat = new THREE.LineBasicMaterial({ color: 0x0a84ff });
    ctx.engine.scene.add(this.group);
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    this.points = [info.doc];
    this.drawing = true;
    this.mat.color.set(useUiStore.getState().sketchStyle.color);
    this.redraw();
  }

  move(info: ToolPointerInfo): void {
    if (!this.drawing || !info.doc) return;
    const last = this.points[this.points.length - 1]!;
    if (Math.hypot(info.doc[0] - last[0], info.doc[1] - last[1]) < MIN_SEG_MM) return; // 데시메이트
    this.points.push(info.doc);
    this.redraw();
    this.ctx.engine.requestRender();
  }

  up(info: ToolPointerInfo): void {
    if (!this.drawing) return;
    this.drawing = false;
    if (info.doc) {
      const last = this.points[this.points.length - 1]!;
      if (Math.hypot(info.doc[0] - last[0], info.doc[1] - last[1]) >= 1) this.points.push(info.doc);
    }
    this.commit();
    this.clearPreview();
  }

  cancel(): void {
    this.drawing = false;
    this.clearPreview();
  }

  private commit(): void {
    if (this.points.length < 2) return;
    const ui = useUiStore.getState();
    this.ctx.store.createSketch({
      levelId: this.ctx.levelId(),
      mode: ui.sketchMode,
      boundary: this.points,
      style: ui.sketchStyle,
    });
    this.ctx.engine.requestRender();
  }

  private clearPreview(): void {
    for (const c of this.group.children) (c as THREE.Line).geometry.dispose();
    this.group.clear();
    this.points = [];
    this.ctx.engine.requestRender();
  }

  private redraw(): void {
    for (const c of this.group.children) (c as THREE.Line).geometry.dispose();
    this.group.clear();
    if (this.points.length < 2) return;
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    const y = (level?.elevation ?? 0) / 1000 + 0.031;
    const geo = new THREE.BufferGeometry().setFromPoints(
      this.points.map(([x, z]) => new THREE.Vector3(x / 1000, y, z / 1000)),
    );
    this.group.add(new THREE.Line(geo, this.mat));
  }
}
