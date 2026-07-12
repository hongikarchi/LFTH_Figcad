import type { DocStore } from '@figcad/core';
import type { ViewActions } from '../ui/App';
import type { ViewPreset } from '../engine/CameraRig';
import { useUiStore, type ClipState } from '../state/uiStore';
import type { UiActionEntry } from './agentClient';

/**
 * ui-action(B-P1) 실행기 — 서버가 이름→id 해소를 마친 정규화 payload를 ViewActions·uiStore로
 * 매핑한다. 문서 op가 아니다(불변② 비대상): 비영속·비undo·비브로드캐스트 — 내 화면만.
 *
 * 실행 시점 정책(AiPanel):
 * - 순수 뷰 응답(opLog 없음) = 도착 즉시 실행 (§C 결정3 — 승인 카드 비대상).
 * - 혼합 응답(문서 op 동반) = 계획 승인(applyOpLog) **후** 실행 — 새 요소를 참조하는
 *   ui_focus의 드라이런 id 재매핑(idMap)·"만들고 봐줘"의 순서가 그래야 성립.
 * - 걷기 중엔 거부(§A3.6 walk 가드) — 걷기 포즈는 사용자 소유.
 */
export function executeUiAction(
  entry: UiActionEntry,
  ctx: {
    actions: ViewActions;
    store: DocStore;
    /** 승인 후 실행 경로에서 applyOpLog가 만든 드라이런→실제 id 맵 (즉시 경로는 생략) */
    idMap?: Map<string, string>;
  },
): { ok: boolean; notice: string } {
  try {
    return executeUiActionInner(entry, ctx);
  } catch (e) {
    // 서버발 payload 신뢰 구조 — 기형/변조 시에도 throw가 승인 플로우(setPlan(null) 미도달 →
    // 재승인 = opLog 이중 적용)를 깨지 않게 방어(리뷰). 실패 = 건너뜀 notice 계약 유지.
    return { ok: false, notice: `뷰 액션 실행 실패 — ${entry.summary} (${e instanceof Error ? e.message : e})` };
  }
}

function executeUiActionInner(
  entry: UiActionEntry,
  ctx: { actions: ViewActions; store: DocStore; idMap?: Map<string, string> },
): { ok: boolean; notice: string } {
  const ui = useUiStore.getState();
  if (ui.walkActive) return { ok: false, notice: `걷기 중이라 뷰 명령을 건너뜀 — ${entry.summary}` };

  const p = entry.params;
  switch (entry.action) {
    case 'ui_set_view':
      ctx.actions.setView(p['preset'] as ViewPreset);
      return { ok: true, notice: `🎬 ${entry.summary}` };
    case 'ui_set_view_mode':
      ui.setViewMode(p['mode'] === 'plan' ? 'plan' : '3d');
      return { ok: true, notice: `🎬 ${entry.summary}` };
    case 'ui_set_story': {
      // 혼합 계획이 방금 만든 레벨("2층 만들고 봐줘") = 드라이런 id → idMap 재매핑 (리뷰 major)
      const raw = String(p['levelId'] ?? '');
      const levelId = ctx.idMap?.get(raw) ?? raw;
      if (!ctx.store.getLevel(levelId)) return { ok: false, notice: `레벨을 찾지 못해 건너뜀 — ${entry.summary}` };
      ui.setActiveLevel(levelId);
      ui.setViewMode('plan'); // "2층 평면 봐줘" = 스토리+평면 동시 (설계 B3)
      return { ok: true, notice: `🎬 ${String(p['levelName'] ?? levelId)} 평면으로 전환` };
    }
    case 'ui_jump_viewpoint': {
      const vp = ctx.store.listViewpoints().find((v) => v.id === String(p['viewpointId'] ?? ''));
      if (!vp) return { ok: false, notice: `뷰포인트를 찾지 못해 건너뜀 — ${entry.summary}` };
      ctx.actions.jumpViewpoint(vp);
      return { ok: true, notice: `🎬 뷰포인트 "${vp.name}"로 점프` };
    }
    case 'ui_set_clip': {
      const clip = (p['clip'] ?? null) as ClipState | null;
      // 엔진(clippingPlanes)과 uiStore.clip 락스텝 필수(리뷰 major) — 안 하면 ClipControl 위젯
      // 불능 + saveViewpoint가 stale clip을 문서 채널에 영속(비영속 계약 위반). jumpViewpoint 패턴.
      ui.setClipState(clip);
      ctx.actions.setClip(clip);
      return { ok: true, notice: clip ? `🎬 단면 클립 ${clip.axis}=${clip.t}` : '🎬 단면 클립 해제' };
    }
    case 'ui_focus': {
      const raw = p['ids'];
      if (!Array.isArray(raw) || raw.length === 0) {
        ctx.actions.fit();
        return { ok: true, notice: '🎬 전체 맞춤' };
      }
      // 승인 후 경로: 계획이 만든 드라이런 id → 실제 id 재매핑
      const ids = (raw as string[]).map((id) => ctx.idMap?.get(id) ?? id).filter((id) => ctx.store.getElement(id));
      if (ids.length === 0) return { ok: false, notice: `대상 요소를 찾지 못해 건너뜀 — ${entry.summary}` };
      ui.setSelection(ids);
      ctx.actions.fitSelection();
      return { ok: true, notice: `🎬 요소 ${ids.length}개 화면 맞춤` };
    }
    default:
      return { ok: false, notice: `알 수 없는 뷰 액션 — ${entry.action}` };
  }
}
