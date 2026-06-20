import type { DocStore, FederationSource, Id } from '@figcad/core';
import type { ReferenceLayer } from './ReferenceLayer';
import type { Extractor } from '../interop/federationExtract';

/**
 * Federation reconciler — 동기화된 `federation` 채널을 ReferenceLayer(로컬 메시)에 반영.
 *
 * **명령형 (React 아님 — 불변③)**: store 구독 → 채널 소스 vs ReferenceLayer 현재 키 diff →
 * add/remove/setVisible. 새 소스는 extractor(ref)로 비동기 페치 → 메시 로드.
 * 불변① 정합: 메시는 derive·store·Y.Doc 밖(ReferenceLayer 격리 채널), 채널엔 ref만.
 *
 * gen-guard로 stale 비동기 로드 차단(소스가 페치 중 제거/교체될 때). 로드 상태(loading/ready/error)는
 * **로컬**(동기화 안 함) — Navigator가 표시용으로 구독.
 */
export type SourceStatus = 'loading' | 'ready' | 'error';

interface LocalState {
  status: SourceStatus;
  ref: string;
  sourceType: FederationSource['sourceType']; // ref 같고 type만 바뀌어도 재로드(Codex #5)
  error?: string;
  gen: number;
}

export class FederationReconciler {
  private local = new Map<Id, LocalState>();
  private gen = 0;
  private lastSig = '';
  private listeners = new Set<() => void>();

  constructor(
    private store: DocStore,
    private ref: ReferenceLayer,
    private extractors: Partial<Record<FederationSource['sourceType'], Extractor>>,
  ) {
    this.store.observe(() => this.reconcile());
    this.reconcile();
  }

  /** 상태 변경 구독 (Navigator UI용 — Three.js 무접촉). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  statusOf(id: Id): SourceStatus | undefined {
    return this.local.get(id)?.status;
  }
  errorOf(id: Id): string | undefined {
    return this.local.get(id)?.error;
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** idempotent — 매 store 변경마다 안전하게 호출. */
  private reconcile(): void {
    const sources = this.store.listFederationSources();
    // 시그니처 early-out: federation 채널의 id·ref·visible만 의미. 요소 편집(드래그 20-30Hz)엔
    // 불변 → 매 틱 재할당·notify 낭비를 차단. 가시성 토글/추가/제거는 sig를 바꿔 통과시킨다.
    const sig = sources
      .map((s) => `${s.id}:${s.sourceType}:${s.ref}:${s.visible ? 1 : 0}`)
      .sort()
      .join('|');
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    const ids = new Set(sources.map((s) => s.id));

    // 제거된 소스: ReferenceLayer 메시 unload + 로컬 상태 정리.
    for (const name of this.ref.list()) if (!ids.has(name)) this.ref.remove(name);
    // ref.list()는 'ready'만 담는다 — error/loading 중 제거된 소스의 로컬 엔트리도 직접 정리(누수 방지).
    for (const id of [...this.local.keys()]) if (!ids.has(id)) this.local.delete(id);

    for (const s of sources) {
      const st = this.local.get(s.id);
      if (!st || st.ref !== s.ref || st.sourceType !== s.sourceType) {
        // 신규 또는 ref/sourceType 변경 → (재)로드 (Codex #5)
        this.load(s);
      } else if (st.status === 'ready') {
        // 가시성은 동기화 상태 따라감
        this.ref.setVisible(s.id, s.visible);
      }
    }
    this.notify();
  }

  private load(s: FederationSource): void {
    const myGen = ++this.gen;
    this.local.set(s.id, { status: 'loading', ref: s.ref, sourceType: s.sourceType, gen: myGen });
    const extractor = this.extractors[s.sourceType];
    if (!extractor) {
      // 미등록 sourceType (.3dm·3D-Tiles = v1.5)
      this.local.set(s.id, {
        status: 'error',
        ref: s.ref,
        sourceType: s.sourceType,
        error: `${s.sourceType} 소스는 아직 지원 안 함 (v1.5)`,
        gen: myGen,
      });
      return;
    }
    extractor(s.ref)
      .then((meshes) => {
        const cur = this.local.get(s.id);
        if (!cur || cur.gen !== myGen) return; // stale: 로드 중 제거/교체됨
        const live = this.store.getFederationSource(s.id);
        if (!live) return; // 로드 끝났는데 소스 사라짐
        // projectOrigin recenter 보정: 네이티브가 -origin 됐으면 원좌표 오버레이도 -origin(월드 미터).
        // 월드맵: doc[x,y]mm → world[x*.001, _, y*.001]. origin[x,y]mm → offset [-x*.001, 0, -y*.001].
        const o = this.store.getProjectOrigin();
        const offset: [number, number, number] | undefined = o ? [-o[0] / 1000, 0, -o[1] / 1000] : undefined;
        this.ref.add(s.id, meshes, offset);
        this.ref.setVisible(s.id, live.visible);
        this.local.set(s.id, { status: 'ready', ref: s.ref, sourceType: s.sourceType, gen: myGen });
        this.notify();
      })
      .catch((err: unknown) => {
        const cur = this.local.get(s.id);
        if (!cur || cur.gen !== myGen) return;
        this.local.set(s.id, {
          status: 'error',
          ref: s.ref,
          sourceType: s.sourceType,
          error: err instanceof Error ? err.message : String(err),
          gen: myGen,
        });
        this.notify();
      });
  }
}
