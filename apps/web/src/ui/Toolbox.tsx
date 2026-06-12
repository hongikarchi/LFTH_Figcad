import { useUiStore, type ToolName } from '../state/uiStore';

/**
 * ArchiCAD Toolbox의 웹 경량판 (help.graphisoft.com: 4그룹 — Select/Design/Document/More).
 * 미구현 도구는 비활성 표시 — 로드맵 가시화 겸 레이아웃 고정.
 */
interface ToolItem {
  label: string;
  tool?: ToolName; // 구현된 도구만
  planned?: string; // 비활성 사유/마일스톤
}

const GROUPS: { title: string; items: ToolItem[] }[] = [
  {
    title: '선택',
    items: [{ label: '선택', tool: 'select' }],
  },
  {
    title: '디자인',
    items: [
      { label: '벽', tool: 'wall' },
      { label: '문', tool: 'door' },
      { label: '창', tool: 'window' },
      { label: '슬라브', tool: 'slab' },
      { label: '그리드', tool: 'grid' },
      { label: '기둥', planned: '추후' },
      { label: '보', planned: '추후' },
      { label: '지붕', planned: '추후' },
      { label: '계단', planned: '추후' },
      { label: '난간', planned: '추후' },
      { label: '커튼월', planned: '추후' },
      { label: '존', planned: '추후' },
      { label: '오브젝트', planned: '추후' },
    ],
  },
  {
    title: '문서',
    items: [
      { label: '치수', planned: '2D 도면 단계' },
      { label: '텍스트', planned: '2D 도면 단계' },
      { label: '레이블', planned: '2D 도면 단계' },
      { label: '해치', planned: '2D 도면 단계' },
    ],
  },
];

export function Toolbox() {
  const activeTool = useUiStore((s) => s.activeTool);
  const setTool = useUiStore((s) => s.setTool);

  return (
    <div className="toolbox">
      {GROUPS.map((g) => (
        <div key={g.title} className="toolbox-group">
          <div className="toolbox-group-title">{g.title}</div>
          {g.items.map((item) =>
            item.tool ? (
              <button
                key={item.label}
                className={activeTool === item.tool ? 'active' : ''}
                onClick={() => setTool(item.tool!)}
              >
                {item.label}
              </button>
            ) : (
              <button key={item.label} disabled title={`${item.planned} 예정`}>
                {item.label}
              </button>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
