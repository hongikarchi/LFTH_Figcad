import { useState } from 'react';
import type { DocStore } from '@figcad/core';
import { useNavigatorIO } from './useNavigatorIO';

/**
 * Doc 메뉴 (☰, UI/UX 재구성 P1) — TopBar 좌. 문서 백업 + interop 내보내기.
 * 파괴적 JSON 교체는 ⚠ 문구로 분리(P0 Slice2 패리티) — 안전한 내보내기와 인접 금지.
 * (interop parametric import = additive merge 게이트 Slice9에서 복귀.)
 */
export function DocMenu({ store }: { store: DocStore }) {
  const [open, setOpen] = useState(false);
  const { ifcBusy, FORMATS, exportJson, importJson, exportFile } = useNavigatorIO(store);

  return (
    <div className="doc-menu-wrap">
      <button className="doc-menu-btn" title="문서 — 백업·내보내기" onClick={() => setOpen((o) => !o)}>
        ☰
      </button>
      {open && (
        <>
          <div className="hub-add-backdrop" onClick={() => setOpen(false)} />
          <div className="doc-menu">
            <div className="doc-menu-group">문서</div>
            <button
              className="doc-menu-item"
              onClick={() => {
                exportJson();
                setOpen(false);
              }}
            >
              JSON 내보내기 <span className="nav-meta">백업</span>
            </button>
            <button
              className="doc-menu-item"
              title="현재 문서를 JSON 백업 내용으로 전체 교체 (파괴적 — 협업자 전원 적용, Ctrl+Z 가능)"
              onClick={() => {
                importJson();
                setOpen(false);
              }}
            >
              JSON 가져오기 <span className="nav-meta warn">⚠ 문서 교체</span>
            </button>
            <div className="doc-menu-group">내보내기 (interop)</div>
            {(['ifc', 'rhino', 'dxf'] as const).map((fmt) => (
              <button
                key={fmt}
                className="doc-menu-item"
                disabled={!!ifcBusy}
                onClick={() => {
                  void exportFile(fmt);
                  setOpen(false);
                }}
              >
                {FORMATS[fmt].label} <span className="nav-meta">{FORMATS[fmt].ext}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
