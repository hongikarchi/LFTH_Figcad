import { deriveWall, wallDeriveKey, type DerivedGeometry } from './deriveWall';
import type { JoinInfo } from './joins';
import type { DocStore } from '../store';
import type { Id, Pt, WallDeriveInput, WallElement, WallType } from '../schema';

export * from './meshBuilder';
export * from './deriveWall';
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

/**
 * 파생 디스패치 + 해시 메모이즈 캐시.
 * 키에 조인(이웃) 정보가 포함되므로 이웃이 움직이면 키가 바뀌어 자동 재파생 —
 * 호출자는 변경 시 모든 벽에 derive를 다시 요청해도 안전하다 (불변이면 캐시 히트).
 */
export class DeriveCache {
  private cache = new Map<Id, CacheEntry>();

  derive(store: DocStore, id: Id): DerivedGeometry | null {
    const el = store.getElement(id);
    if (!el) {
      this.cache.delete(id);
      return null;
    }
    if (el.kind === 'wall') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (!type || type.kind !== 'wall' || !level) return null;
      const wall = el as WallElement;
      const input: WallDeriveInput = {
        wall,
        type: type as WallType,
        level,
        joins: {
          a: findJoin(store, wall, wall.a),
          b: findJoin(store, wall, wall.b),
        },
      };
      const key = wallDeriveKey(input);
      const hit = this.cache.get(id);
      if (hit && hit.key === key) return hit.geo;
      const geo = deriveWall(input);
      this.cache.set(id, { key, geo });
      return geo;
    }
    return null;
  }

  evict(id: Id): void {
    this.cache.delete(id);
  }
}
