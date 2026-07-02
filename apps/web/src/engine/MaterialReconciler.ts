import type { DocStore } from '@figcad/core';
import type { ReferenceLayer } from './ReferenceLayer';

/**
 * 재질 오버라이드 reconciler — 'materials' 채널 변경 → ReferenceLayer 재질 재적용.
 * FederationReconciler와 동일 패턴: store.observe(비요소 채널 = 빈-change notifyAll 포함) +
 * signature 조기탈출 — 요소 드래그 20-30Hz 통지에 불변(재적용은 오버라이드가 실제 바뀔 때만).
 * 리로드/projectOrigin 재-add 경로는 ReferenceLayer.add()가 스스로 재적용(provider 주입) —
 * reconciler와 순서 결합 없음. 고아 오버라이드(미로드 소스)는 list()에 없어 자연 스킵.
 */
export class MaterialReconciler {
  private lastSig = '';

  constructor(
    private store: DocStore,
    private ref: ReferenceLayer,
  ) {
    ref.setOverrideProvider((sourceId) => store.listMaterialOverrides(sourceId));
    store.observe(() => this.reconcile());
    this.reconcile();
  }

  private reconcile(): void {
    const sig = this.store
      .listMaterialOverrides()
      .map((m) => `${m.id}:${m.color}:${m.opacity}`)
      .sort()
      .join('|');
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    for (const name of this.ref.list()) this.ref.applyMaterialOverrides(name);
  }
}
