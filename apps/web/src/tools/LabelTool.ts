import * as THREE from 'three';
import { refDisplayName } from '../engine/refIdentity';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';
import { LeaderCapture, type LeaderResult } from './leaderCapture';

/**
 * 레이블(Revit 태그) 도구 — 2클릭 지시선(iter-2 3-2):
 *   클릭1 = 지시선 시작점. 요소 위면 그 요소를 타깃(자동 템플릿, 지시선이 타깃 추종).
 *           빈 곳이면 leaderAt(고정 지시선 시작점)로 자유 custom 노트.
 *   클릭2 = 텍스트 위치(at). 요소 타깃은 즉시 생성, 자유 노트는 텍스트 입력 후 생성.
 * 타깃 추종·고아 fallback·지시선 끝점(targetCenter ?? leaderAt)은 파생(deriveLabel)에서.
 */
export class LabelTool implements Tool {
  private cap: LeaderCapture;
  private editing = false;

  constructor(private ctx: EditorContext) {
    this.cap = new LeaderCapture(ctx, 0xff9500, (r) => this.complete(r));
  }

  down(): void {}

  move(info: ToolPointerInfo): void {
    if (!this.editing) this.cap.move(info);
  }

  // up에서 처리 (down의 mouseup이 입력창 포커스 강탈)
  up(info: ToolPointerInfo): void {
    if (!this.editing) this.cap.up(info);
  }

  cancel(): void {
    this.editing = false;
    this.cap.cancel();
  }

  enter(): void {
    this.cancel();
  }

  private complete(r: LeaderResult): void {
    const levelId = r.anchorLevelId;
    // 자기 자신(라벨)·코멘트류는 타깃으로 안 씀
    const target = r.anchorEl && r.anchorEl.kind !== 'label' ? r.anchorEl : null;
    if (target) {
      // 요소 태그 — 자동 템플릿(존=면적, 그 외=이름) + 지시선(타깃 중심 추종)
      const template = target.kind === 'zone' ? 'area' : 'name';
      this.ctx.store.createLabel({ levelId, at: r.textAt, targetId: target.id, template, leader: true });
      this.ctx.engine.requestRender();
      return;
    }
    // 자유 custom 노트 — 지시선 시작점=anchor(leaderAt 고정), 텍스트 입력.
    // 임포트(연동 모델) 객체 위 클릭이면 객체명/카테고리/소스명 프리필 — 편집형(Enter=수락, 자동생성 아님:
    // 임포트 이름은 junk/중복이 흔해 스팸 방지 + 무엇이 인식됐는지 피드백 겸용).
    const initial = r.refHit ? refDisplayName(this.ctx.store, r.refHit) : '';
    const elev = (this.ctx.store.getLevel(levelId)?.elevation ?? 0) / 1000;
    const world = new THREE.Vector3(r.textAt[0] / 1000, elev + 0.02, r.textAt[1] / 1000);
    this.editing = true;
    void this.ctx.hud.promptText(world, this.ctx.rig.active, initial).then((text) => {
      this.editing = false;
      if (text) {
        this.ctx.store.createLabel({
          levelId,
          at: r.textAt,
          leaderAt: r.anchor,
          template: 'custom',
          customText: text,
          leader: true,
        });
        this.ctx.engine.requestRender();
      }
    });
  }
}
