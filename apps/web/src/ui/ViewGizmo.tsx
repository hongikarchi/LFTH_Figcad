import type { ViewActions } from './App';
import type { ViewPreset } from '../engine/CameraRig';

/**
 * 뷰 기즈모 (항목8a) — 캔버스 우상단, 항상-on. 표준 뷰로 즉시 전환(Revit/Blender 넘패드 식).
 * Top=평면(직교), Front/Back/Left/Right=3D 표준 방위(원근 — true 직교 입면은 8b), Iso=등각.
 */
const VIEWS: { p: ViewPreset; label: string; title: string }[] = [
  { p: 'top', label: 'Top', title: '평면 (위에서 · 직교)' },
  { p: 'iso', label: 'Iso', title: '등각 (기본 3D)' },
  { p: 'front', label: 'Front', title: '정면 (북측 입면)' },
  { p: 'back', label: 'Back', title: '배면 (남측 입면)' },
  { p: 'left', label: 'Left', title: '좌측 (서측 입면)' },
  { p: 'right', label: 'Right', title: '우측 (동측 입면)' },
];

export function ViewGizmo({ actions }: { actions: ViewActions }) {
  return (
    <div className="view-gizmo" title="뷰 전환">
      {VIEWS.map((v) => (
        <button key={v.p} title={v.title} onClick={() => actions.setView(v.p)}>
          {v.label}
        </button>
      ))}
    </div>
  );
}
