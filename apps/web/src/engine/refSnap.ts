import * as THREE from 'three';
import { raycastHit, worldToScreen } from './Picker';
import { refObjectInfoAt, type RefObjectInfo } from './refIdentity';

/**
 * 3D 피처 스냅 (꼭짓점 > 에지 > 면) — 측정·지시선이 임포트/네이티브 메시의 모서리를 정확히 집게 한다.
 *
 * 비인덱스 삼각형 소프에서 히트 삼각형의 3정점만 검사해도 모서리 스냅에 충분하다:
 * 커서가 보이는 모서리 근처(≤snapPx)면 레이는 그 모서리에 인접한 삼각형을 맞히고,
 * 그 삼각형 자신이 좌표 동일한 모서리 정점 복제를 갖는다 — 인접구조/공간 인덱스 불필요.
 * (한계: 실루엣 밖 커서=레이 미스=스냅 없음(표면 스냅 의미론, Rhino OSnap-on-mesh 동일) ·
 *  T-정점 접합은 작은 삼각형 hover 시만 — 테셀 출력에선 드묾.)
 *
 * per-move 힙: 모듈 스크래치 Vector3 재사용 — 결과 point도 스크래치라 **소비자는 반드시 clone/copy**.
 */

export type RefSnapKind = 'vertex' | 'edge' | 'face';

export interface RefSnapResult {
  /** 월드 m — 모듈 스크래치 재사용. 소비자는 반드시 clone()/copy(). */
  point: THREE.Vector3;
  kind: RefSnapKind;
  /** 임포트 객체 식별 (네이티브 메시 히트 = null) */
  info: RefObjectInfo | null;
}

// 모듈 스크래치 — per-move 할당 0 (worldToScreen의 작은 {x,y,z} 3개는 pointermove-rate라 허용).
const triW = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const outPoint = new THREE.Vector3();
const viewV = new THREE.Vector3();
const result: RefSnapResult = { point: outPoint, kind: 'face', info: null };
const sx = [0, 0, 0];
const sy = [0, 0, 0];
const sOk = [false, false, false];

/**
 * 화면 좌표 → 히트 표면의 스냅점. snapPx = 화면 픽셀 톨러런스(기존 SNAP_PX=12 관례). 히트 없으면 null.
 * 우선순위: 히트 삼각형 꼭짓점(≤snapPx) > 에지 최근접점(≤snapPx) > 면 히트점.
 */
export function refSnapAt(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  roots: THREE.Object3D[],
  snapPx: number,
): RefSnapResult | null {
  // skipAnnotation — 주석 픽 프록시(투명 리본)의 보이지 않는 모서리에 스냅하지 않도록 통과시킨다.
  const hit = raycastHit(clientX, clientY, camera, roots, true);
  if (!hit) return null;
  const face = hit.faceIndex ?? undefined; // three 타입은 number|null|undefined — 정규화
  result.info = refObjectInfoAt(hit.object, face);

  const geo = (hit.object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  const pos = geo?.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (face === undefined || !pos) {
    outPoint.copy(hit.point);
    result.kind = 'face';
    return result;
  }

  // 히트 삼각형 3정점 — 인덱스/비인덱스 둘 다. matrixWorld가 -projectOrigin/TRS까지 포함.
  const idx = geo!.index;
  for (let n = 0; n < 3; n++) {
    const i = idx ? idx.getX(face * 3 + n) : face * 3 + n;
    triW[n]!.fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld);
    const s = worldToScreen(triW[n]!, camera);
    sx[n] = s.x;
    sy[n] = s.y;
    sOk[n] = Math.abs(s.z) <= 1; // 카메라 뒤/절두체 밖 = 미러 스냅 방지
  }

  // 1) 꼭짓점 스냅 (최우선)
  let bestV = -1;
  let bestVD = snapPx;
  for (let n = 0; n < 3; n++) {
    if (!sOk[n]) continue;
    const d = Math.hypot(sx[n]! - clientX, sy[n]! - clientY);
    if (d <= bestVD) {
      bestVD = d;
      bestV = n;
    }
  }
  if (bestV >= 0) {
    outPoint.copy(triW[bestV]!);
    result.kind = 'vertex';
    return result;
  }

  // 2) 에지 스냅 — 스크린 공간에서 커서를 에지에 투영한 t를 구한 뒤, 월드 파라미터로는
  // **원근 보정** 재매핑해 적용: u = t·w0 / ((1−t)·w1 + t·w0), wi = 뷰공간 깊이(−viewZ).
  // 스크린 t를 그대로 월드 lerp에 쓰면 깊이로 물러나는 긴 에지에서 커서와 수 m 어긋난다
  // (스크린 보간 ≠ 월드 보간 — 원근 분모. 직교 카메라는 affine이라 u = t 그대로).
  let bestE = -1;
  let bestET = 0;
  let bestED = snapPx;
  for (let n = 0; n < 3; n++) {
    const m = (n + 1) % 3;
    if (!sOk[n] || !sOk[m]) continue;
    const ex = sx[m]! - sx[n]!;
    const ey = sy[m]! - sy[n]!;
    const len2 = ex * ex + ey * ey;
    if (len2 < 1e-6) continue;
    const t = Math.min(1, Math.max(0, ((clientX - sx[n]!) * ex + (clientY - sy[n]!) * ey) / len2));
    const d = Math.hypot(sx[n]! + ex * t - clientX, sy[n]! + ey * t - clientY);
    if (d <= bestED) {
      bestED = d;
      bestE = n;
      bestET = t;
    }
  }
  if (bestE >= 0) {
    const a = triW[bestE]!;
    const b = triW[(bestE + 1) % 3]!;
    let u = bestET;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const w0 = Math.max(1e-6, -viewV.copy(a).applyMatrix4(camera.matrixWorldInverse).z);
      const w1 = Math.max(1e-6, -viewV.copy(b).applyMatrix4(camera.matrixWorldInverse).z);
      u = (bestET * w0) / ((1 - bestET) * w1 + bestET * w0);
    }
    outPoint.copy(a).lerp(b, u);
    result.kind = 'edge';
    return result;
  }

  // 3) 면 히트점
  outPoint.copy(hit.point);
  result.kind = 'face';
  return result;
}
