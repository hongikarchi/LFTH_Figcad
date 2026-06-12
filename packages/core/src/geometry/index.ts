import { deriveWall, wallDeriveKey, type DerivedGeometry } from './deriveWall';
import {
  deriveGrid,
  deriveOpening,
  deriveSlab,
  gridDeriveKey,
  openingDeriveKey,
  slabDeriveKey,
} from './deriveOthers';
import type { JoinInfo } from './joins';
import type { DocStore } from '../store';
import type {
  Id,
  OpeningElement,
  OpeningType,
  Pt,
  SlabType,
  WallDeriveInput,
  WallElement,
  WallType,
} from '../schema';

export * from './meshBuilder';
export * from './deriveWall';
export * from './deriveOthers';
export * from './joins';

interface CacheEntry {
  key: string;
  geo: DerivedGeometry;
}

const ptEq = (p: Pt, q: Pt): boolean => p[0] === q[0] && p[1] === q[1];

/**
 * 끝점 p를 공유하는 이웃 벽이 정확히 1개면 JoinInfo (Revit식 L자 자동 결합).
 * 0개(자유 끝) 또는 2개 이상(교차점 복잡) → null = butt 캡.
 */
function findJoin(store: DocStore, wall: WallElement, p: Pt): JoinInfo | null {
  let found: JoinInfo | null = null;
  for (const el of store.listElements()) {
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
): { el: OpeningElement; type: OpeningType }[] {
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

  derive(store: DocStore, id: Id): DerivedGeometry | null {
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
        joins: { a: findJoin(store, el, el.a), b: findJoin(store, el, el.b) },
        openings: hostedOpenings(store, el.id),
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
