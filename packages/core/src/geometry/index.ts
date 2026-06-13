import { deriveWall, wallDeriveKey, type DerivedGeometry } from './deriveWall';
import {
  deriveGrid,
  deriveOpening,
  deriveSlab,
  gridDeriveKey,
  openingDeriveKey,
  slabDeriveKey,
} from './deriveOthers';
import {
  beamDeriveKey,
  columnDeriveKey,
  deriveBeam,
  deriveColumn,
  deriveRailing,
  deriveRoof,
  deriveStair,
  railingDeriveKey,
  roofDeriveKey,
  stairDeriveKey,
} from './deriveStructure';
import {
  deriveDimension,
  deriveText,
  dimensionDeriveKey,
  textDeriveKey,
} from './deriveAnnotations';
import { resolveDimAnchor } from '../select';
import type { JoinInfo } from './joins';
import type { DocStore } from '../store';
import type {
  BeamType,
  ColumnType,
  Id,
  OpeningElement,
  OpeningType,
  Pt,
  RailingType,
  RoofType,
  SlabType,
  StairType,
  WallDeriveInput,
  WallElement,
  WallType,
} from '../schema';

export * from './meshBuilder';
export * from './deriveWall';
export * from './deriveOthers';
export * from './deriveStructure';
export * from './deriveAnnotations';
export * from './joins';

interface CacheEntry {
  key: string;
  geo: DerivedGeometry;
}

const ptEq = (p: Pt, q: Pt): boolean => p[0] === q[0] && p[1] === q[1];

/**
 * 파생 의존 인덱스 — 문서 변경당 1회 O(n)으로 구축해 derive 호출들이 공유.
 * 없으면 derive가 요소마다 전체 스캔(findJoin×2 + 개구부 조회)을 해서
 * 변경당 O(n²)이 된다 (2K 벽 실측: 변경당 ~30ms → 인덱스로 ~1ms).
 */
export interface DeriveIndex {
  /** `${levelId}:${x},${y}` → 그 끝점을 갖는 벽들 */
  joints: Map<string, WallElement[]>;
  /** 호스트 벽 id → 호스트된 개구부(타입 포함) */
  openingsByHost: Map<Id, { el: OpeningElement; type: OpeningType }[]>;
}

export function buildDeriveIndex(store: DocStore): DeriveIndex {
  const joints = new Map<string, WallElement[]>();
  const openingsByHost = new Map<Id, { el: OpeningElement; type: OpeningType }[]>();
  for (const el of store.listElements()) {
    if (el.kind === 'wall') {
      for (const p of [el.a, el.b]) {
        const k = `${el.levelId}:${p[0]},${p[1]}`;
        const list = joints.get(k);
        if (list) list.push(el);
        else joints.set(k, [el]);
      }
    } else if (el.kind === 'opening') {
      const type = store.getType(el.typeId);
      if (type?.kind !== 'opening') continue;
      const list = openingsByHost.get(el.hostId);
      const item = { el, type: type as OpeningType };
      if (list) list.push(item);
      else openingsByHost.set(el.hostId, [item]);
    }
  }
  return { joints, openingsByHost };
}

/**
 * 끝점 p를 공유하는 이웃 벽이 정확히 1개면 JoinInfo (Revit식 L자 자동 결합).
 * 0개(자유 끝) 또는 2개 이상(교차점 복잡) → null = butt 캡.
 */
function findJoin(
  store: DocStore,
  wall: WallElement,
  p: Pt,
  index?: DeriveIndex,
): JoinInfo | null {
  const candidates = index
    ? (index.joints.get(`${wall.levelId}:${p[0]},${p[1]}`) ?? [])
    : store.listElements();
  let found: JoinInfo | null = null;
  for (const el of candidates) {
    if (el.kind !== 'wall' || el.id === wall.id || el.levelId !== wall.levelId) continue;
    let other: Pt | null = null;
    if (ptEq(el.a, p)) other = el.b;
    else if (ptEq(el.b, p)) other = el.a;
    if (!other) continue;
    if (found) return null; // 3개 이상 → butt
    const len = Math.hypot(other[0] - p[0], other[1] - p[1]);
    if (len === 0) continue;
    const type = store.getType(el.typeId);
    if (!type || type.kind !== 'wall') continue;
    found = {
      dir: [(other[0] - p[0]) / len, (other[1] - p[1]) / len],
      thickness: type.thickness,
    };
  }
  return found;
}

