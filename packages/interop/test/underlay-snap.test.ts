import { describe, expect, it } from 'vitest';
import { UnderlaySnapIndex } from '../src/underlaySnap';
import type { DwgUnderlay } from '../src/dwgUnderlay';

/**
 * 언더레이 끝점 스냅 — 회전 배치 부호 고정 테스트 (필수, 계획서).
 * ReferenceLayer.addUnderlay TRS = scale → rotation.y=-r → position. 여기 기대값은
 * Three R_y(φ) 정의(x' = cosφ·x + sinφ·z, z' = -sinφ·x + cosφ·z, φ=-r)로 **독립 유도** —
 * 구현식과 다른 형태의 수식이라 부호 슬립을 잡는다. 시각적으로-틀린-점 스냅 = 스냅 없느니만 못함.
 */

function underlayWith(segments: number[], layerHidden = [false]): DwgUnderlay {
  const segCount = segments.length / 4;
  return {
    segments: Float32Array.from(segments),
    segLayer: new Uint16Array(segCount), // 전부 레이어 0
    layers: ['0'],
    layerHidden,
    layerColor: [0],
    layerSegCount: [segCount],
    labels: [],
    fills: [],
    skipped: {},
    bbox: [0, 0, 1000, 1000],
  };
}

/** Three group TRS 독립 재현: doc = R_y(-r)·(s·[lx,·,ly]) + origin (Three [x,z] = doc [x,y]). */
function threeTrs(lx: number, ly: number, origin: [number, number], r: number, s: number): [number, number] {
  const phi = -r;
  const x = s * lx;
  const z = s * ly;
  const xw = Math.cos(phi) * x + Math.sin(phi) * z;
  const zw = -Math.sin(phi) * x + Math.cos(phi) * z;
  return [Math.round(origin[0] + xw), Math.round(origin[1] + zw)];
}

describe('UnderlaySnapIndex — 빽도면 끝점 스냅', () => {
  it('identity 배치 — 세그 양끝점이 후보로, 공유 끝점은 dedupe', () => {
    // 두 세그가 (1000,0)을 공유 → 점 3개
    const idx = new UnderlaySnapIndex(underlayWith([0, 0, 1000, 0, 1000, 0, 1000, 1000]), {
      origin: [0, 0],
      rotation: 0,
      scale: 1,
    });
    expect(idx.pointCount).toBe(3);
    const out: [number, number][] = [];
    idx.candidatesNear([990, 10], 50, out);
    expect(out).toEqual([[1000, 0]]);
  });

  it('회전+스케일+이동 배치 — Three TRS 독립 유도값과 일치 (부호 고정)', () => {
    const origin: [number, number] = [10_000, 5_000];
    const r = Math.PI / 2;
    const s = 2;
    const idx = new UnderlaySnapIndex(underlayWith([0, 0, 1000, 0]), { origin, rotation: r, scale: s });
    // 로컬 (1000,0) → Three TRS 기대값
    const expected = threeTrs(1000, 0, origin, r, s);
    const out: [number, number][] = [];
    idx.candidatesNear(expected, 5, out);
    expect(out).toEqual([expected]);
    // 부호가 뒤집힌 가짜 후보 자리는 비어야 함 (예: origin + [0, -2000])
    const wrong: [number, number] = [origin[0], origin[1] - 2000];
    const none: [number, number][] = [];
    idx.candidatesNear(wrong, 5, none);
    expect(none).toEqual([]);
  });

  it('layerHidden 레이어 제외 + clip 밖 끝점 제외 (렌더 규칙 동일)', () => {
    const hidden = new UnderlaySnapIndex(underlayWith([0, 0, 1000, 0], [true]), {
      origin: [0, 0],
      rotation: 0,
      scale: 1,
    });
    expect(hidden.pointCount).toBe(0);

    const clipped = new UnderlaySnapIndex(underlayWith([0, 0, 1000, 0]), {
      origin: [0, 0],
      rotation: 0,
      scale: 1,
      clip: [-10, -10, 500, 500], // (1000,0)은 클립 밖
    });
    expect(clipped.pointCount).toBe(1);
    const out: [number, number][] = [];
    clipped.candidatesNear([0, 0], 5, out);
    expect(out).toEqual([[0, 0]]);
  });

  it('capPoints 상한 — 초과 시 capped 플래그 + 드롭', () => {
    const idx = new UnderlaySnapIndex(underlayWith([0, 0, 1000, 0, 2000, 0, 3000, 0]), {
      origin: [0, 0],
      rotation: 0,
      scale: 1,
    }, 2);
    expect(idx.capped).toBe(true);
    expect(idx.pointCount).toBe(2);
  });
});
