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
  const toScreen = (p: Pt): Pt => {
    const s = worldToScreen(new THREE.Vector3(p[0] / 1000, elevMm / 1000, p[1] / 1000), camera);
    return [s.x, s.y];
  };
  if (fp.kind === 'point') return { kind: 'point', p: toScreen(fp.p) };
  if (fp.kind === 'segment') return { kind: 'segment', a: toScreen(fp.a), b: toScreen(fp.b) };
  return { kind: 'polygon', pts: fp.pts.map(toScreen) };
}
