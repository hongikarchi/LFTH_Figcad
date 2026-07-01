import * as THREE from 'three';

/**
 * 클리핑 평면 단면선(section line) — 메시∩평면 윤곽을 CPU로 계산(라이노 클립 section curve / Make2D 라인).
 * 스텐실 캡과 달리 **열린 메시(매싱 셸)서도 동작**(삼각면별 교차 = 닫힘 여부 무관). 큰 메시는 비싸므로
 * clip 변경 시 디바운스해 호출(매 프레임 아님). 결과 = 월드좌표 세그먼트 endpoint Float32Array(LineSegments용).
 */
export function computeSectionContour(meshes: THREE.Mesh[], plane: THREE.Plane): Float32Array {
  const out: number[] = [];
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo?.attributes?.position as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    mesh.updateWorldMatrix(true, false);
    const m = mesh.matrixWorld;
    const idx = geo.index;
    const tri = (i0: number, i1: number, i2: number): void => {
      va.fromBufferAttribute(pos, i0).applyMatrix4(m);
      vb.fromBufferAttribute(pos, i1).applyMatrix4(m);
      vc.fromBufferAttribute(pos, i2).applyMatrix4(m);
      const da = plane.distanceToPoint(va);
      const db = plane.distanceToPoint(vb);
      const dc = plane.distanceToPoint(vc);
      const pts: number[] = [];
      // 부호 바뀌는 변 = 평면 교차점(선형보간 t = d1/(d1-d2))
      if ((da < 0) !== (db < 0)) { const t = da / (da - db); pts.push(va.x + (vb.x - va.x) * t, va.y + (vb.y - va.y) * t, va.z + (vb.z - va.z) * t); }
      if ((db < 0) !== (dc < 0)) { const t = db / (db - dc); pts.push(vb.x + (vc.x - vb.x) * t, vb.y + (vc.y - vb.y) * t, vb.z + (vc.z - vb.z) * t); }
      if ((dc < 0) !== (da < 0)) { const t = dc / (dc - da); pts.push(vc.x + (va.x - vc.x) * t, vc.y + (va.y - vc.y) * t, vc.z + (va.z - vc.z) * t); }
      if (pts.length === 6) out.push(...pts); // 2 교차점 = 단면선 1세그먼트
    };
    if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
  }
  return new Float32Array(out);
}

const WELD_EPS = 1e-4; // 월드 m — 인접 삼각면이 공유 변서 낸 동일 교차점 병합(<0.1mm)

type V2 = [number, number];

