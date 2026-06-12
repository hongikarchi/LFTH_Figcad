import type { DocStore } from '@figcad/core';
import { useUiStore, type EditAction } from '../state/uiStore';
import { useDocVersion } from './App';

/**
 * 편집 액션 팔레트 — ArchiCAD 펫팔레트의 경량판.
 * 선택 도구에서 요소 선택 시 표시. 버튼으로 액션 무장 → 캔버스 클릭으로 실행
 * (SelectTool이 상태머신 처리). 배열 개수/회전 각도는 인라인 입력.
 */
const HINTS: Record<EditAction, string> = {
  move: '기준점 → 목표점 클릭',
  copy: '기준점 → 목표점 클릭 (반복, Esc로 종료)',
  array: '기준점 → 간격점 클릭',
  split: '벽 위 분할점 클릭',
  trim: '기준이 될 벽 클릭 (가까운 끝이 연장/잘림)',
  mirror: '대칭축 두 점 클릭',
  rotate: '회전 중심 클릭',
};

export function EditActions({ store }: { store: DocStore }) {
  useDocVersion(store);
  const activeTool = useUiStore((s) => s.activeTool);
  const selection = useUiStore((s) => s.selection);
  const editAction = useUiStore((s) => s.editAction);
  const arrayCount = useUiStore((s) => s.arrayCount);
  const rotateAngle = useUiStore((s) => s.rotateAngle);
  const { setEditAction, setArrayCount, setRotateAngle } = useUiStore.getState();

  if (activeTool !== 'select' || !selection) return null;
  const el = store.getElement(selection);
  if (!el || el.kind === 'opening') return null; // 개구부는 드래그/InfoBox로 충분

  const wallOnly = el.kind === 'wall';
  const actions: { a: EditAction; label: string; show: boolean }[] = [
    { a: 'move', label: '이동', show: true },
    { a: 'copy', label: '복사', show: true },
    { a: 'array', label: '배열', show: true },
    { a: 'split', label: '분할', show: wallOnly },
    { a: 'trim', label: '연장/자르기', show: wallOnly },
    { a: 'mirror', label: '대칭', show: true },
    { a: 'rotate', label: '회전', show: true },
  ];

  const toggle = (a: EditAction) => setEditAction(editAction === a ? null : a);

  return (
    <div className="edit-actions">
      {actions
        .filter((x) => x.show)
        .map((x) => (
          <button
            key={x.a}
            className={editAction === x.a ? 'active' : ''}
            onClick={() => toggle(x.a)}
          >
            {x.label}
          </button>
        ))}
      <span className="ea-param">
        <label>개수</label>
        <input
          type="number"
          min={1}
          max={50}
          value={arrayCount}
          onChange={(e) => setArrayCount(Number(e.target.value) || 1)}
        />
      </span>
      <span className="ea-param">
        <label>각도°</label>
        <input
          type="number"
          step={15}
          value={rotateAngle}
          onChange={(e) => setRotateAngle(Number(e.target.value) || 0)}
        />
      </span>
      {editAction && <span className="ea-hint">{HINTS[editAction]}</span>}
    </div>
  );
}
