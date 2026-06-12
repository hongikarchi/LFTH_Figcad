import type { DocStore, Id } from '@figcad/core';
import type { Engine } from '../engine/Engine';
import type { CameraRig } from '../engine/CameraRig';
import type { SceneManager } from '../engine/SceneManager';
import type { HudLayer } from '../hud/HudLayer';

/** 도구가 보는 에디터 표면 — 문서 변경은 반드시 store ops로 */
export interface EditorContext {
  store: DocStore;
  engine: Engine;
  rig: CameraRig;
  scene: SceneManager;
  hud: HudLayer;
  levelId: () => Id;
  wallTypeId: () => Id;
}