/** 2D ray-cast point-in-polygon (경계 겹침 없는 비교차 루프 전제) */
function pointInPoly(px: number, py: number, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0], yi = poly[i]![1], xj = poly[j]![0], yj = poly[j]![1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 단면 poché(해치) — 절단선 세그먼트를 평면 2D로 투영·용접 후 닫힌 루프로 스티칭, depth-parity로
 * 외곽/구멍을 분류해 삼각분할 채움. **닫힌 솔리드** = 완전 poché, **열린 셸** = 닫히는 루프만 채움
 * (열린 경계=미채움, 선만). 결과 = 월드좌표 삼각형 정점 Float32Array(9 float/tri). 세그먼트는
 * computeSectionContour 출력 재사용(재계산 없음).
 */
export function computeSectionFill(segments: Float32Array, plane: THREE.Plane): Float32Array {
  const segCount = (segments.length / 6) | 0;
  if (segCount < 3) return new Float32Array(0);

  // 평면 2D 기저 (u,v ⟂ normal), origin = 평면 위 한 점
  const n = plane.normal;
  const u = new THREE.Vector3();
  if (Math.abs(n.x) < 0.9) u.set(1, 0, 0);
  else u.set(0, 1, 0);
  u.crossVectors(n, u).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const origin = n.clone().multiplyScalar(-plane.constant);

  // 정점 용접 → 인덱스 (양자화 격자 키)
  const verts: V2[] = [];
  const key2idx = new Map<string, number>();
  const p = new THREE.Vector3();
  const weld = (x: number, y: number, z: number): number => {
    p.set(x, y, z).sub(origin);
    const a = p.dot(u), b = p.dot(v);
    const key = `${Math.round(a / WELD_EPS)},${Math.round(b / WELD_EPS)}`;
    let i = key2idx.get(key);
    if (i === undefined) { i = verts.length; verts.push([a, b]); key2idx.set(key, i); }
    return i;
  };
  // 엣지 + 인접
  const edges: Array<[number, number]> = [];
  const adj: number[][] = []; // vertexIdx → edgeIdx[]
  const ensureAdj = (i: number) => { while (adj.length <= i) adj.push([]); };
  for (let s = 0; s < segCount; s++) {
    const o = s * 6;
    const a = weld(segments[o]!, segments[o + 1]!, segments[o + 2]!);
    const b = weld(segments[o + 3]!, segments[o + 4]!, segments[o + 5]!);
    if (a === b) continue; // 길이 0
    const eid = edges.length;
    edges.push([a, b]);
    ensureAdj(a); ensureAdj(b);
    adj[a]!.push(eid); adj[b]!.push(eid);
  }

  // 스티칭 — 미사용 엣지서 시작해 인접 따라 닫힌 루프 추적
  const used = new Array(edges.length).fill(false);
  const loops: V2[][] = [];
  for (let e0 = 0; e0 < edges.length; e0++) {
    if (used[e0]) continue;
    const start = edges[e0]![0];
    let cur = edges[e0]![1];
    used[e0] = true;
    const loopIdx: number[] = [start, cur];
    let closed = false;
    for (let guard = 0; guard < edges.length + 1; guard++) {
      if (cur === start) { closed = true; break; }
      const cand = adj[cur]!.find((eid) => !used[eid]);
      if (cand === undefined) break; // 열린 경계 → 미채움
      used[cand] = true;
      const [ea, eb] = edges[cand]!;
      const next = ea === cur ? eb : ea;
      cur = next;
      if (next === start) { closed = true; break; }
      loopIdx.push(next);
    }
    if (closed && loopIdx.length >= 3) loops.push(loopIdx.map((i) => verts[i]!));
  }
  if (!loops.length) return new Float32Array(0);

  // depth-parity 분류: repPoint(loop[0]) 를 다른 루프들이 포함하는 개수 = depth. 짝=외곽, 홀=구멍.
  const depth = loops.map((L, i) => {
    let d = 0;
    for (let j = 0; j < loops.length; j++) if (j !== i && pointInPoly(L[0]![0], L[0]![1], loops[j]!)) d++;
    return d;
  });
  // 각 홀 → 즉시 부모 외곽(그를 포함하며 depth-1)
  const holesOf = new Map<number, number[]>();
  for (let h = 0; h < loops.length; h++) {
    if (depth[h]! % 2 === 0) continue; // 외곽
    let parent = -1;
    for (let o = 0; o < loops.length; o++) {
      if (o === h || depth[o]! !== depth[h]! - 1) continue;
      if (pointInPoly(loops[h]![0]![0], loops[h]![0]![1], loops[o]!)) { parent = o; break; }
    }
    if (parent >= 0) { if (!holesOf.has(parent)) holesOf.set(parent, []); holesOf.get(parent)!.push(h); }
  }

  // 외곽(짝 depth)마다 홀과 삼각분할 → 3D
  const tris: number[] = [];
  const toV2 = (a: V2) => new THREE.Vector2(a[0], a[1]);
  const push3d = (a: V2) => tris.push(origin.x + u.x * a[0] + v.x * a[1], origin.y + u.y * a[0] + v.y * a[1], origin.z + u.z * a[0] + v.z * a[1]);
  for (let o = 0; o < loops.length; o++) {
    if (depth[o]! % 2 !== 0) continue; // 외곽만
    const contour = loops[o]!.map(toV2);
    const holeLoops = (holesOf.get(o) ?? []).map((h) => loops[h]!.map(toV2));
    const combined: V2[] = [loops[o]!, ...(holesOf.get(o) ?? []).map((h) => loops[h]!)].flat();
    let faces: number[][];
    try { faces = THREE.ShapeUtils.triangulateShape(contour, holeLoops); } catch { continue; }
    for (const f of faces) {
      if (f.length !== 3) continue;
      push3d(combined[f[0]!]!); push3d(combined[f[1]!]!); push3d(combined[f[2]!]!);
    }
  }
  return new Float32Array(tris);
}
