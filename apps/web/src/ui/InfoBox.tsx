import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { renderElementEditor } from './InfoBoxEditors';
import { renderToolContext } from './InfoBoxToolContext';

/**
 * ArchiCAD Info Box의 웹 경량판 — 상단 가로 도킹, 컨텍스트 민감:
 * "활성 도구 또는 선택 요소의 현재 설정을 표시" (help.graphisoft.com).
 * 셸 = 선택 분기만; 요소편집기 = InfoBoxEditors, 도구컨텍스트 = InfoBoxToolContext.
 */
export function InfoBox({ store }: { store: DocStore }) {
  useDocVersion(store);
  const activeTool = useUiStore((s) => s.activeTool);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);
  const activeTypes = useUiStore((s) => s.activeTypes);
  const setActiveType = useUiStore((s) => s.setActiveType);

  // 단일 선택일 때만 요소 편집기 표시. 다중 선택은 요약 + 일괄 삭제.
  const el = selection.length === 1 ? store.getElement(selection[0]!) : undefined;

  // ---- 다중 선택 ----
  if (selection.length > 1) {
    return (
      <div className="infobox">
        <span className="infobox-title">{selection.length}개 선택됨</span>
        <span className="infobox-hint">이동/복사/배열/대칭/회전 가능 · Delete로 삭제</span>
        <button
          className="danger"
          onClick={() => {
            store.deleteElements(selection);
            setSelection([]);
          }}
        >
          전체 삭제
        </button>
      </div>
    );
  }

  // ---- 선택 요소 컨텍스트 ----
  // editor===undefined만 fallthrough(무매칭). null=매칭됐으나 빈 렌더 → 그대로 반환(빈 InfoBox, 원본 패리티).
  if (el) {
    const editor = renderElementEditor(store, el, setSelection);
    if (editor !== undefined) return editor;
  }

  // ---- 활성 도구 컨텍스트 ----
  const tool = renderToolContext(store, activeTool, activeTypes, setActiveType);
  if (tool) return tool;

  return (
    <div className="infobox">
      <span className="infobox-title">선택</span>
      <span className="infobox-hint">요소를 클릭해 선택 · 우클릭 = 확정/회전 · 휠 = 줌</span>
    </div>
  );
}
