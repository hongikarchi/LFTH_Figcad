import { buildFaces, type Profile } from './meshBuilder';
import type { DerivedGeometry } from './deriveWall';
import type { DimensionDeriveInput, TextDeriveInput } from '../schema';

const MM = 0.001;
const Y_LIFT = 0.02; // 지면 살짝 위 (평면 주석)

/**
 * 텍스트 주석 — 평면 점에 라벨 + 픽킹용 작은 리본(스프라이트는 레이캐스트 안 됨).
 * 라벨은 labels 채널로 SceneManager가 스프라이트 렌더. 메시는 픽 프록시 전용.
 */
export function deriveText(input: TextDeriveInput): DerivedGeometry {
  const { text, level } = input;
  const [ax, ay] = text.at;
  const y = level.elevation * MM + Y_LIFT;
  const size = text.size ?? 200;
  const hw = (Math.max(text.text.length, 1) * size * 0.6) / 2;
  const hh = (size * 1.4) / 2;

  // 픽 프록시 쿼드 (텍스트 박스 대략) — 거의 안 보이게, SceneManager가 grid처럼 투명 처리
  const ribbon: Profile = {
    outer: [
      [ax - hw, -(ay - hh)],
      [ax + hw, -(ay - hh)],
      [ax + hw, -(ay + hh)],
      [ax - hw, -(ay + hh)],
    ],
    holes: [],
  };
  const mesh = buildFaces([{ profile: ribbon, map: (u, v) => [u * MM, y, -v * MM] }]);
  const pos: [number, number, number] = [ax * MM, y, ay * MM];
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    edges: new Float32Array(0),
    anchors: { a: pos, b: pos },
    labels: [{ text: text.text, pos, style: 'text' }],
  };
}

export function textDeriveKey(input: TextDeriveInput): string {
  const { text, level } = input;
  return JSON.stringify([text.at, text.text, text.size ?? null, level.elevation]);
}

const TICK = 120; // 끝 틱 길이 mm
const RIBBON_HW = 40; // 픽 리본 반폭 mm
const DEFAULT_OFFSET = 500; // 치수선 기본 standoff mm

/**
 * 치수선 — 해석된 a→b 측정. 보조선 + 치수선 + 끝 틱(에지) + 측정값 라벨.
 * a/b는 DeriveCache가 바인딩을 풀어 넣은 값 (요소 이동 추종). 픽 프록시 = 치수선 리본.
 */
export function deriveDimension(input: DimensionDeriveInput): DerivedGeometry {
  const { dim, level, a, b } = input;
  const y = level.elevation * MM + Y_LIFT;
  const [ax, ay] = a;
  const [bx, by] = b;
  const len = Math.hypot(bx - ax, by - ay);
  const wpt = (px: number, py: number): [number, number, number] => [px * MM, y, py * MM];
  if (len === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      edges: new Float32Array(0),
      anchors: { a: wpt(ax, ay), b: wpt(bx, by) },
      labels: [{ text: '0', pos: wpt(ax, ay), style: 'dim' }],
    };
  }
  const dir: [number, number] = [(bx - ax) / len, (by - ay) / len];
  const n: [number, number] = [-dir[1], dir[0]];
  const off = dim.offset ?? DEFAULT_OFFSET;
  const a2: [number, number] = [ax + n[0] * off, ay + n[1] * off];
  const b2: [number, number] = [bx + n[0] * off, by + n[1] * off];

  const edges: number[] = [];
  const seg = (p: [number, number], q: [number, number]) => {
    edges.push(...wpt(p[0], p[1]), ...wpt(q[0], q[1]));
  };
  // 보조선 (측정점 → 치수선 약간 넘어서)
  const extPast = Math.sign(off || 1) * 80;
  const a2e: [number, number] = [ax + n[0] * (off + extPast), ay + n[1] * (off + extPast)];
  const b2e: [number, number] = [bx + n[0] * (off + extPast), by + n[1] * (off + extPast)];
  seg([ax, ay], a2e);
  seg([bx, by], b2e);
  // 치수선
  seg(a2, b2);
  // 끝 틱 (45° = dir+n 방향 짧은 선)
  const tdx = (dir[0] + n[0]) * (TICK / 2);
  const tdy = (dir[1] + n[1]) * (TICK / 2);
  seg([a2[0] - tdx, a2[1] - tdy], [a2[0] + tdx, a2[1] + tdy]);
  seg([b2[0] - tdx, b2[1] - tdy], [b2[0] + tdx, b2[1] + tdy]);

  // 픽 프록시 리본 (치수선 따라)
  const ribbon: Profile = {
    outer: [
      [a2[0] - n[0] * RIBBON_HW, -(a2[1] - n[1] * RIBBON_HW)],
      [b2[0] - n[0] * RIBBON_HW, -(b2[1] - n[1] * RIBBON_HW)],
      [b2[0] + n[0] * RIBBON_HW, -(b2[1] + n[1] * RIBBON_HW)],
      [a2[0] + n[0] * RIBBON_HW, -(a2[1] + n[1] * RIBBON_HW)],
    ],
    holes: [],
  };
  const mesh = buildFaces([{ profile: ribbon, map: (u, v) => [u * MM, y, -v * MM] }]);

  const mid = wpt((a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2);
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    edges: new Float32Array(edges),
    anchors: { a: wpt(ax, ay), b: wpt(bx, by) },
    labels: [{ text: String(Math.round(len)), pos: mid, style: 'dim' }],
  };
}

export function dimensionDeriveKey(input: DimensionDeriveInput): string {
  const { dim, level, a, b } = input;
  // 해석된 a/b가 키에 들어가므로 바인딩된 요소가 움직이면 자동 재파생
  return JSON.stringify([a, b, dim.offset ?? null, level.elevation]);
}
