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
  for (const h of hits) {
    const id = h.object.userData['elementId'];
    if (typeof id === 'string') return id;
  }
  return null;
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
