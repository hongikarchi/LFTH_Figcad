import { useUiStore, type ClipState } from '../state/uiStore';
import type { ViewActions } from './App';

const AXES: { a: ClipState['axis']; label: string; title: string }[] = [
  { a: 'y', label: '수평', title: '수평 단면 (높이로 자름)' },
  { a: 'x', label: '↔', title: '수직 단면 (동서)' },
  { a: 'z', label: '↕', title: '수직 단면 (남북)' },
];

/**
 * 단면(클리핑 플레인) 컨트롤 — clip 활성 시 떠 있는 컴팩트 위젯(폰+데스크톱 공용).
 * 축(수평/수직) + 위치 슬라이더(모델 0~1) + 남길 쪽 반전 + 끄기. 엔진 적용은 actions.setClip.
 */
export function ClipControl({ actions }: { actions: ViewActions }) {
  const clip = useUiStore((s) => s.clip);
  const setClipState = useUiStore((s) => s.setClipState);
  if (!clip) return null;
  const update = (patch: Partial<ClipState>): void => {
    const next = { ...clip, ...patch };
    setClipState(next);
    actions.setClip(next);
  };
  const off = (): void => {
    setClipState(null);
    actions.setClip(null);
  };
  return (
    <div className="clip-control">
      <div className="clip-row">
        <span className="clip-title">단면</span>
        {AXES.map(({ a, label, title }) => (
          <button key={a} className={`clip-axis ${clip.axis === a ? 'active' : ''}`} title={title} onClick={() => update({ axis: a })}>
            {label}
          </button>
        ))}
        <button className="clip-flip" title="남길 쪽 반전" onClick={() => update({ flip: !clip.flip })}>
          ⇄
        </button>
        <button className="clip-off" title="단면 끄기" onClick={off}>
          ✕
        </button>
      </div>
      <input
        className="clip-slider"
        type="range"
        min="0"
        max="1"
        step="0.005"
        value={clip.t}
        onChange={(e) => update({ t: parseFloat(e.target.value) })}
      />
    </div>
  );
}
