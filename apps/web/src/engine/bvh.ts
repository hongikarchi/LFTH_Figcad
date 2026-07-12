import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

/**
 * three-mesh-bvh 전역 배선 — 걷기(1인칭) 지면 스냅·벽 충돌 레이가 1M-tri federation에서도
 * 프레임 예산 안에 들게. `boundsTree`가 **있는** 지오메트리만 가속 경로를 타므로(라이브러리 계약)
 * Picker 등 기존 레이캐스트는 무영향 — BVH는 WalkController가 큰 메시에만 점진 빌드한다.
 * (BVH 결과는 기존 raycast와 동일 히트 — 정렬·distance 계약 보존. 타입 증강은 라이브러리가 제공.)
 */
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** 이 삼각형 수 이상이면 걷기 진입 시 BVH 빌드 대상 (작은 메시는 기존 브루트포스가 더 쌈) */
export const BVH_MIN_TRIS = 20_000;

/** 루트 아래에서 BVH가 필요한(크고 아직 없는) 메시 수집 — WalkController 점진 빌드 큐용 */
export function collectBvhCandidates(roots: THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const root of roots) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.geometry.boundsTree) return;
      const pos = m.geometry.getAttribute('position');
      if (!pos) return;
      const tris = (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
      if (tris >= BVH_MIN_TRIS) out.push(m);
    });
  }
  return out;
}
