import type { DocStore, FederationSource, Id } from '@figcad/core';
import type { DwgUnderlay } from '@figcad/interop/dwg-underlay';
import type { ReferenceLayer, UnderlayPlacement } from './ReferenceLayer';
import type { Extractor, UnderlayExtractor } from '../interop/federationExtract';

/** 2D 언더레이(빽도면) sourceType — 메시 아닌 라인워크 렌더 경로. */
const UNDERLAY_TYPES: ReadonlySet<FederationSource['sourceType']> = new Set(['dwg', 'dxf']);
/** 래스터 언더레이 sourceType — 이미지/PDF를 텍스처 평면으로 (iter-3 import 업그레이드). */
const RASTER_TYPES: ReadonlySet<FederationSource['sourceType']> = new Set(['image', 'pdf']);

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
  /** 언더레이: 파싱 결과 캐시 — 배치/클립만 바뀌면 재페치·재파싱 없이 재렌더(addUnderlay만). */
  underlay?: DwgUnderlay;
  /** 래스터(image/pdf): 디코드 결과 캐시 — 배치만 바뀌면 재페치·재디코드 없이 재렌더. */
  raster?: { source: ImageBitmap | HTMLCanvasElement; wMm: number; hMm: number };
  /** 마지막 적용한 배치(origin/rotation/scale/clip/opacity) 시그 — 변경 감지용. */
  placementSig?: string;
}

/** 언더레이 배치 시그(JSON) — clip/origin/rotation/scale/levelId 변경 감지. */
function placementSigOf(s: FederationSource): string {
  return JSON.stringify(s.underlay ?? null);
}

export class FederationReconciler {
  private local = new Map<Id, LocalState>();
  private gen = 0;
  private lastSig = '';
  private lastOrigin = ''; // projectOrigin 변경 감지 — 메시 오버레이 baked offset 재적용용
  private listeners = new Set<() => void>();

  constructor(
    private store: DocStore,
    private ref: ReferenceLayer,
    private extractors: Partial<Record<FederationSource['sourceType'], Extractor>>,
    private underlayExtractor?: UnderlayExtractor,
  ) {
    this.store.observe(() => this.reconcile());
    this.reconcile();
  }

