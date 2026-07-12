import type { ViewActions } from './App';
import type { ViewPreset } from '../engine/CameraRig';

/**
 * 뷰 기즈모 — 캔버스 우상단, 항상-on. 표준 뷰로 즉시 전환(Revit/Blender 넘패드 식).
 * Top=평면(직교 탑다운), 입면 4방향+Btm=**true 직교**(8b — 원근 왜곡 없음), Iso=원근 등각.
 * 입면 라벨 = 보이는 면 기준(§C 결정1): front=남쪽서 봄=남측 입면. (S2에서 축-공 위젯으로 대체 예정)
 */
const VIEWS: { p: ViewPreset; label: string; title: string }[] = [
  { p: 'top', label: 'Top', title: '평면 (위에서 · 직교)' },
  { p: 'iso', label: 'Iso', title: '등각 (기본 3D · 원근)' },
  { p: 'front', label: 'Front', title: '정면 (남측 입면 · 직교)' },
  { p: 'back', label: 'Back', title: '배면 (북측 입면 · 직교)' },
  { p: 'left', label: 'Left', title: '좌측 (서측 입면 · 직교)' },
  { p: 'right', label: 'Right', title: '우측 (동측 입면 · 직교)' },
  { p: 'bottom', label: 'Btm', title: '저면 (아래에서 · 직교 — 천장·보 하부)' },
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
