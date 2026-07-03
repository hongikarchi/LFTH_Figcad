import { useUiStore, LENS_MM_MIN, LENS_MM_MAX } from '../state/uiStore';
import { lensMmToFovDeg } from '../engine/CameraRig';

const PRESETS = [24, 35, 50];

/**
 * 걷기(1인칭) 컨트롤 — walk 활성 시 상단 중앙 플로팅 위젯 (ClipControl 패턴).
 * 렌즈(35mm 환산 초점거리) 슬라이더 + 프리셋 + 종료. 엔진 적용은 main.ts subscribe(lensMm→rig.setFov).
 * 하단은 조이스틱(좌)·클러스터(우)·클립(중) 영역이라 상단 배치.
 */
export function WalkControl() {
  const walkActive = useUiStore((s) => s.walkActive);
  const lensMm = useUiStore((s) => s.lensMm);
  const { setWalkActive, setLensMm } = useUiStore.getState();
  if (!walkActive) return null;
  const mm = Math.round(lensMm);
  return (
    <div className="walk-control">
      <div className="walk-row">
        <span className="walk-title">걷기</span>
        {PRESETS.map((p) => (
          <button key={p} className={`walk-preset ${mm === p ? 'active' : ''}`} title={`${p}mm 렌즈`} onClick={() => setLensMm(p)}>
            {p}
          </button>
        ))}
        <span className="walk-mm" title="렌즈(35mm 환산) · 시야각">
          {mm}mm · {Math.round(lensMmToFovDeg(lensMm))}°
        </span>
        <button className="walk-off" title="걷기 종료 (Esc)" onClick={() => setWalkActive(false)}>
          ✕
        </button>
      </div>
      <input
        className="walk-slider"
        type="range"
        min={LENS_MM_MIN}
        max={LENS_MM_MAX}
        step="1"
        value={mm}
        onChange={(e) => setLensMm(parseFloat(e.target.value))}
      />
    </div>
  );
}