  /** 상태 변경 구독 (Navigator UI용 — Three.js 무접촉). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * 최신 다시 가져오기 — 같은 ref를 강제 재추출(reconcile 시그 early-out 우회).
   * figcad-room = ?op=pull 최신 스냅샷 재페치(소스 룸이 갱신돼도 오버레이 동결 해소).
   * 파일 소스(image/dwg/3dm)는 content-hash blob이라 재페치=동일 — 새 버전은 재업로드(새 ref).
   */
  reload(id: Id): void {
    const s = this.store.getFederationSource(id);
    if (!s) return;
    this.ref.remove(id);
    this.local.delete(id);
    this.load(s); // gen 증가 + 재페치/재파싱 → ready 시 notify
    this.notify(); // loading 상태 즉시 반영
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
    // projectOrigin도 시그에 — 메시 오버레이 로드 후 origin이 바뀌면 baked offset이 스테일(미정합) → 재로드 강제.
    const origin = this.store.getProjectOrigin();
    const sig =
      `O:${origin ? `${origin[0]},${origin[1]}` : '0'}||` +
      sources
        // 언더레이 배치(placementSig)도 포함 — 클립/이동/회전/스케일 변경 시 reconcile 통과(재렌더).
        .map((s) => `${s.id}:${s.sourceType}:${s.ref}:${s.visible ? 1 : 0}:${placementSigOf(s)}`)
        .sort()
        .join('|');
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const originStr = origin ? `${origin[0]},${origin[1]}` : '0';
    const originChanged = originStr !== this.lastOrigin;
    this.lastOrigin = originStr;

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
        const isMesh = !UNDERLAY_TYPES.has(s.sourceType) && !RASTER_TYPES.has(s.sourceType);
        // origin 변경 + 메시 오버레이 = baked offset 스테일 → 재로드(재offset). 언더레이/래스터는 placement서 elevation만 써 무관.
        if (originChanged && isMesh) {
          this.load(s);
          continue;
        }
        // 언더레이/래스터 배치만 변경 → 캐시에서 재렌더(재페치·재파싱 없이). 그 외엔 가시성만 동기화.
        if (st.underlay && st.placementSig !== placementSigOf(s)) {
          this.reapplyUnderlay(s, st);
        } else if (st.raster && st.placementSig !== placementSigOf(s)) {
          this.placeRaster(s, st.raster);
          st.placementSig = placementSigOf(s);
        }
        this.ref.setVisible(s.id, s.visible);
      }
    }
    this.notify();
  }

  private load(s: FederationSource): void {
    const myGen = ++this.gen;
    this.local.set(s.id, { status: 'loading', ref: s.ref, sourceType: s.sourceType, gen: myGen });

    // 2D 언더레이(DWG/DXF) = 메시 아닌 라인워크 경로 — fetch+파싱 → 배치(레벨/origin/회전/스케일) → addUnderlay.
    if (UNDERLAY_TYPES.has(s.sourceType) && this.underlayExtractor) {
      this.loadUnderlay(s, myGen);
      return;
    }
    // 래스터(image/pdf) = 텍스처 평면 경로 — fetch+디코드 → 배치 → addImageUnderlay.
    if (RASTER_TYPES.has(s.sourceType)) {
      this.loadRaster(s, myGen);
      return;
    }

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
      .then((result) => {
        const cur = this.local.get(s.id);
        if (!cur || cur.gen !== myGen) return; // stale: 로드 중 제거/교체됨
        const live = this.store.getFederationSource(s.id);
        if (!live) return; // 로드 끝났는데 소스 사라짐
        // projectOrigin recenter 보정: 네이티브가 -origin 됐으면 원좌표 오버레이도 -origin(월드 미터).
        // 월드맵: doc[x,y]mm → world[x*.001, _, y*.001]. origin[x,y]mm → offset [-x*.001, 0, -y*.001].
        const o = this.store.getProjectOrigin();
        const offset: [number, number, number] | undefined = o ? [-o[0] / 1000, 0, -o[1] / 1000] : undefined;
        this.ref.add(s.id, result, offset);
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

  /** live.underlay → addUnderlay 배치(placement) + 레벨 elevation 해석. */
  private placeUnderlay(s: FederationSource, underlay: DwgUnderlay): void {
    const pl = s.underlay;
    const placement: UnderlayPlacement = pl
      ? { origin: pl.origin, rotation: pl.rotation, scale: pl.scale, clip: pl.clip }
      : { origin: [0, 0], rotation: 0, scale: 1 };
    const elev = pl ? this.store.getLevel(pl.levelId)?.elevation ?? 0 : 0;
    this.ref.addUnderlay(s.id, underlay, placement, elev);
  }

  /** 배치/클립만 변경 — 캐시된 파싱으로 재렌더(재페치·재파싱 없음). */
  private reapplyUnderlay(s: FederationSource, st: LocalState): void {
    if (!st.underlay) return;
    this.placeUnderlay(s, st.underlay);
    st.placementSig = placementSigOf(s);
  }

  /** 래스터(image/pdf) 배치 적용 — origin/rotation/scale/opacity + 레벨 elevation. */
  private placeRaster(s: FederationSource, raster: NonNullable<LocalState['raster']>): void {
    const pl = s.underlay;
    const placement = pl
      ? { origin: pl.origin, rotation: pl.rotation, scale: pl.scale }
      : { origin: [0, 0] as [number, number], rotation: 0, scale: 1 };
    const elev = pl ? this.store.getLevel(pl.levelId)?.elevation ?? 0 : 0;
    const opacity = pl?.opacity ?? 0.85;
    this.ref.addImageUnderlay(s.id, raster.source, raster.wMm, raster.hMm, placement, elev, opacity);
  }

  /** 래스터 로드 — blob 페치 → image=createImageBitmap / pdf=1페이지 렌더 → 캐시 + 배치 → ref.addImageUnderlay. */
  private loadRaster(s: FederationSource, myGen: number): void {
    const PT_TO_MM = 25.4 / 72;
    (async (): Promise<NonNullable<LocalState['raster']>> => {
      const res = await fetch(s.ref);
      if (!res.ok) throw new Error(`래스터 페치 실패 (${res.status})`);
      if (s.sourceType === 'pdf') {
        const { renderPdfFirstPage } = await import('../interop/pdfClient');
        const r = await renderPdfFirstPage(await res.arrayBuffer());
        return { source: r.canvas, wMm: r.ptWidth * PT_TO_MM, hMm: r.ptHeight * PT_TO_MM };
      }
      // ImageBitmap을 그대로 THREE.Texture에 넣으면 three가 flipY를 무시(r0.184 isImageBitmap 분기) →
      // 이미지가 상하반전(북남 뒤집힘, PDF=canvas 경로와 불일치). canvas로 변환하면 flipY 정상 = 정위치.
      // 동시에 디코드 상한(긴 변 ≤4096) 다운스케일 = OOM 가드(iPad). EXIF는 imageOrientation으로 보정.
      const MAX_SIDE = 4096;
      const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image' });
      const ow = bmp.width, oh = bmp.height;
      const sc = Math.min(1, MAX_SIDE / Math.max(ow, oh, 1));
      const cw = Math.max(1, Math.round(ow * sc)), ch = Math.max(1, Math.round(oh * sc));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      canvas.getContext('2d')?.drawImage(bmp, 0, 0, cw, ch);
      bmp.close(); // 디코드 비트맵 즉시 해제(누수 방지) — 캐시는 canvas
      return { source: canvas, wMm: ow, hMm: oh }; // wMm/hMm = 원본 px(scale=mm/px가 실크기 유지, 텍스처만 저해상)
    })()
      .then((raster) => {
        const cur = this.local.get(s.id);
        if (!cur || cur.gen !== myGen) return; // stale
        const live = this.store.getFederationSource(s.id);
        if (!live) return;
        this.placeRaster(live, raster);
        this.ref.setVisible(s.id, live.visible);
        this.local.set(s.id, {
          status: 'ready', ref: s.ref, sourceType: s.sourceType, gen: myGen,
          raster, placementSig: placementSigOf(live),
        });
        this.notify();
      })
      .catch((err: unknown) => {
        const cur = this.local.get(s.id);
        if (!cur || cur.gen !== myGen) return;
        this.local.set(s.id, {
          status: 'error', ref: s.ref, sourceType: s.sourceType,
          error: err instanceof Error ? err.message : String(err), gen: myGen,
        });
        this.notify();
      });
  }

  /** 언더레이(DWG/DXF) 로드 — blob 페치+파싱 → 캐시 + live.underlay 배치 적용 → ref.addUnderlay. */
  private loadUnderlay(s: FederationSource, myGen: number): void {
    const kind = s.sourceType === 'dxf' ? 'dxf' : 'dwg';
    this.underlayExtractor!(s.ref, kind)
      .then((underlay) => {
        const cur = this.local.get(s.id);
        if (!cur || cur.gen !== myGen) return; // stale
        const live = this.store.getFederationSource(s.id);
        if (!live) return;
        this.placeUnderlay(live, underlay);
        this.ref.setVisible(s.id, live.visible);
        this.local.set(s.id, {
          status: 'ready', ref: s.ref, sourceType: s.sourceType, gen: myGen,
          underlay, placementSig: placementSigOf(live),
        });
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
