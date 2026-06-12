import { nanoid } from 'nanoid';
import {
  CORE_SCHEMA_VERSION,
  ElementSchema,
  quantize,
  type DocMeta,
  type Element,
  type ElemType,
  type Id,
  type Level,
  type Pt,
  type WallElement,
} from './schema';

export interface DocChange {
  added: Id[];
  updated: Id[];
  removed: Id[];
}

export type DocObserver = (change: DocChange) => void;

/**
 * 문서 스토어 — 앱 코드가 문서를 만지는 유일한 표면 (불변 규칙 2).
 * M1: 메모리 Map + 이벤트. M2: 내부를 Y.Doc으로 스왑하되 이 API는 불변.
 * 모든 좌표 입력은 여기서 mm 정수로 양자화된다.
 */
export class DocStore {
  readonly meta: DocMeta = {
    schemaVersion: CORE_SCHEMA_VERSION,
    projectName: '새 프로젝트',
    units: 'mm',
  };

  private levels = new Map<Id, Level>();
  private types = new Map<Id, ElemType>();
  private elements = new Map<Id, Element>();
  private observers = new Set<DocObserver>();

  // --- 조회 ---

  getLevel(id: Id): Level | undefined {
    return this.levels.get(id);
  }
  getType(id: Id): ElemType | undefined {
    return this.types.get(id);
  }
  getElement(id: Id): Element | undefined {
    return this.elements.get(id);
  }
  listLevels(): Level[] {
    return [...this.levels.values()].sort((a, b) => a.order - b.order);
  }
  listTypes(kind?: ElemType['kind']): ElemType[] {
    const all = [...this.types.values()];
    return kind ? all.filter((t) => t.kind === kind) : all;
  }
  listElements(): Element[] {
    return [...this.elements.values()];
  }
  /** 벽 끝점 목록 — 스냅 후보 */
  wallEndpoints(levelId: Id, exclude?: Id): Pt[] {
    const pts: Pt[] = [];
    for (const el of this.elements.values()) {
      if (el.kind !== 'wall' || el.levelId !== levelId || el.id === exclude) continue;
      pts.push(el.a, el.b);
    }
    return pts;
  }

  // --- ops (변경은 전부 여기) ---

  addLevel(level: Omit<Level, 'id'>): Id {
    const id = nanoid(12);
    this.levels.set(id, { ...level, id });
    return id;
  }

  addType(type: Omit<ElemType, 'id'>): Id {
    const id = nanoid(12);
    this.types.set(id, { ...type, id } as ElemType);
    return id;
  }

  createWall(params: {
    levelId: Id;
    typeId: Id;
    a: Pt;
    b: Pt;
    height?: number;
    baseOffset?: number;
  }): Id {
    const id = nanoid(12);
    const wall: WallElement = ElementSchema.parse({
      id,
      kind: 'wall',
      levelId: params.levelId,
      typeId: params.typeId,
      a: [quantize(params.a[0]), quantize(params.a[1])],
      b: [quantize(params.b[0]), quantize(params.b[1])],
      ...(params.height !== undefined ? { height: quantize(params.height) } : {}),
      ...(params.baseOffset !== undefined ? { baseOffset: quantize(params.baseOffset) } : {}),
    }) as WallElement;
    this.elements.set(id, wall);
    this.emit({ added: [id], updated: [], removed: [] });
    return id;
  }

  updateElement(id: Id, patch: Partial<Omit<WallElement, 'id' | 'kind'>>): void {
    const prev = this.elements.get(id);
    if (!prev) return;
    const next = { ...prev, ...patch } as Element;
    // 좌표·치수 양자화
    if (next.kind === 'wall') {
      next.a = [quantize(next.a[0]), quantize(next.a[1])];
      next.b = [quantize(next.b[0]), quantize(next.b[1])];
      if (next.height !== undefined) next.height = quantize(next.height);
      if (next.baseOffset !== undefined) next.baseOffset = quantize(next.baseOffset);
    }
    this.elements.set(id, ElementSchema.parse(next) as Element);
    this.emit({ added: [], updated: [id], removed: [] });
  }

  deleteElements(ids: Id[]): void {
    const removed: Id[] = [];
    for (const id of ids) {
      if (this.elements.delete(id)) removed.push(id);
      // M3: 호스트된 개구부 연쇄 삭제가 여기 추가된다
    }
    if (removed.length) this.emit({ added: [], updated: [], removed });
  }

  // --- 구독 ---

  observe(cb: DocObserver): () => void {
    this.observers.add(cb);
    return () => this.observers.delete(cb);
  }

  private emit(change: DocChange): void {
    for (const cb of this.observers) cb(change);
  }
}

/** m001: 새 문서 시드 — 기본 레벨 + 빌트인 벽 타입 */
export function seedDocument(store: DocStore): { levelId: Id; wallTypeIds: Id[] } {
  const levelId = store.addLevel({ name: '1층', elevation: 0, height: 3000, order: 0 });
  const w200 = store.addType({
    kind: 'wall',
    name: '콘크리트벽 200',
    thickness: 200,
    color: '#d8d2c4',
  });
  const w100 = store.addType({
    kind: 'wall',
    name: '칸막이벽 100',
    thickness: 100,
    color: '#e8e4da',
  });
  return { levelId, wallTypeIds: [w200, w100] };
}
