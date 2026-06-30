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
