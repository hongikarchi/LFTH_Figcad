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
  error?: string;
  gen: number;
}

export class FederationReconciler {
  private local = new Map<Id, LocalState>();
  private gen = 0;
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
    const ids = new Set(sources.map((s) => s.id));

    // 제거된 소스: ReferenceLayer에서 unload
    for (const name of this.ref.list()) {
      if (!ids.has(name)) {
        this.ref.remove(name);
        this.local.delete(name);
      }
    }

    for (const s of sources) {
      const st = this.local.get(s.id);
      if (!st || st.ref !== s.ref) {
        // 신규 또는 ref 변경 → (재)로드
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
    this.local.set(s.id, { status: 'loading', ref: s.ref, gen: myGen });
    const extractor = this.extractors[s.sourceType];
    if (!extractor) {
      // 미등록 sourceType (glTF·IFC·.3dm·3D-Tiles = A5/v1.5)
      this.local.set(s.id, {
        status: 'error',
        ref: s.ref,
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
        this.ref.add(s.id, meshes);
        this.ref.setVisible(s.id, live.visible);
        this.local.set(s.id, { status: 'ready', ref: s.ref, gen: myGen });
        this.notify();
      })
      .catch((err: unknown) => {
        const cur = this.local.get(s.id);
        if (!cur || cur.gen !== myGen) return;
        this.local.set(s.id, {
          status: 'error',
          ref: s.ref,
          error: err instanceof Error ? err.message : String(err),
          gen: myGen,
        });
        this.notify();
      });
  }
}
