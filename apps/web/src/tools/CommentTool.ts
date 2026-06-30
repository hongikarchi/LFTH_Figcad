import * as THREE from 'three';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';
import { LeaderCapture, type LeaderResult } from './leaderCapture';

/**
 * 코멘트 도구 — 2클릭 지시선(레이블과 같은 UX, iter-2 3-2):
 *   클릭1 = 지시선 시작점. 요소 위면 그 요소에 앵커링(세그먼트=가까운 끝점, 기둥=at).
 *   클릭2 = 말풍선(at) 위치 → 떠있는 입력 → addComment.
 * 앵커된 코멘트는 요소가 움직이면 따라가고(resolveCommentPoint), 삭제돼도 at으로 남는다.
 * 데이터 모델은 레이블과 분리(스레드·resolve·작성자) — 화면 외형(지시선+말풍선)만 공유.
 */
export class CommentTool implements Tool {
  private cap: LeaderCapture;
  private editing = false;

  constructor(private ctx: EditorContext) {
    this.cap = new LeaderCapture(ctx, 0x0a84ff, (r) => this.complete(r));
  }

  down(): void {}

  move(info: ToolPointerInfo): void {
    if (!this.editing) this.cap.move(info);
  }

  // up에서 입력창 (down은 mouseup이 포커스 강탈)
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
    // 클릭1 요소에 앵커링 (세그먼트=가까운 끝점, 기둥=a). 그 외=자유 코멘트.
    let anchorId: string | undefined;
    let anchorWhich: 'a' | 'b' | undefined;
    let levelId = r.anchorLevelId;
    const el = r.anchorEl;
    if (el) {
      if ('a' in el && 'b' in el) {
        anchorId = el.id;
        const da = Math.hypot(r.anchor[0] - el.a[0], r.anchor[1] - el.a[1]);
        const db = Math.hypot(r.anchor[0] - el.b[0], r.anchor[1] - el.b[1]);
        anchorWhich = da <= db ? 'a' : 'b';
      } else if (el.kind === 'column') {
        anchorId = el.id;
        anchorWhich = 'a';
      }
      if ('levelId' in el) levelId = el.levelId;
    }
    // 말풍선(텍스트) = 클릭2 위치(at). 오버레이/메시 표면 맞히면 3D 높이(textZ) — 모델 위 핀.
    const elev = (this.ctx.store.getLevel(levelId)?.elevation ?? 0) / 1000;
    const worldY = r.textZ !== undefined ? r.textZ / 1000 + 0.05 : elev + 0.05;
    const world = new THREE.Vector3(r.textAt[0] / 1000, worldY, r.textAt[1] / 1000);
    const author = localStorage.getItem('figcad.userName') ?? '게스트';
    this.editing = true;
    void this.ctx.hud.promptText(world, this.ctx.rig.active).then((text) => {
      this.editing = false;
      if (text) {
        this.ctx.store.addComment({
          levelId,
          at: r.textAt,
          ...(r.textZ !== undefined ? { z: r.textZ } : {}),
          author,
          text,
          ...(anchorId ? { anchorId } : {}),
          ...(anchorWhich ? { anchorWhich } : {}),
        });
        this.ctx.engine.requestRender();
      }
    });
  }
}
