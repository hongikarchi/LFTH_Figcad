import { useUiStore, type ToolName } from '../state/uiStore';
import { hotkeyForTool } from '../input/hotkeys';
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
      { label: '계단', icon: 'stair', tool: 'stair' },
      { label: '난간', icon: 'railing', tool: 'railing' },
      { label: '지붕', icon: 'roof', tool: 'roof' },
      { label: '커튼월', icon: 'window', tool: 'curtainwall' },
      { label: '존', icon: 'box', tool: 'zone' },
      { label: '오브젝트', icon: 'tree', tool: 'asset' }, // 엔투라지(나무·사람·차·관목) 배치(항목7)
      { label: '페인트', icon: 'paint', tool: 'paint' }, // 재질(색+투명도) — 네이티브=타입, 임포트=레이어
    ],
  },
  {
    title: '문서',
    items: [
      // 텍스트 도구 제거(iter-2 3-3) + 치수 생성표면 제거(항목5) — 자유 텍스트=레이블, 측정=줄자로 대체.
      // 치수(dimension) 스키마·derive·기존 요소는 back-compat로 보존(렌더만) — 생성 도구/버튼만 제거.
      { label: '측정', icon: 'dimension', tool: 'measure' }, // 줄자(일회성·비저장)
      { label: '레이블', icon: 'pencil', tool: 'label' },
      { label: '스케치', icon: 'ai', tool: 'sketch-pen' }, // 프리핸드 영속 스케치(iter-3, 구 '마크업')
      { label: '해치', icon: 'hatch', planned: '2D 도면 단계' },
    ],
  },
  // 코멘트=협업 mode 팔레트 · 스케치=AI mode 팔레트 (피드백 — mode별 도구).
];

export function Toolbox() {
  const activeTool = useUiStore((s) => s.activeTool);
  const setTool = useUiStore((s) => s.setTool);

  return (
    <div className="toolbox">
      {GROUPS.map((g) => (
        <div key={g.title} className="toolbox-group">
          <div className="toolbox-group-title">{g.title}</div>
          {g.items.map((item) => {
            const key = item.tool ? hotkeyForTool(item.tool, 'model') : null; // 핫키 힌트 (Slice 11 후속)
            return item.tool ? (
              <button
                key={item.label}
                className={activeTool === item.tool ? 'active' : ''}
                title={key ? `${item.label} (${key})` : item.label}
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
            );
          })}
        </div>
      ))}
    </div>
  );
}
