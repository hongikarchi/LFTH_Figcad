import earcut from 'earcut';

/**
 * 프로필 폴리곤(+구멍) 압출 메시 빌더.
 * THREE.ExtrudeGeometry 대체 — 베벨 없음, 와인딩·법선 완전 통제.
 * 출력: non-indexed 삼각형 배열 (동적 편집 시 재인덱싱 불필요) + 피처 엣지.
 *
 * 규약: 외곽 CCW, 구멍 CW (enforceWinding이 보정).
 * 프로필 공간 (u,v) + 압출 깊이 w. mapToWorld가 (u,v,w) → 월드 [x,y,z] 변환.
 */

export type Ring = [number, number][];

export interface Profile {
  outer: Ring;
  holes: Ring[];
}

export interface MeshData {
  positions: Float32Array; // 삼각형당 9개 값 (non-indexed)
  normals: Float32Array;
  edges: Float32Array; // 선분당 6개 값
}

function signedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** 외곽 CCW, 구멍 CW 보장 (earcut + 측면 법선 규약의 전제) */
export function enforceWinding(profile: Profile): Profile {
  const outer = signedArea(profile.outer) < 0 ? [...profile.outer].reverse() : profile.outer;
  const holes = profile.holes.map((h) => (signedArea(h) > 0 ? [...h].reverse() : h));
  return { outer, holes };
}

export type MapToWorld = (u: number, v: number, w: number) => [number, number, number];

export function extrudeProfile(rawProfile: Profile, depth: number, map: MapToWorld): MeshData {
  const profile = enforceWinding(rawProfile);
  const rings = [profile.outer, ...profile.holes];

  // earcut 입력: 평탄화 좌표 + 구멍 시작 인덱스
  const coords: number[] = [];
  const holeIndices: number[] = [];
  for (let r = 0; r < rings.length; r++) {
    if (r > 0) holeIndices.push(coords.length / 2);
    for (const [u, v] of rings[r]!) coords.push(u, v);
  }
  const tris = earcut(coords, holeIndices.length ? holeIndices : undefined);

  const positions: number[] = [];
  const edges: number[] = [];
  const hw = depth / 2;

  const pushTri = (
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
  ) => {
    positions.push(...p1, ...p2, ...p3);
  };
  const at = (i: number, w: number): [number, number, number] =>
    map(coords[i * 2]!, coords[i * 2 + 1]!, w);

  // 앞면 (w=+hw): earcut 와인딩 유지 (외곽 CCW → 법선 +w)
  for (let t = 0; t < tris.length; t += 3) {
    pushTri(at(tris[t]!, hw), at(tris[t + 1]!, hw), at(tris[t + 2]!, hw));
  }
  // 뒷면 (w=-hw): 와인딩 반전
  for (let t = 0; t < tris.length; t += 3) {
    pushTri(at(tris[t]!, -hw), at(tris[t + 2]!, -hw), at(tris[t + 1]!, -hw));
  }

  // 측면 + 엣지: 링별로 순회 (외곽 CCW / 구멍 CW → 측면 법선이 항상 솔리드 바깥)
  let base = 0;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const i0 = base + i;
      const i1 = base + ((i + 1) % n);
      const f0 = at(i0, hw);
      const f1 = at(i1, hw);
      const b0 = at(i0, -hw);
      const b1 = at(i1, -hw);
      // 측면 쿼드 → 삼각형 2개: (b0,b1,f1), (b0,f1,f0)
      pushTri(b0, b1, f1);
      pushTri(b0, f1, f0);
      // 피처 엣지: 앞 링, 뒷 링, 세로 커넥터
      edges.push(...f0, ...f1);
      edges.push(...b0, ...b1);
      edges.push(...f0, ...b0);
    }
    base += n;
  }

  const posArr = new Float32Array(positions);
  return {
    positions: posArr,
    normals: computeFlatNormals(posArr),
    edges: new Float32Array(edges),
  };
}

/**
 * 면 단위 빌더 — 하이브리드 메시의 기본 단위.
 * 각 면 = 2D 프로필(구멍 가능) + (u,v)→월드 매핑. 마이터 풋프린트 프리즘의
 * 측면에 개구부 구멍을 뚫는 벽 파생이 주 사용처.
 * 와인딩 규약: enforceWinding 후 CCW 프로필의 법선 = e_u × e_v 방향.
 * flip=true면 반전.
 */
export interface FaceSpec {
  profile: Profile;
  map: (u: number, v: number) => [number, number, number];
  flip?: boolean;
  /** 링 외곽선을 피처 엣지로 출력 (기본 false) */
  edges?: boolean;
}

export function buildFaces(faces: FaceSpec[]): MeshData {
  const positions: number[] = [];
  const edges: number[] = [];

  for (const face of faces) {
    const profile = enforceWinding(face.profile);
    const rings = [profile.outer, ...profile.holes];

    const coords: number[] = [];
    const holeIndices: number[] = [];
    for (let r = 0; r < rings.length; r++) {
      if (r > 0) holeIndices.push(coords.length / 2);
      for (const [u, v] of rings[r]!) coords.push(u, v);
    }
    const tris = earcut(coords, holeIndices.length ? holeIndices : undefined);
    const at = (i: number): [number, number, number] =>
      face.map(coords[i * 2]!, coords[i * 2 + 1]!);

    for (let t = 0; t < tris.length; t += 3) {
      const p1 = at(tris[t]!);
      const p2 = at(tris[t + 1]!);
      const p3 = at(tris[t + 2]!);
      if (face.flip) positions.push(...p1, ...p3, ...p2);
      else positions.push(...p1, ...p2, ...p3);
    }

    if (face.edges) {
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const [u1, v1] = ring[i]!;
          const [u2, v2] = ring[(i + 1) % ring.length]!;
          edges.push(...face.map(u1, v1), ...face.map(u2, v2));
        }
      }
    }
  }

  const posArr = new Float32Array(positions);
  return {
    positions: posArr,
    normals: computeFlatNormals(posArr),
    edges: new Float32Array(edges),
  };
}

/** 두 MeshData 합치기 */
export function mergeMeshData(parts: MeshData[]): MeshData {
  const pos = new Float32Array(parts.reduce((n, p) => n + p.positions.length, 0));
  const nor = new Float32Array(pos.length);
  const edg = new Float32Array(parts.reduce((n, p) => n + p.edges.length, 0));
  let po = 0;
  let eo = 0;
  for (const p of parts) {
    pos.set(p.positions, po);
    nor.set(p.normals, po);
    edg.set(p.edges, eo);
    po += p.positions.length;
    eo += p.edges.length;
  }
  return { positions: pos, normals: nor, edges: edg };
}

/** non-indexed 삼각형 배열의 면 법선 (플랫 셰이딩) */
export function computeFlatNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]!,
      ay = positions[i + 1]!,
      az = positions[i + 2]!;
    const bx = positions[i + 3]!,
      by = positions[i + 4]!,
      bz = positions[i + 5]!;
    const cx = positions[i + 6]!,
      cy = positions[i + 7]!,
      cz = positions[i + 8]!;
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (let j = 0; j < 3; j++) {
      normals[i + j * 3] = nx;
      normals[i + j * 3 + 1] = ny;
      normals[i + j * 3 + 2] = nz;
    }
  }
  return normals;
}
