import type { DocStore, Id } from '@figcad/core';
import type { Engine } from '../engine/Engine';
import type { CameraRig } from '../engine/CameraRig';
import type { SceneManager } from '../engine/SceneManager';
import type { HudLayer } from '../hud/HudLayer';
import type { CollabBridge } from '../collab/presence';

/** 도구가 보는 에디터 표면 — 문서 변경은 반드시 store ops로 */
export interface EditorContext {
  store: DocStore;
  engine: Engine;
  rig: CameraRig;
  scene: SceneManager;
  hud: HudLayer;
  levelId: () => Id;
  wallTypeId: () => Id;
  /** 도구별 활성 타입 (uiStore activeTypes + 시드 폴백) */
  typeId: (kind: 'wall' | 'door' | 'window' | 'slab' | 'column' | 'beam') => Id;
  /** 협업 브리지 — presence 초기화 후 main이 교체 (그 전엔 no-op) */
  collab: CollabBridge;
}
