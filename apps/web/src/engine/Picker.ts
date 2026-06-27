import * as THREE from 'three';
import type { Pt } from '@figcad/core';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();

/** 화면 좌표 → 지면 평면(레벨 elevation, m) 교차점 → 문서 mm 좌표 */
export function screenToDoc(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  elevationM: number,
): Pt | null {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  plane.set(new THREE.Vector3(0, 1, 0), -elevationM);
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  return [hit.x * 1000, hit.z * 1000];
}

/** 화면 좌표로 요소 메시 픽킹 → elementId */
export function pickElement(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  meshes: THREE.Object3D[],
): string | null {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(meshes, false);
  // 주석(치수·레이블·텍스트·그리드) 픽 프록시 우선 — 평면 top-down서 슬라브 윗면이 주석 프록시보다
  // 높아 레이가 솔리드를 먼저 맞히면 주석이 안 잡히던 문제(iter-2 3). 주석 프록시는 작아서 그 위에
  // 커서가 있을 때만 맞으므로, 맞았다면 사용자가 그 주석을 가리킨 것 → 우선 선택.
  let firstId: string | null = null;
  for (const h of hits) {
    const id = h.object.userData['elementId'];
    if (typeof id !== 'string') continue;
    if (h.object.userData['annotation']) return id;
    if (firstId === null) firstId = id;
  }
  return firstId;
}

/**
 * 화면 좌표 → 임의 평면(origin·normal, 월드 m) 교차점 (자유 3D 스케치 — iter-3 S4).
 * 평면 법선=카메라 시선이면 레이가 수직이라 그레이징 불안정 없음.
 */
export function screenToWorldPlane(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  origin: THREE.Vector3,
  normal: THREE.Vector3,
): THREE.Vector3 | null {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  plane.setFromNormalAndCoplanarPoint(normal, origin);
  const out = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, out) ? out : null;
}

/** 월드(m) → 화면 px (HUD 배치용) */
export function worldToScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
): { x: number; y: number } {
  const v = world.clone().project(camera);
  return {
    x: ((v.x + 1) / 2) * window.innerWidth,
    y: ((1 - v.y) / 2) * window.innerHeight,
  };
}
