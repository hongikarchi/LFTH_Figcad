import { useUiStore, type ToolName } from '../state/uiStore';
import { Icon } from './icons/Icon';

/**
 * mode별 경량 도구 팔레트 (피드백 P1-refine) — 협업/AI mode 레일용.
 * 모델 mode는 그룹형 Toolbox 유지. 여기는 평면 팔레트(select + 소수 도구).
 */
const TOOL_META: Partial<Record<ToolName, { label: string; icon: string }>> = {
  select: { label: '선택', icon: 'select' },
  measure: { label: '측정', icon: 'dimension' }, // 줄자 — 임포트 모델 거리/높이 재기(일회성, 비저장)
  comment: { label: '코멘트', icon: 'comment' },
  sketch: { label: '스케치', icon: 'ai' },
};

export function ToolPalette({ tools, title }: { tools: ToolName[]; title?: string }) {
  const activeTool = useUiStore((s) => s.activeTool);
  const setTool = useUiStore((s) => s.setTool);
  return (
    <div className="toolbox">
      <div className="toolbox-group">
        {title && <div className="toolbox-group-title">{title}</div>}
        {tools.map((t) => {
          const m = TOOL_META[t];
          if (!m) return null;
          return (
            <button
              key={t}
              className={activeTool === t ? 'active' : ''}
              title={m.label}
              onClick={() => setTool(t)}
            >
              <Icon name={m.icon} />
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
