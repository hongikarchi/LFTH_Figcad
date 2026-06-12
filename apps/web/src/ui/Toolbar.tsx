import type { DocStore } from '@figcad/core';
import { useUiStore, type ToolName } from '../state/uiStore';

const TOOLS: { name: ToolName; label: string }[] = [
  { name: 'select', label: '선택' },
  { name: 'wall', label: '벽' },
];

export function Toolbar({ store }: { store: DocStore }) {
  const activeTool = useUiStore((s) => s.activeTool);
  const activeWallTypeId = useUiStore((s) => s.activeWallTypeId);
  const { setTool, setActiveWallType } = useUiStore.getState();

  const wallTypes = store.listTypes('wall');

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.name}
          className={activeTool === t.name ? 'active' : ''}
          onClick={() => setTool(t.name)}
        >
          {t.label}
        </button>
      ))}
      {activeTool === 'wall' && (
        <select
          value={activeWallTypeId ?? ''}
          onChange={(e) => setActiveWallType(e.target.value)}
        >
          {wallTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
