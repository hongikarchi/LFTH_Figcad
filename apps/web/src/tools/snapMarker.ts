import * as THREE from 'three';
import type { SnapResult } from '@figcad/core';

/**
 * 스냅점 마커 공유 팩토리 (항목6) — 종전 9개 툴이 복붙하던 마커를 단일 소스화.
 * 진단: 크기는 `TARGET_PX * mmPerPixel` = 화면상 상수(원점거리와 무관 — 멀어져도 안 커짐).
 * 사용자 "너무 큼" 원인 = 구 6px 불투명 구가 묵직 + 하한 1cm가 근접줌서 부풀림. →
 * 4.5px + 반투명(뒤가 비침) + 얇은 하한. depthTest:false로 요소에 가리지 않고 항상 보임.
 */
const MARKER_COLORS: Record<SnapResult['kind'], number> = {
  endpoint: 0xff9500, // Apple orange — 연결점
  grid: 0x0a84ff, // accent blue — 그리드
  none: 0x1d1d1f,
};
const TARGET_PX = 4.5; // 화면상 반경(px)

export function createSnapMarker(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false }),
  );
  m.renderOrder = 4; // depthTest:false → 항상 위에 뜨되 순서 안정
  m.visible = false;
  return m;
}

/** 마커를 스냅점에 배치·색·화면상수 크기. mmPerPixel = mm/px(info.mmPerPixel), elevM = 배치 높이(m). */
export function updateSnapMarker(marker: THREE.Mesh, snap: SnapResult, mmPerPixel: number, elevM: number): void {
  marker.visible = true;
  marker.position.set(snap.point[0] / 1000, elevM + 0.02, snap.point[1] / 1000);
  marker.scale.setScalar(Math.max((TARGET_PX * mmPerPixel) / 1000, 0.004)); // 화면상수(mm/px→m/px=/1000), 4mm 하한
  (marker.material as THREE.MeshBasicMaterial).color.setHex(MARKER_COLORS[snap.kind]);
}

/** 3D 피처 스냅(refSnap) 마커 색 — vertex=연결점 주황(endpoint 동일 의미), edge=그리드 파랑, face=흰. */
export const REF_MARKER_COLORS: Record<'vertex' | 'edge' | 'face', number> = {
  vertex: 0xff9500,
  edge: 0x0a84ff,
  face: 0xffffff,
};

/** 3D 스냅점(월드 m) 마커 배치 — 평면용 updateSnapMarker와 동일 화면상수 공식, 높이 오프셋 없음. */
export function updateSnapMarker3d(
  marker: THREE.Mesh,
  world: THREE.Vector3,
  colorHex: number,
  mmPerPixel: number,
): void {
  marker.visible = true;
  marker.position.copy(world);
  marker.scale.setScalar(Math.max((TARGET_PX * mmPerPixel) / 1000, 0.004));
  (marker.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
}
