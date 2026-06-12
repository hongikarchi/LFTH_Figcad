import { deriveWall, wallDeriveKey, type DerivedGeometry } from './deriveWall';
import type { DocStore } from '../store';
import type { Id, WallDeriveInput, WallElement, WallType } from '../schema';

export * from './meshBuilder';
export * from './deriveWall';

interface CacheEntry {
  key: string;
  geo: DerivedGeometry;
}

/**
 * 파생 디스패치 + 해시 메모이즈 캐시.
 * 파라미터가 안 바뀐 요소는 절대 재파생하지 않는다 (원격 업데이트 폭주 대비).
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
      const input: WallDeriveInput = {
        wall: el as WallElement,
        type: type as WallType,
        level,
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
