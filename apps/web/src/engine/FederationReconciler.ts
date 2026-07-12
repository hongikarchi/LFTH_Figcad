import type { DocStore, FederationSource, Id, Pt } from '@figcad/core';
import type { DwgUnderlay } from '@figcad/interop/dwg-underlay';
import { UnderlaySnapIndex } from '@figcad/interop/underlay-snap';
import type { ReferenceLayer, ReferenceMeshGroup, UnderlayPlacement } from './ReferenceLayer';
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
  /** 언더레이 끝점 스냅 인덱스 — 첫 쿼리 lazy 빌드, 배치/클립 변경·reload 시 무효화(클라 로컬). */
  snapIndex?: UnderlaySnapIndex;
  /** 래스터(image/pdf): 디코드 결과 캐시 — 배치만 바뀌면 재페치·재디코드 없이 재렌더. */
  raster?: { source: ImageBitmap | HTMLCanvasElement; wMm: number; hMm: number };
  /** 렌더된 PDF 페이지(1-base, 클램프 반영) — UI 표시용. */
  rasterPage?: number;
  /** 로드 시점의 **요청** 페이지(underlay.page) — 변경 감지는 이 값 기준(클램프된 요청 99가
   *  렌더 2와 달라도 재로드 루프에 안 빠지게). */
  rasterPageReq?: number;
  /** PDF 총 페이지 수 — UI 스테퍼 상한 (image=1). */
  pageCount?: number;
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
  /** PDF 총 페이지 수 (ready 후) — 페이지 스테퍼 상한. 비PDF/미로드 = undefined */
  pageCountOf(id: Id): number | undefined {
    return this.local.get(id)?.pageCount;
  }
  /** 실제 렌더된 PDF 페이지(1-base, 클램프 반영) */
  pageOf(id: Id): number | undefined {
    return this.local.get(id)?.rasterPage;
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
        // PDF 페이지 변경 = 캐시(구 페이지 텍스처) 재배치로는 불가 — 재렌더 필요(재페치 포함).
        // 비교는 로드 시점 **요청** 페이지 기준 — 클램프(요청 99→렌더 2) 상태서 재로드 루프 방지.
        if (st.raster && s.sourceType === 'pdf' && (s.underlay?.page ?? 1) !== (st.rasterPageReq ?? 1)) {
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
    const prev = this.local.get(s.id);
    this.local.set(s.id, {
      status: 'loading', ref: s.ref, sourceType: s.sourceType, gen: myGen,
      // pdf 페이지 전환·↻ 재로드 중에도 스테퍼가 언마운트되지 않게 표시 정보 보존(리뷰 —
      // 같은 파일일 때만: ref가 바뀌면 페이지 수도 무효).
      ...(prev && prev.ref === s.ref && prev.pageCount !== undefined
        ? { pageCount: prev.pageCount, rasterPage: prev.rasterPage }
        : {}),
    });

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

  /** 배치/클립만 변경 — 캐시된 파싱으로 재렌더(재페치·재파싱 없음). 스냅 인덱스도 무효화(배치 종속). */
  private reapplyUnderlay(s: FederationSource, st: LocalState): void {
    if (!st.underlay) return;
    st.snapIndex = undefined;
    this.placeUnderlay(s, st.underlay);
    st.placementSig = placementSigOf(s);
    this.scheduleSnapIndexBuild(s.id); // 새 배치로 idle 재빌드 (첫 스냅 hitch 방지)
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

  /** 래스터 로드 — blob 페치 → image=디코드 / pdf=지정 페이지 렌더 → 캐시 + 배치 → ref.addImageUnderlay. */
  private loadRaster(s: FederationSource, myGen: number): void {
    const PT_TO_MM = 25.4 / 72;
    (async (): Promise<NonNullable<LocalState['raster']> & { page?: number; pageCount?: number }> => {
      const res = await fetch(s.ref);
      if (!res.ok) throw new Error(`래스터 페치 실패 (${res.status})`);
      if (s.sourceType === 'pdf') {
        const { renderPdfPage } = await import('../interop/pdfClient');
        const r = await renderPdfPage(await res.arrayBuffer(), s.underlay?.page ?? 1);
        return {
          source: r.canvas, wMm: r.ptWidth * PT_TO_MM, hMm: r.ptHeight * PT_TO_MM,
          page: r.page, pageCount: r.pageCount,
        };
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
        // rasterPageReq = **실제 렌더에 넘긴** 요청(로드 시작 s 기준) — live 기준으로 기록하면
        // 로드 중 협업자가 page를 바꿨을 때 '렌더=구, req=신'으로 영구 스테일(리뷰 major).
        const requested = s.underlay?.page ?? 1;
        this.local.set(s.id, {
          status: 'ready', ref: s.ref, sourceType: s.sourceType, gen: myGen,
          raster, placementSig: placementSigOf(live),
          ...(raster.page !== undefined
            ? { rasterPage: raster.page, rasterPageReq: requested }
            : {}),
          ...(raster.pageCount !== undefined ? { pageCount: raster.pageCount } : {}),
        });
        this.notify();
        // completion-time 재검 — 로드 중 도착한 page 변경은 reconcile이 loading이라 무행동으로
        // 소비(sig는 갱신됨) → 여기서 즉시 재로드해 수렴(gen 가드가 체이닝 안전).
        if (s.sourceType === 'pdf' && (live.underlay?.page ?? 1) !== requested) {
          this.load(live);
        }
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

  /**
   * 빽도면 끝점 스냅 후보 — ready+visible+해당 레벨 배치 언더레이의 끝점을 커서 반경 내에서 수집.
   * 인덱스는 첫 쿼리에 lazy 빌드(메가시트 수십 ms 1회), 배치/클립 변경·reload 시 무효화.
   * 평면 도구들이 SnapContext.endpoints에 append (읽기전용 — 후보점만).
   */
  underlaySnapCandidates(levelId: Id, near: Pt, radiusMm: number): Pt[] {
    const out: Pt[] = [];
    for (const [id, st] of this.local) {
      if (st.status !== 'ready' || !st.underlay) continue;
      const s = this.store.getFederationSource(id);
      if (!s || !s.visible || !UNDERLAY_TYPES.has(s.sourceType)) continue;
      if (s.underlay?.levelId !== levelId) continue;
      if (!st.snapIndex) this.buildSnapIndex(s, st);
      st.snapIndex!.candidatesNear(near, radiusMm, out);
    }
    return out;
  }

  /** 스냅 인덱스 즉시 빌드 (동기) — lazy 폴백 경로. */
  private buildSnapIndex(s: FederationSource, st: LocalState): void {
    if (!st.underlay) return;
    const pl = s.underlay;
    st.snapIndex = new UnderlaySnapIndex(st.underlay, {
      origin: pl?.origin ?? [0, 0],
      rotation: pl?.rotation ?? 0,
      scale: pl?.scale ?? 1,
      clip: pl?.clip,
    });
    if (st.snapIndex.capped)
      console.warn(`[언더레이 스냅] "${s.name}" 끝점 상한 도달 — 일부만 스냅 후보`);
  }

  /**
   * 스냅 인덱스 idle 프리빌드 — 메가시트(100k+ 세그) 빌드가 첫 pointermove 중 프레임 hitch로
   * 떨어지지 않게 로드/배치 직후 유휴 시간에 미리 만든다(리뷰 지적). stale 가드 = placementSig.
   */
  private scheduleSnapIndexBuild(id: Id): void {
    const sig = this.local.get(id)?.placementSig;
    const ric: (cb: () => void) => unknown =
      typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb) => setTimeout(cb, 200);
    ric(() => {
      const st = this.local.get(id);
      const s = this.store.getFederationSource(id);
      if (!st || !s || st.status !== 'ready' || !st.underlay) return;
      if (st.snapIndex || st.placementSig !== sig) return; // 이미 빌드됨/배치 변경됨(stale)
      this.buildSnapIndex(s, st);
    });
  }

  /** 소스 하나의 월드 bbox — tuple 평탄화(THREE 미유입, AI 매니페스트용). 미로드/빈 = null. */
  worldBoundsOf(id: Id): { min: [number, number, number]; max: [number, number, number] } | null {
    const box = this.ref.boundsOf(id);
    if (!box) return null;
    return {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    };
  }

  /** 소스의 객체 정체성 목록 (ReferenceLayer 위임) — AI 매니페스트용. */
  objectsOf(id: Id): readonly ReferenceMeshGroup[] {
    return this.ref.objectsOf(id);
  }

  /** 소스의 언더레이 파싱 캐시 (레이어명·라벨 텍스트) — AI 매니페스트용. */
  underlayOf(id: Id): DwgUnderlay | undefined {
    return this.local.get(id)?.underlay;
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
        this.scheduleSnapIndexBuild(s.id); // 스냅 인덱스 idle 프리빌드 (첫 스냅 hitch 방지)
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
