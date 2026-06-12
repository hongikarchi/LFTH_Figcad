import { extrudeProfile, type MeshData, type Profile } from './meshBuilder';
import { endCorners, type JoinInfo } from './joins';
import type { WallDeriveInput } from '../schema';

const MM = 0.001; // 문서 mm → 렌더 월드 m

export interface DerivedGeometry extends MeshData {
  /** 스냅/치수 앵커 (월드 m): 중심선 양 끝 */
  anchors: { a: [number, number, number]; b: [number, number, number] };
}

/**
 * 벽 파생 — 순수 함수. 입력 스냅샷만 보고 월드 좌표(m, Y-up) 메시를 만든다.
 *
 * 표현: 평면 풋프린트(조인 처리된 코너 4개) → 수직 압출 프리즘.
 * 끝점 공유 이웃이 있으면 마이터 코너(joins.ts), 없으면 사각 캡.
 * M3 개구부는 긴 측면을 면 단위로 분리해 구멍을 뚫는 하이브리드로 확장 예정.
 *
 * 프로필 공간: (u,v) = (x_m, -y_m) — w(압출)=상향과 오른손 좌표계가 되도록
 * 문서 y를 반전 (CCW/법선 규약 유지). 월드 변환에서 z = -v로 복원.
 */
export function deriveWall(input: WallDeriveInput): DerivedGeometry {
  const { wall, type, level, joins } = input;
  const [axMm, ayMm] = wall.a;
  const [bxMm, byMm] = wall.b;

  const lenMm = Math.hypot(bxMm - axMm, byMm - ayMm);
  if (lenMm === 0) {
    // 퇴화 벽 — 유령 메시 대신 빈 지오메트리 (ops 경계 가드의 이중 방어)
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      edges: new Float32Array(0),
      anchors: {
        a: [axMm * MM, level.elevation * MM, ayMm * MM],
        b: [bxMm * MM, level.elevation * MM, byMm * MM],
      },
    };
  }
  const dir: [number, number] = [(bxMm - axMm) / lenMm, (byMm - ayMm) / lenMm];
  const negDir: [number, number] = [-dir[0], -dir[1]];
  const tw = type.thickness;

  // 끝 코너 (doc mm). B 끝은 안쪽 방향이 -dir → 로컬 ±가 전역 ∓로 뒤집힌다.
  const ca = endCorners([axMm, ayMm], dir, tw, joins?.a ?? null);
  const cb = endCorners([bxMm, byMm], negDir, tw, joins?.b ?? null);
  const aPlus = ca.plus;
  const aMinus = ca.minus;
  const bPlus = cb.minus;
  const bMinus = cb.plus;

  const heightM = (wall.height ?? level.height) * MM;
  const baseY = (level.elevation + (wall.baseOffset ?? 0)) * MM;

  const profile: Profile = {
    outer: [aMinus, bMinus, bPlus, aPlus].map(([x, y]) => [x * MM, -y * MM] as [number, number]),
    holes: [],
  };

  const mesh = extrudeProfile(profile, heightM, (u, v, w) => [
    u,
    baseY + heightM / 2 + w,
    -v,
  ]);

  return {
    ...mesh,
    anchors: {
      a: [axMm * MM, baseY, ayMm * MM],
      b: [bxMm * MM, baseY, byMm * MM],
    },
  };
}

const roundDir = (j: JoinInfo | null | undefined) =>
  j ? [Math.round(j.dir[0] * 1e6), Math.round(j.dir[1] * 1e6), j.thickness] : null;

/** 파생 캐시 키 — 자기 파라미터 + 조인(이웃) 정보의 안정 직렬화 */
export function wallDeriveKey(input: WallDeriveInput): string {
  const { wall, type, level, joins } = input;
  return JSON.stringify([
    wall.a,
    wall.b,
    wall.height ?? null,
    wall.baseOffset ?? null,
    type.thickness,
    type.color,
    level.elevation,
    level.height,
    roundDir(joins?.a),
    roundDir(joins?.b),
  ]);
}
