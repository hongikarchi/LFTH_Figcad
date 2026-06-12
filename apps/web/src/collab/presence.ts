import * as THREE from 'three';
import type { Awareness } from 'y-protocols/awareness';
import type { Id, Pt } from '@figcad/core';
import type { Engine } from '../engine/Engine';
import type { SceneManager } from '../engine/SceneManager';
import type { HudLayer } from '../hud/HudLayer';

const PALETTE = ['#0a84ff', '#ff9500', '#34c759', '#ff375f', '#af52de', '#5ac8fa', '#ffd60a'];
const CURSOR_THROTTLE_MS = 33; // ~30Hz

interface PresenceState {
  user: { name: string; color: string; device: 'touch' | 'desktop' };
  cursor: [number, number, number] | null; // 월드 m
  selection: Id[];
  editing: Id | null; // 소프트 락 신호
}

interface RemotePeer {
  cone: THREE.Mesh;
}

/** 도구가 보는 협업 브리지 — presence 초기화 전에는 no-op */
export interface CollabBridge {
  setEditing(id: Id | null): void;
  /** 타인이 편집 중이면 그 사용자 이름, 아니면 null */
  lockOwner(id: Id): string | null;
}

export const NOOP_COLLAB: CollabBridge = {
  setEditing: () => {},
  lockOwner: () => null,
};

function getUserName(): string {
  // prompt()는 첫 로드를 블로킹(특히 iPad/headless)하므로 기본 이름으로 시작 —
  // 이름 변경 UI는 추후 QuickOptions에 추가
  let name = localStorage.getItem('figcad.userName');
  if (!name) {
    name = `게스트${Math.floor(Math.random() * 90 + 10)}`;
    localStorage.setItem('figcad.userName', name);
  }
  return name;
}

/**
 * awareness(비영속) ↔ 화면: 원격 커서(콘+이름표), 원격 선택 틴트, 소프트 락.
 * 락은 권고형 — 경합 시 LWW가 해소, 연결 끊기면 awareness와 함께 자동 증발.
 */
export class Presence implements CollabBridge {
  readonly color: string;
  private peers = new Map<number, RemotePeer>();
  private cursorPending: [number, number, number] | null = null;
  private cursorLastSent = 0;

  constructor(
    private awareness: Awareness,
    private engine: Engine,
    private scene: SceneManager,
    private hud: HudLayer,
    private onPeersChange?: (count: number) => void,
  ) {
    this.color = PALETTE[awareness.clientID % PALETTE.length]!;
    awareness.setLocalState({
      user: {
        name: getUserName(),
        color: this.color,
        device: navigator.maxTouchPoints > 1 ? 'touch' : 'desktop',
      },
      cursor: null,
      selection: [],
      editing: null,
    } satisfies PresenceState);

    awareness.on('change', () => this.renderRemote());
  }

  // --- 로컬 상태 발행 ---

  setCursor(doc: Pt | null, elevationM: number): void {
    this.cursorPending = doc ? [doc[0] / 1000, elevationM, doc[1] / 1000] : null;
    const now = performance.now();
    if (now - this.cursorLastSent < CURSOR_THROTTLE_MS) return;
    this.cursorLastSent = now;
    this.awareness.setLocalStateField('cursor', this.cursorPending);
  }

  setSelection(ids: Id[]): void {
    this.awareness.setLocalStateField('selection', ids);
  }

  setEditing(id: Id | null): void {
    this.awareness.setLocalStateField('editing', id);
  }

  lockOwner(id: Id): string | null {
    for (const [clientId, raw] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) continue;
      const state = raw as Partial<PresenceState>;
      if (state.editing === id) return state.user?.name ?? '다른 사용자';
    }
    return null;
  }

  // --- 원격 상태 렌더 ---

  private renderRemote(): void {
    const states = this.awareness.getStates();
    const highlights = new Map<Id, string>();
    const seen = new Set<number>();
    let peerCount = 0;

    for (const [clientId, raw] of states) {
      if (clientId === this.awareness.clientID) continue;
      const state = raw as Partial<PresenceState>;
      if (!state.user) continue;
      peerCount++;
      seen.add(clientId);

      // 원격 선택/편집 → 사용자 색 하이라이트
      for (const id of state.selection ?? []) highlights.set(id, state.user.color);
      if (state.editing) highlights.set(state.editing, state.user.color);

      // 커서 콘 + 이름표
      let peer = this.peers.get(clientId);
      if (!peer) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.12, 0.36, 12),
          new THREE.MeshBasicMaterial({ color: state.user.color }),
        );
        cone.rotation.x = Math.PI; // 꼭짓점이 아래(지면 포인트)를 향하게
        this.engine.scene.add(cone);
        peer = { cone };
        this.peers.set(clientId, peer);
      }
      if (state.cursor) {
        peer.cone.visible = true;
        peer.cone.position.set(state.cursor[0], state.cursor[1] + 0.22, state.cursor[2]);
        this.hud.setLabel(
          `peer-${clientId}`,
          state.user.name,
          state.user.color,
          new THREE.Vector3(...state.cursor),
        );
      } else {
        peer.cone.visible = false;
        this.hud.removeLabel(`peer-${clientId}`);
      }
    }

    // 떠난 피어 정리
    for (const [clientId, peer] of this.peers) {
      if (!seen.has(clientId)) {
        this.engine.scene.remove(peer.cone);
        peer.cone.geometry.dispose();
        (peer.cone.material as THREE.Material).dispose();
        this.peers.delete(clientId);
        this.hud.removeLabel(`peer-${clientId}`);
      }
    }

    this.scene.setRemoteHighlights(highlights);
    this.onPeersChange?.(peerCount);
    this.engine.requestRender();
  }
}
