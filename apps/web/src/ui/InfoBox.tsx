import { useEffect, useState } from 'react';
import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';

/**
 * ArchiCAD Info Box의 웹 경량판 — 상단 가로 도킹, 컨텍스트 민감:
 * "활성 도구 또는 선택 요소의 현재 설정을 표시" (help.graphisoft.com).
 * 선택이 있으면 선택 요소 설정, 없으면 활성 도구 설정.
 */
export function InfoBox({ store }: { store: DocStore }) {
  useDocVersion(store);
  const activeTool = useUiStore((s) => s.activeTool);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);
  const activeWallTypeId = useUiStore((s) => s.activeWallTypeId);
  const setActiveWallType = useUiStore((s) => s.setActiveWallType);

  // 높이 입력 드래프트 — blur/Enter에만 커밋
  const [heightDraft, setHeightDraft] = useState<string | null>(null);
  useEffect(() => setHeightDraft(null), [selection]);

  const wallTypes = store.listTypes('wall');
  const el = selection ? store.getElement(selection) : undefined;

  // --- 선택된 벽: 요소 설정 ---
  if (el?.kind === 'wall') {
    const level = store.getLevel(el.levelId);
    const lengthMm = Math.round(Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]));
    const effHeight = el.height ?? level?.height ?? 0;

    const commitHeight = () => {
      if (heightDraft === null) return;
      const v = Math.round(Number(heightDraft));
      if (Number.isFinite(v) && v >= 100) store.updateElement(el.id, { height: v });
      setHeightDraft(null);
    };

    return (
      <div className="infobox">
        <span className="infobox-title">벽</span>
        <span className="infobox-field">
          <label>길이</label>
          <span className="ro">{lengthMm.toLocaleString('ko-KR')}</span>
        </span>
        <span className="infobox-field">
          <label>높이</label>
          <input
            type="number"
            step={100}
            value={heightDraft ?? String(effHeight)}
            onChange={(e) => setHeightDraft(e.target.value)}
            onBlur={commitHeight}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </span>
        <span className="infobox-field">
          <label>타입</label>
          <select
            value={el.typeId}
            onChange={(e) => store.updateElement(el.id, { typeId: e.target.value })}
          >
            {wallTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </span>
        <span className="infobox-field">
          <label>홈 스토리</label>
          <span className="ro">{level?.name ?? '—'}</span>
        </span>
        <button
          className="danger"
          onClick={() => {
            store.deleteElements([el.id]);
            setSelection(null);
          }}
        >
          삭제
        </button>
      </div>
    );
  }

  // --- 벽 도구: 도구 기본 설정 ---
  if (activeTool === 'wall') {
    return (
      <div className="infobox">
        <span className="infobox-title">벽 도구</span>
        <span className="infobox-field">
          <label>타입</label>
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
        </span>
        <span className="infobox-field">
          <label>지오메트리</label>
          <span className="ro">체인</span>
        </span>
        <span className="infobox-field">
          <label>참조선</label>
          <span className="ro">중심선</span>
        </span>
        <span className="infobox-field">
          <label>높이</label>
          <span className="ro">스토리 층고</span>
        </span>
      </div>
    );
  }

  // --- 선택 도구, 선택 없음 ---
  return (
    <div className="infobox">
      <span className="infobox-title">선택</span>
      <span className="infobox-hint">요소를 클릭해 선택 · 우클릭 = 확정/패닝 · 휠 = 줌</span>
    </div>
  );
}
