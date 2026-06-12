import { extrudeProfile, type MeshData, type Profile } from './meshBuilder';
import type { WallDeriveInput } from '../schema';

const MM = 0.001; // 문서 mm → 렌더 월드 m

export interface DerivedGeometry extends MeshData {
  /** 스냅/치수 앵커 (월드 m): 중심선 양 끝 */
  anchors: { a: [number, number, number]; b: [number, number, number] };
}

/**
 * 벽 파생 — 순수 함수. 입력 스냅샷만 보고 월드 좌표(m, Y-up) 메시를 만든다.
 * 프로필 = 입면(길이×높이, u=중심선 방향·v=수직), 압출 = 두께 방향.
 * M3에서 개구부가 profile.holes로 들어온다 (CSG 불필요 구조의 핵심).
 * MVP 조인트는 butt joint — 마이터는 이 함수만 수정하면 된다.
 */
export function deriveWall(input: WallDeriveInput): DerivedGeometry {
  const { wall, type, level } = input;
  const ax = wall.a[0] * MM;
  const ay = wall.a[1] * MM;
  const bx = wall.b[0] * MM;
  const by = wall.b[1] * MM;

  const len = Math.hypot(bx - ax, by - ay);
  const height = (wall.height ?? level.height) * MM;
  const thickness = type.thickness * MM;
  const baseY = (level.elevation + (wall.baseOffset ?? 0)) * MM;

  // 중심선 방향 (문서 XY → 렌더 XZ; 문서 y → 렌더 z)
  const dirX = len > 0 ? (bx - ax) / len : 1;
  const dirZ = len > 0 ? (by - ay) / len : 0;
  // 평면 법선 (두께 방향)
  const nX = -dirZ;
  const nZ = dirX;

  const profile: Profile = {
    outer: [
      [0, 0],
      [len, 0],
      [len, height],
      [0, height],
    ],
    holes: [], // M3: 호스트된 개구부 사각형
  };

  const mesh = extrudeProfile(profile, thickness, (u, v, w) => [
    ax + dirX * u + nX * w,
    baseY + v,
    ay + dirZ * u + nZ * w,
  ]);

  return {
    ...mesh,
    anchors: {
      a: [ax, baseY, ay],
      b: [bx, baseY, by],
    },
  };
}

/** 파생 캐시 키 — 입력 스냅샷의 안정 직렬화 */
export function wallDeriveKey(input: WallDeriveInput): string {
  const { wall, type, level } = input;
  return JSON.stringify([
    wall.a,
    wall.b,
    wall.height ?? null,
    wall.baseOffset ?? null,
    type.thickness,
    type.color,
    level.elevation,
    level.height,
  ]);
}
