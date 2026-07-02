import { KIND_LABEL } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { raycastHit } from '../engine/Picker';
import { refObjectInfoAt } from '../engine/refIdentity';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const DRAG_COMMIT_PX = 8; // 이상 드래그 = 카메라 제스처(도구 무동작) — MeasureTool 관례
const HOVER_THROTTLE_MS = 33; // ~30Hz — BVH 없는 대형 임포트 메시 pointermove 풀 레이캐스트 금지(leaderCapture 선례)
const CLAY_HEX = '#dedee2'; // ReferenceLayer CLAY_COLOR — 스포이드가 미도색 임포트에서 뽑는 기본값

/** 클릭 대상 해석 결과 — 네이티브=타입(패밀리) 단위, 임포트=레이어/카테고리/소스 단위 */
type PaintTarget =
  | { kind: 'type'; typeId: string; label: string }
  | { kind: 'import'; sourceId: string; category?: string; label: string }
  | { kind: 'unpaintable'; label: string };

/**
 * 페인트(재질) 도구 — SketchUp/D5식 클릭 도색. 패널(PaintContext)에서 색+불투명도를 고르고
 * 뷰포트 클릭으로 적용: 네이티브 요소 = 그 요소의 **타입 전체**(type.color/opacity — 같은 타입 전부),
 * 임포트(연동) 모델 = **.3dm Rhino 레이어 / IFC ifcType / 그 외 소스 전체**(materials 채널 오버라이드).
 * 지우기 모드 = 클레이/불투명 복원. 스포이드(패널 토글 또는 Alt) = 기존 색 흡수.
 *
 * 불변② 준수: 모든 변경은 store ops(updateType/setMaterialOverride) — 재질 mutate는 reconciler 몫.
 * 픽 = 단일 nearest-hit(네이티브+임포트 루트 합침, MeasureTool·leaderCapture 관례) — "커서 아래 그것".
 */
export class PaintTool implements Tool {
  private downClient: { x: number; y: number } | null = null;
  private altHeld = false;
  private lastHoverTs = 0;
  private chip: HTMLDivElement;