/** 벽에 호스트된 개구부 목록 (타입 포함) */
function hostedOpenings(
  store: DocStore,
  wallId: Id,
  index?: DeriveIndex,
): { el: OpeningElement; type: OpeningType }[] {
  if (index) return index.openingsByHost.get(wallId) ?? [];
  const out: { el: OpeningElement; type: OpeningType }[] = [];
  for (const el of store.listElements()) {
    if (el.kind !== 'opening' || el.hostId !== wallId) continue;
    const type = store.getType(el.typeId);
    if (type?.kind === 'opening') out.push({ el, type });
  }
  return out;
}

/**
 * 파생 디스패치 + 해시 메모이즈 캐시.
 * 키에 의존 요소(조인 이웃, 호스트 벽, 호스트된 개구부)가 포함되므로
 * 의존이 바뀌면 키가 바뀌어 자동 재파생 — 호출자는 변경 시 전체에 derive를
 * 다시 요청해도 안전 (불변이면 캐시 히트로 같은 geo 객체 반환).
 */
export class DeriveCache {
  private cache = new Map<Id, CacheEntry>();

  derive(store: DocStore, id: Id, index?: DeriveIndex): DerivedGeometry | null {
    const el = store.getElement(id);
    if (!el) {
      this.cache.delete(id);
      return null;
    }

    let key: string | null = null;
    let compute: (() => DerivedGeometry) | null = null;

    if (el.kind === 'wall') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'wall' || !level) return null;
      const input: WallDeriveInput = {
        wall: el,
        type: type as WallType,
        level,
        joins: { a: findJoin(store, el, el.a, index), b: findJoin(store, el, el.b, index) },
        openings: hostedOpenings(store, el.id, index),
      };
      key = `w:${wallDeriveKey(input)}`;
      compute = () => deriveWall(input);
    } else if (el.kind === 'opening') {
      const type = store.getType(el.typeId);
      const host = store.getElement(el.hostId);
      if (type?.kind !== 'opening' || host?.kind !== 'wall') return null;
      const hostType = store.getType(host.typeId);
      const level = store.getLevel(host.levelId);
      if (hostType?.kind !== 'wall' || !level) return null;
      const input = {
        opening: el,
        type: type as OpeningType,
        host,
        hostType: hostType as WallType,
        level,
      };
      key = `o:${openingDeriveKey(input)}`;
      compute = () => deriveOpening(input);
    } else if (el.kind === 'slab') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'slab' || !level) return null;
      const input = { slab: el, type: type as SlabType, level };
      key = `s:${slabDeriveKey(input)}`;
      compute = () => deriveSlab(input);
    } else if (el.kind === 'grid') {
      key = `g:${gridDeriveKey(el)}`;
      compute = () => deriveGrid(el);
    } else if (el.kind === 'column') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'column' || !level) return null;
      const input = { column: el, type: type as ColumnType, level };
      key = `c:${columnDeriveKey(input)}`;
      compute = () => deriveColumn(input);
    } else if (el.kind === 'beam') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'beam' || !level) return null;
      const input = { beam: el, type: type as BeamType, level };
      key = `b:${beamDeriveKey(input)}`;
      compute = () => deriveBeam(input);
    } else if (el.kind === 'stair') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'stair' || !level) return null;
      const input = { stair: el, type: type as StairType, level };
      key = `st:${stairDeriveKey(input)}`;
      compute = () => deriveStair(input);
    } else if (el.kind === 'railing') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'railing' || !level) return null;
      const input = { railing: el, type: type as RailingType, level };
      key = `rl:${railingDeriveKey(input)}`;
      compute = () => deriveRailing(input);
    } else if (el.kind === 'roof') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'roof' || !level) return null;
      const input = { roof: el, type: type as RoofType, level };
      key = `rf:${roofDeriveKey(input)}`;
      compute = () => deriveRoof(input);
    } else if (el.kind === 'text') {
      const level = store.getLevel(el.levelId);
      if (!level) return null;
      const input = { text: el, level };
      key = `txt:${textDeriveKey(input)}`;
      compute = () => deriveText(input);
    } else if (el.kind === 'dimension') {
      const level = store.getLevel(el.levelId);
      if (!level) return null;
      // 바인딩 해석: 참조 요소의 끝점(params)을 읽어 a/b 결정. 고아면 stored fallback.
      const a = resolveDimAnchor(store, el.bindA, el.a);
      const b = resolveDimAnchor(store, el.bindB, el.b);
      const input = { dim: el, level, a, b };
      key = `dim:${dimensionDeriveKey(input)}`;
      compute = () => deriveDimension(input);
    }

    if (!key || !compute) return null;
    const hit = this.cache.get(id);
    if (hit && hit.key === key) return hit.geo;
    const geo = compute();
    this.cache.set(id, { key, geo });
    return geo;
  }

  evict(id: Id): void {
    this.cache.delete(id);
  }
}
