import * as THREE from 'three';
import type { Pt } from '@figcad/core';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();
const wtsScratch = new THREE.Vector3(); // worldToScreen 재사용(프레임 루프 할당 0 — HUD 재투영 핫패스)

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
 * 화면 좌표 → 주어진 루트들 최근접 **솔리드 면** Intersection 전체 (faceIndex·object 포함). 없으면 null.
 * raycastPoint와 동일 규칙(Line threshold 0·조상 가시성 필터·Mesh만) — refSnap(임포트 피처 스냅)용.
 */
export function raycastHit(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  roots: THREE.Object3D[],
  skipAnnotation = false,
): THREE.Intersection | null {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const savedLine = raycaster.params.Line?.threshold;
  if (raycaster.params.Line) raycaster.params.Line.threshold = 0; // 와이어 굵은 히트 차단
  const hits = raycaster.intersectObjects(roots, true); // recursive — 그룹 순회
  if (raycaster.params.Line && savedLine !== undefined) raycaster.params.Line.threshold = savedLine;
  // three intersect는 .visible 무시 → 숨긴 오버레이를 뚫고 맞히면 틀린 점. 조상 체인 가시성으로 거른다(Codex 리뷰).
  const isVisible = (o: THREE.Object3D): boolean => {
    for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  };
  // skipAnnotation: 주석 픽 프록시(투명 리본 — userData.annotation)는 통과해 뒤의 실지오메트리를 맞춘다
  // (피처 스냅이 보이지 않는 프록시 모서리에 붙는 것 방지 — refSnap 전용, 코멘트 raycastPoint는 기존 유지).
  return (
    hits.find(
      (h) =>
        (h.object as THREE.Mesh).isMesh &&
        isVisible(h.object) &&
        (!skipAnnotation || !h.object.userData['annotation']),
    ) ?? null
  ); // 솔리드·보이는 면만
}

/**
 * 화면 좌표 → 주어진 루트들(오버레이 그룹·요소 메시) 최근접 **솔리드 면** 3D 교차점(월드 m). 없으면 null. 3D 코멘트용.
 * Mesh만 채택 — 와이어 edge(Line, 기본 threshold 1m)·라벨 스프라이트 히트가 코멘트 z를 오염시키는 것 방지.
 */
export function raycastPoint(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  roots: THREE.Object3D[],
): THREE.Vector3 | null {
  return raycastHit(clientX, clientY, camera, roots)?.point.clone() ?? null;
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

/** 월드(m) → 화면 px (HUD 배치용). z = NDC 깊이 — |z|>1이면 절두체 밖(특히 카메라 뒤=미러 좌표). */
export function worldToScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
): { x: number; y: number; z: number } {
  const v = wtsScratch.copy(world).project(camera); // 결과는 즉시 숫자로 복사 → 스크래치 재사용 안전
  return {
    x: ((v.x + 1) / 2) * window.innerWidth,
    y: ((1 - v.y) / 2) * window.innerHeight,
    z: v.z,
  };
}
