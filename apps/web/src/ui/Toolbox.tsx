import { useUiStore, type ToolName } from '../state/uiStore';
import { Icon } from './icons/Icon';

/**
 * ArchiCAD Toolbox의 웹 경량판 (help.graphisoft.com: 4그룹 — Select/Design/Document/More).
 * 아이콘(lucide+건축 커스텀) + 라벨. 미구현 도구는 비활성 표시(로드맵 가시화).
 */
interface ToolItem {
  label: string;
  icon: string;
  tool?: ToolName; // 구현된 도구만
  planned?: string; // 비활성 사유/마일스톤
}

const GROUPS: { title: string; items: ToolItem[] }[] = [
  {
    title: '선택',
    items: [{ label: '선택', icon: 'select', tool: 'select' }],
  },
  {
    title: '디자인',
    items: [
      { label: '벽', icon: 'wall', tool: 'wall' },
      { label: '문', icon: 'door', tool: 'door' },
      { label: '창', icon: 'window', tool: 'window' },
      { label: '슬라브', icon: 'slab', tool: 'slab' },
      { label: '그리드', icon: 'grid', tool: 'grid' },
      { label: '기둥', icon: 'column', tool: 'column' },
      { label: '보', icon: 'beam', tool: 'beam' },
      { label: '지붕', icon: 'roof', planned: '추후' },
      { label: '계단', icon: 'stair', planned: '추후' },
      { label: '난간', icon: 'railing', planned: '추후' },
      { label: '커튼월', icon: 'window', planned: '추후' },
      { label: '존', icon: 'box', planned: '추후' },
      { label: '오브젝트', icon: 'box', planned: '추후' },
    ],
  },
  {
    title: '문서',
    items: [
      { label: '치수', icon: 'dimension', planned: '2D 도면 단계' },
      { label: '텍스트', icon: 'text', planned: '2D 도면 단계' },
      { label: '레이블', icon: 'pencil', planned: '2D 도면 단계' },
      { label: '해치', icon: 'hatch', planned: '2D 도면 단계' },
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
                title={item.label}
                onClick={() => setTool(item.tool!)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ) : (
              <button key={item.label} disabled title={`${item.planned} 예정`}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
