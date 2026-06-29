import * as THREE from 'three';
import type { DocStore, Element, Footprint, Pt } from '@figcad/core';
import { worldToScreen } from '../engine/Picker';

/** 요소가 놓인 고도(mm) — 박스선택 투영용. opening은 호스트 레벨, grid는 0. */
export function elevationOf(el: Element, store: DocStore): number {
  if (el.kind === 'grid') return 0;
  if (el.kind === 'opening') {
    const host = store.getElement(el.hostId);
    const lv = host && 'levelId' in host ? store.getLevel(host.levelId) : undefined;
    return lv?.elevation ?? 0;
  }
  return store.getLevel(el.levelId)?.elevation ?? 0;
}

/** 요소 풋프린트(문서 mm)를 화면 px 풋프린트로 투영 (박스선택 window/crossing 판정용). */
export function projectFootprint(
  fp: Footprint,
  el: Element,
  camera: THREE.Camera,
  store: DocStore,
): Footprint {
  if (!fp) return null;
  const elevMm = elevationOf(el, store);
  // 카메라 뒤(절두체 밖) 점은 project()가 미러 좌표 반환 → 박스선택 오판. 하나라도 |z|>1이면 비선택(null).
  let behind = false;
  const toScreen = (p: Pt): Pt => {
    const s = worldToScreen(new THREE.Vector3(p[0] / 1000, elevMm / 1000, p[1] / 1000), camera);
    if (s.z < -1 || s.z > 1) behind = true;
    return [s.x, s.y];
  };
  if (fp.kind === 'point') { const p = toScreen(fp.p); return behind ? null : { kind: 'point', p }; }
  if (fp.kind === 'segment') { const a = toScreen(fp.a); const b = toScreen(fp.b); return behind ? null : { kind: 'segment', a, b }; }
  const pts = fp.pts.map(toScreen);
  return behind ? null : { kind: 'polygon', pts };
}
