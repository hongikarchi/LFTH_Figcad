import * as THREE from 'three';
import {
  beginStroke,
  endStroke,
  extendStroke,
  getStrokes,
  onSketchChange,
} from '../ai/sketchCapture';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

/**
 * AI 스케치 도구 — 펜/마우스 프리핸드로 평면에 손그림. 문서공간(mm) 폴리라인을
 * sketchCapture에 모은다(문서 미저장). AiPanel이 이를 PNG+mm프레임으로 Claude에 첨부.
 * 프리뷰만 명령형 Three 라인(불변규칙 3). 펜=도구라 InputManager가 자동 라우팅.
 */
export class SketchTool implements Tool {
  private group: THREE.Group;
  private mat: THREE.LineBasicMaterial;
  private drawing = false;
  private unsub: () => void;

  constructor(private ctx: EditorContext) {
    this.group = new THREE.Group();
    this.mat = new THREE.LineBasicMaterial({ color: 0x0a84ff });
    ctx.engine.scene.add(this.group);
    // 외부(AiPanel 지우기/전송 후 clear)에서 스트로크가 바뀌면 프리뷰 재구성
    this.unsub = onSketchChange(() => {
      this.redraw();
      this.ctx.engine.requestRender();
    });
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    beginStroke(info.doc);
    this.drawing = true;
  }

  move(info: ToolPointerInfo): void {
    if (!this.drawing || !info.doc) return;
    extendStroke(info.doc); // onSketchChange → redraw
  }

  up(): void {
    if (!this.drawing) return;
    this.drawing = false;
    endStroke();
  }

  cancel(): void {
    // 시스템 제스처 등 — 현재 스트로크만 마감(전체 지우기 아님: AiPanel '지우기' 버튼)
    if (this.drawing) {
      this.drawing = false;
      endStroke();
    }
  }

  activate(): void {
    this.ctx.rig.setNorthUp(); // 북향 평면에서 스케치 → 그린 대로(축정렬·북기준) 생성
    this.redraw();
    this.ctx.engine.requestRender();
  }

  private redraw(): void {
    for (const c of this.group.children) {
      (c as THREE.Line).geometry.dispose();
    }
    this.group.clear();
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    const y = (level?.elevation ?? 0) / 1000 + 0.03;
    for (const s of getStrokes()) {
      if (s.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(
        s.map(([x, z]) => new THREE.Vector3(x / 1000, y, z / 1000)),
      );
      this.group.add(new THREE.Line(geo, this.mat));
    }
  }
}