  constructor(private ctx: EditorContext) {
    // 호버 칩 — 명령형 DOM (불변③: 렌더 루프에 React 금지, HudLayer 패턴). 도구 수명 = 앱 수명.
    this.chip = document.createElement('div');
    this.chip.style.cssText =
      'position:fixed;display:none;pointer-events:none;z-index:30;' +
      'background:rgba(28,28,30,.88);color:#fff;font:12px -apple-system,sans-serif;' +
      'padding:3px 8px;border-radius:6px;white-space:nowrap;';
    document.body.appendChild(this.chip);
    // Alt = 스포이드 (활성 도구일 때만 — InputManager 무변경, walk 세션 충돌 회피)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt' && useUiStore.getState().activeTool === 'paint') {
        this.altHeld = true;
        e.preventDefault(); // 브라우저 메뉴 포커스 방지
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') this.altHeld = false;
    });
    // Alt+Tab 등으로 keyup을 놓치면 altHeld 고착 → 모든 클릭이 스포이드가 됨. blur/hidden서 리셋(WalkController 선례).
    window.addEventListener('blur', () => {
      this.altHeld = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.altHeld = false;
    });
    // 커서가 캔버스를 떠나면 호버 칩 제거 — InputManager.onLeave는 도구에 통지 안 함(잔존 칩 방지)
    this.ctx.engine.renderer.domElement.addEventListener('pointerleave', () => {
      this.chip.style.display = 'none';
    });
  }

  /** 단일 nearest-hit — 네이티브 요소 우선 아님, 거리순(커서 아래 보이는 것). 주석 프록시는 통과. */
  private pickTarget(info: ToolPointerInfo): PaintTarget | null {
    const roots = this.ctx.overlayRoot
      ? [...this.ctx.scene.pickables, this.ctx.overlayRoot]
      : [...this.ctx.scene.pickables];
    const ui = useUiStore.getState();
    const skip = (o: { userData: Record<string, unknown> }): boolean => {
      // 언더레이(래스터 쿼드·DWG 해치) = figcadReference인데 refSourceId 없음 — 슬래브 위 +1mm 쿼드가
      // 픽을 강탈해 무피드백 no-op이 되므로 통과시켜 뒤의 실지오메트리를 맞춘다.
      if (o.userData['figcadReference'] && typeof o.userData['refSourceId'] !== 'string') return true;
      // plan 모드 비활성 레벨 고스트(0.12) 통과 — 위층 슬래브가 보이는 아래층 클릭을 가로채
      // 엉뚱한 타입을 도색하는 것 방지(도구 의도 = 커서 아래 "보이는 솔리드").
      if (ui.viewMode === 'plan' && ui.activeLevelId) {
        const id = o.userData['elementId'];
        if (typeof id === 'string') {
          const el = this.ctx.store.getElement(id);
          if (el && 'levelId' in el && el.levelId !== ui.activeLevelId) return true;
        }
      }
      return false;
    };
    const hit = raycastHit(info.clientX, info.clientY, this.ctx.rig.active, roots, true, skip);
    if (!hit) return null;
    const elementId = hit.object.userData['elementId'];
    if (typeof elementId === 'string') {
      const el = this.ctx.store.getElement(elementId);
      if (!el) return null;
      // 타입 없는 kind(존/스케치/에셋 등) = 도색 불가 (에셋 색은 ASSET_COLOR 고정, 스케치는 자체 스타일)
      if (!('typeId' in el)) return { kind: 'unpaintable', label: KIND_LABEL[el.kind] };
      const type = this.ctx.store.getType(el.typeId);
      if (!type) return { kind: 'unpaintable', label: KIND_LABEL[el.kind] };
      return { kind: 'type', typeId: type.id, label: type.name };
    }
    const ref = refObjectInfoAt(hit.object, hit.faceIndex ?? undefined);
    if (!ref) return null;
    const src = this.ctx.store.getFederationSource(ref.sourceId);
    if (!src) return null; // 데모/고아 소스 — 문서 오버라이드 대상 아님
    // 사용자 결정: .3dm=Rhino 레이어·IFC=ifcType 단위, glTF/room 등=소스 전체 (레이어 정보 없음)
    const layered = src.sourceType === '3dm' || src.sourceType === 'ifc';
    const category = layered ? ref.category : undefined;
    return {
      kind: 'import',
      sourceId: ref.sourceId,
      ...(category !== undefined ? { category } : {}),
      label: category ?? src.name,
    };
  }

  private chipText(t: PaintTarget | null): string {
    if (!t) return '';
    if (t.kind === 'unpaintable') return `칠할 수 없음 — ${t.label}`;
    const ui = useUiStore.getState();
    const action = ui.paintEyedropper || this.altHeld ? '색 추출' : ui.paintMode === 'erase' ? '지우기' : '도색';
    const scope = t.kind === 'type' ? '타입' : t.category !== undefined ? '레이어' : '모델 전체';
    return `"${t.label}" ${scope} ${action}`;
  }

  down(info: ToolPointerInfo): void {
    this.downClient = { x: info.clientX, y: info.clientY };
    this.chip.style.display = 'none'; // 카메라 드래그 중 스테일 칩 방지 (다음 호버 move가 되살림)
  }

  move(info: ToolPointerInfo): void {
    const now = performance.now();
    if (now - this.lastHoverTs < HOVER_THROTTLE_MS) return;
    this.lastHoverTs = now;
    const text = this.chipText(this.pickTarget(info));
    if (!text) {
      this.chip.style.display = 'none';
      return;
    }
    this.chip.textContent = text;
    this.chip.style.display = 'block';
    this.chip.style.left = `${info.clientX + 14}px`;
    this.chip.style.top = `${info.clientY + 16}px`;
  }

  up(info: ToolPointerInfo): void {
    if (!this.downClient) return;
    const drag = Math.hypot(info.clientX - this.downClient.x, info.clientY - this.downClient.y);
    this.downClient = null;
    if (drag > DRAG_COMMIT_PX) return; // 드래그 = 카메라
    const t = this.pickTarget(info);
    if (!t) return;
    if (t.kind === 'unpaintable') {
      this.ctx.hud.toast(`칠할 수 없음 — ${t.label}`);
      return;
    }
    const ui = useUiStore.getState();
    const store = this.ctx.store;

    // 스포이드 — 기존 색·불투명도 흡수 (1회성: 흡수 후 토글 해제)
    if (ui.paintEyedropper || this.altHeld) {
      if (t.kind === 'type') {
        const type = store.getType(t.typeId);
        if (type) ui.setPaintStyle({ color: type.color, opacity: type.opacity ?? 1 });
      } else {
        const o =
          store.getMaterialOverride(t.sourceId, t.category) ?? store.getMaterialOverride(t.sourceId);
        ui.setPaintStyle(o ? { color: o.color, opacity: o.opacity } : { color: CLAY_HEX, opacity: 1 });
      }
      ui.setPaintEyedropper(false);
      this.ctx.hud.toast(`"${t.label}" 색 추출`);
      return;
    }

    // 지우기 — 임포트=오버라이드 제거(클레이 복원), 네이티브=불투명 복원(색 복원은 undo)
    if (ui.paintMode === 'erase') {
      if (t.kind === 'type') {
        store.updateType(t.typeId, { opacity: undefined });
        this.ctx.hud.toast(`"${t.label}" 불투명 복원 (색 되돌리기=실행취소)`);
      } else if (t.category === undefined) {
        // 소스 전체 키 (glTF/room, 또는 .3dm range 밖) — 그 키만 제거
        const ok = store.clearMaterialOverride(t.sourceId);
        this.ctx.hud.toast(ok ? `"${t.label}" 클레이 복원` : '지울 도색 없음');
      } else {
        // 레이어/카테고리 클릭 — 그 키만 제거. 소스 전체 도색으로 폴백 삭제 금지:
        // 레이어 하나 지우기가 모델 전체 도색(타인 작업일 수 있음)을 조용히 날리면 안 됨.
        const cleared = store.clearMaterialOverride(t.sourceId, t.category);
        const whole = store.getMaterialOverride(t.sourceId);
        if (cleared)
          this.ctx.hud.toast(
            whole ? `"${t.label}" 레이어 도색 제거 — 모델 전체 도색은 남음(전체 지우기)` : `"${t.label}" 클레이 복원`,
          );
        else
          this.ctx.hud.toast(
            whole ? '모델 전체 도색 상태 — 패널의 전체 지우기 사용' : '지울 도색 없음',
          );
      }
      return;
    }

    // 칠하기 — opacity 1은 키 생략(문서 청결·구클라 호환: updateType이 undefined=키 삭제)
    if (t.kind === 'type') {
      const type = store.getType(t.typeId);
      // no-op 가드 — 같은 색·불투명도면 무기록(죽은 undo 스텝 방지, setMaterialOverride 가드와 짝)
      if (type && type.color === ui.paintStyle.color && (type.opacity ?? 1) === ui.paintStyle.opacity) {
        this.ctx.hud.toast(`"${t.label}" 이미 같은 색`);
        return;
      }
      store.updateType(t.typeId, {
        color: ui.paintStyle.color,
        opacity: ui.paintStyle.opacity < 1 ? ui.paintStyle.opacity : undefined,
      });
      this.ctx.hud.toast(`"${t.label}" 타입 도색`);
    } else {
      store.setMaterialOverride({
        sourceId: t.sourceId,
        ...(t.category !== undefined ? { category: t.category } : {}),
        color: ui.paintStyle.color,
        opacity: ui.paintStyle.opacity,
        author: ui.userName,
      });
      this.ctx.hud.toast(`"${t.label}" 도색`);
    }
  }

  cancel(): void {
    this.downClient = null;
    this.chip.style.display = 'none';
    this.ctx.engine.renderer.domElement.style.cursor = '';
  }

  activate(): void {
    this.ctx.engine.renderer.domElement.style.cursor = 'crosshair';
  }
}
