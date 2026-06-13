import { useEffect, useRef } from 'react';
import { deriveDrawing, type DocStore, type Pt } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { downloadDrawingDxf } from '../interop/ifcClient';

/**
 * 도면 시트 패널 (M11 Phase 1) — 평면/단면/입면 2D 라인워크.
 * deriveDrawing(core 순수) 결과를 명령형 캔버스에 그린다 (React는 패널 크롬만 —
 * 불변규칙 3: 캔버스 draw는 렌더 루프 밖 명령형 DOM). 절단=굵은 검정, 투영=가는 회색,
 * 해치=옅은 회색, 라벨=빨강. 자동 맞춤 + 휠 줌 + 드래그 팬.
 */
export function DrawingPanel({ store }: { store: DocStore }) {
  const version = useDocVersion(store);
  const open = useUiStore((s) => s.drawingOpen);
  const activeViewId = useUiStore((s) => s.activeViewId);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ zoom: 1, panX: 0, panY: 0 });
  const drawRef = useRef<() => void>(() => {});
  const drag = useRef<{ x: number; y: number } | null>(null);

  const views = store.listViews();
  const active = activeViewId ? store.getView(activeViewId) : views[0];

  // 활성 뷰 미지정 + 뷰 존재 → 첫째 선택
  useEffect(() => {
    if (!activeViewId && views[0]) useUiStore.getState().setActiveViewId(views[0].id);
  }, [activeViewId, views]);

  // 뷰 전환 시 카메라(맞춤) 리셋
  useEffect(() => {
    cam.current = { zoom: 1, panX: 0, panY: 0 };
  }, [activeViewId]);

  useEffect(() => {
    if (!open || !active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (W === 0 || H === 0) return;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);

      const d = deriveDrawing(active, store);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const acc = (p: Pt) => {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
      };
      for (const pl of d.cut) for (const p of pl.pts) acc(p);
      for (const pl of d.proj) for (const p of pl.pts) acc(p);
      for (const pl of d.silhouettes ?? []) for (const p of pl.pts) acc(p);
      for (const [a, b] of d.hatch) {
        acc(a);
        acc(b);
      }
      if (!isFinite(minX)) {
        ctx.fillStyle = '#999';
        ctx.font = '13px sans-serif';
        ctx.fillText('빈 도면 — 이 레벨에 표시할 요소가 없습니다.', 16, 26);
        return;
      }
      const bw = Math.max(maxX - minX, 1);
      const bh = Math.max(maxY - minY, 1);
      const margin = 48;
      const fit = Math.min((W - 2 * margin) / bw, (H - 2 * margin) / bh);
      const s = fit * cam.current.zoom;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      // 문서 평면(mm, y 북) → 캔버스 px (y 아래) — 북향 위로 플립
      const toPx = (p: Pt): [number, number] => [
        (p[0] - cx) * s + W / 2 + cam.current.panX,
        H / 2 - (p[1] - cy) * s + cam.current.panY,
      ];
      const strokePoly = (pts: Pt[], closed: boolean, color: string, width: number) => {
        if (pts.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const [x, y] = toPx(p);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        if (closed) ctx.closePath();
        ctx.stroke();
      };

      // 입면 실루엣 — far→near 순서대로 흰 채움+stroke = painter's 은선제거
      for (const pl of d.silhouettes ?? []) {
        if (pl.pts.length < 2) continue;
        ctx.beginPath();
        pl.pts.forEach((p, i) => {
          const [x, y] = toPx(p);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      // 해치(가장 옅게)
      ctx.strokeStyle = '#c4c4c4';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const [a, b] of d.hatch) {
        const [ax, ay] = toPx(a);
        const [bx, by] = toPx(b);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      // 투영(가는 회색)
      for (const pl of d.proj) strokePoly(pl.pts, pl.closed, '#8a8a8a', 1);
      // 절단(굵은 검정)
      for (const pl of d.cut) strokePoly(pl.pts, pl.closed, '#111', 2.4);
      // 라벨(빨강)
      ctx.fillStyle = '#c0392b';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of d.labels) {
        const [x, y] = toPx(l.pos);
        ctx.fillText(l.text, x, y);
      }
    };

    drawRef.current = draw;
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [open, active, store, version]);

  if (!open) return null;

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    cam.current.zoom = Math.max(0.05, Math.min(40, cam.current.zoom * f));
    drawRef.current();
  };
  const onDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    cam.current.panX += e.clientX - drag.current.x;
    cam.current.panY += e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    drawRef.current();
  };
  const onUp = () => {
    drag.current = null;
  };

  const newPlan = () => {
    const lid = activeLevelId;
    if (!lid) return;
    const lvl = store.getLevel(lid);
    const id = store.createView({
      name: `평면 · ${lvl?.name ?? '레벨'}`,
      type: 'plan',
      levelId: lid,
      cutHeight: 1200,
    });
    useUiStore.getState().setActiveViewId(id);
  };

  return (
    <div style={panelS}>
      <div style={headS}>
        <span style={{ fontWeight: 600 }}>도면</span>
        <select
          value={active?.id ?? ''}
          onChange={(e) => useUiStore.getState().setActiveViewId(e.target.value || null)}
          style={selS}
        >
          {views.length === 0 && <option value="">— 도면 없음 —</option>}
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button style={btnS} onClick={newPlan} disabled={!activeLevelId} title="현재 레벨의 평면도 생성">
          + 평면도
        </button>
        <button
          style={btnS}
          onClick={() => {
            useUiStore.getState().setDrawingOpen(false);
            useUiStore.getState().setTool('section');
          }}
          title="평면에 절단선을 그어 단면 생성"
        >
          + 단면
        </button>
        <button
          style={btnS}
          onClick={() => {
            useUiStore.getState().setDrawingOpen(false);
            useUiStore.getState().setTool('elevation');
          }}
          title="평면에 시선선을 그어 입면 생성 (선 +n 쪽에서 바라봄)"
        >
          + 입면
        </button>
        {active && (
          <button style={btnS} onClick={() => void downloadDrawingDxf(active, store, active.name)} title="DXF로 내보내기 (2D 도면 납품)">
            DXF
          </button>
        )}
        {active && (
          <button
            style={btnS}
            onClick={() => {
              store.deleteView(active.id);
              useUiStore.getState().setActiveViewId(null);
            }}
            title="이 도면 삭제"
          >
            삭제
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button style={btnS} onClick={() => useUiStore.getState().setDrawingOpen(false)}>
          ✕
        </button>
      </div>
      <canvas
        ref={canvasRef}
        data-drawing="1"
        style={{ flex: 1, width: '100%', display: 'block', cursor: 'grab', background: '#fff' }}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
      />
      {views.length === 0 && (
        <div style={hintS}>현재 레벨의 평면도를 생성하세요. 휠=줌, 드래그=이동.</div>
      )}
    </div>
  );
}

const panelS: React.CSSProperties = {
  position: 'fixed',
  top: '8vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(78vw, 1100px)',
  height: '78vh',
  background: '#fff',
  border: '1px solid #d0d0d0',
  borderRadius: 8,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 50,
};
const headS: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid #eee',
  fontSize: 13,
};
const selS: React.CSSProperties = { fontSize: 13, padding: '2px 6px' };
const btnS: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 8px',
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fafafa',
  cursor: 'pointer',
};
const hintS: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: 16,
  fontSize: 12,
  color: '#888',
};
