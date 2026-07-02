import { extrudeProfile, mergeMeshData, type MeshData, type Profile, type Ring } from './meshBuilder';
import type { DerivedGeometry } from './deriveWall';
import type { AssetDeriveInput, AssetKind } from '../schema';

/**
 * 배치 오브젝트(엔투라지) 파생(항목7) — 종류별 절차적 로우폴리 수직 프리즘 조합.
 * 실 에셋 파이프라인 없이 인-리포·결정론(불변①). 색은 SceneManager가 assetKind로 지정.
 * 좌표 규약 = 기둥과 동일: 프로필은 월드(x, -z) 미터, 압출 깊이 w가 높이(Y).
 */
const MM = 0.001;

/** 종류별 기본 높이 (mm) — height 미지정 시. */
const DEFAULT_HEIGHT: Record<AssetKind, number> = {
  tree: 4000,
  person: 1700,
  car: 1500,
  bush: 700,
};

function box(hw: number, hd: number): Ring {
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
}
function octagon(r: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return ring;
}

/** 평면 footprint 링(mm, at 중심)을 y0~y1(월드 m) 사이 수직 프리즘으로. */
function part(cx: number, cy: number, ring: Ring, y0: number, y1: number): MeshData {
  const profile: Profile = {
    outer: ring.map(([sx, sy]) => [(cx + sx) * MM, -(cy + sy) * MM] as [number, number]),
    holes: [],
  };
  const depth = y1 - y0;
  const centerY = (y0 + y1) / 2;
  return extrudeProfile(profile, depth, (u, v, w) => [u, centerY + w, -v]);
}

export function deriveAsset(input: AssetDeriveInput): DerivedGeometry {
  const { asset, level } = input;
  const [cx, cy] = asset.at;
  const Hmm = asset.height ?? DEFAULT_HEIGHT[asset.assetKind]; // 링 크기용(mm)
  const H = Hmm * MM; // 높이(m)
  const baseY = (level.elevation + (asset.baseOffset ?? 0)) * MM;
  const parts: MeshData[] = [];
  const seg = (ring: Ring, y0f: number, y1f: number): void => {
    parts.push(part(cx, cy, ring, baseY + y0f * H, baseY + y1f * H));
  };
  switch (asset.assetKind) {
    case 'tree':
      seg(box(Hmm * 0.04, Hmm * 0.04), 0, 0.42); // 줄기
      seg(octagon(Hmm * 0.2), 0.38, 1); // 수관
      break;
    case 'bush':
      seg(octagon(Hmm * 0.75), 0, 1); // 낮고 넓은 관목
      break;
    case 'person':
      seg(box(Hmm * 0.11, Hmm * 0.07), 0, 0.84); // 몸통
      seg(box(Hmm * 0.07, Hmm * 0.07), 0.8, 1); // 머리
      break;
    case 'car':
      seg(box(Hmm * 1.35, Hmm * 0.6), 0, 0.62); // 차체
      seg(box(Hmm * 0.7, Hmm * 0.52), 0.55, 1); // 캐빈
      break;
  }
  const mesh = mergeMeshData(parts);
  return {
    ...mesh,
    anchors: {
      a: [cx * MM, baseY, cy * MM], // 베이스 중심
      b: [cx * MM, baseY + H, cy * MM], // 상단 중심
    },
  };
}

export function assetDeriveKey(input: AssetDeriveInput): string {
  const { asset, level } = input;
  return JSON.stringify([
    asset.at,
    asset.assetKind,
    asset.height ?? null,
    asset.baseOffset ?? null,
    level.elevation,
  ]);
}
