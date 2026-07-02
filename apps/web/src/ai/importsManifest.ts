import type { DocStore, FederationSource, Id } from '@figcad/core';
import type { DwgUnderlay } from '@figcad/interop/dwg-underlay';
import type { ReferenceMeshGroup } from '../engine/ReferenceLayer';

/**
 * 연동 모델(임포트) 매니페스트 — AI 요청 시점에 클라가 조립해 body.imports로 전송.
 * 서버(agent.ts importsBlockOf)가 <연동_모델> 블록으로 프롬프트에 주입 → AI가 임포트를 "본다".
 *
 * 불변① 정합: 지오메트리·정체성은 문서/Y.Doc에 절대 안 들어감 — 요청-스코프 HTTP payload로만
 * 여행하고 요청과 함께 죽는다. 소스가 0이면 null = 필드 생략(토큰 0, 구서버와 동일 동작).
 */

/** FederationReconciler의 구조적 서브셋 — 결합도 최소화(THREE 미유입) + 스텁 테스트 가능. */
export interface ImportsProvider {
  statusOf(id: Id): 'loading' | 'ready' | 'error' | undefined;
  worldBoundsOf(id: Id): { min: [number, number, number]; max: [number, number, number] } | null;
  objectsOf(id: Id): readonly ReferenceMeshGroup[];
  underlayOf(id: Id): DwgUnderlay | undefined;
}

export interface ImportObjectSummary {
  name: string;
  category?: string;
  /** 같은 이름 인스턴스 수 (블록 반복 등) */
  count: number;
}

export interface ImportSourceManifest {
  id: string;
  name: string;
  sourceType: FederationSource['sourceType'];
  status: 'loading' | 'ready' | 'error';
  visible: boolean;
  /** 문서 mm — 네이티브 요소 좌표와 동일 프레임. elev = 높이. */
  bboxMm?: { x: [number, number]; y: [number, number]; elev: [number, number] };
  /** 언더레이(dwg/dxf/image/pdf) 배치 레벨 */
  levelId?: string;
  /** 정체성 있는 객체 총수 — 정체성 없으면 생략(머지 .3dm이 "1객체" 주장 금지) */
  objectCount?: number;
  objects?: ImportObjectSummary[];
  objectsTruncated?: true;
  /** DWG/DXF: 보이는(!layerHidden) 레이어명 */
  layers?: string[];
  layersTruncated?: true;
  /** DWG/DXF: 라벨 텍스트 dedupe 샘플 */
  textSamples?: string[];
}

export interface ImportsManifest {
  sources: ImportSourceManifest[];
  truncated?: true;
}

/** 토큰 예산 캡 — 전형(1-3소스) ≈ +0.5-2k 토큰, 최악 캡 ≈ 6-7k (서버 30k자 하드 가드 별도). */
export const MANIFEST_CAPS = {
  sources: 32, // 총 소스 상한
  detailedSources: 8, // objects/layers/textSamples까지 싣는 소스 수 (정렬 후 앞에서부터)
  objects: 30,
  nameChars: 40,
  // category(Rhino 레이어 fullPath·ifcType)는 paint_import_material의 **정확 일치 키** — 40자 클립이면
  // 긴 중첩 레이어('A::B::Level 02::…')가 죽은 오버라이드(성공 보고+무변화)가 됨. 별도 넉넉한 캡.
  categoryChars: 120,
  layers: 30,
  textSamples: 20,
  textChars: 32,
} as const;

/** 코드포인트 안전 클립 (한글/이모지 서러게이트 절단 방지). */
function clip(s: string, max: number): string {
  const cps = [...s];
  return cps.length <= max ? s : cps.slice(0, max).join('');
}

/**
 * 연동 소스 → 매니페스트. 소스 0개면 null — 호출자는 body에서 필드 자체를 생략.
 *
 * bboxMm 변환: **doc mm = round(world × 1000)**, world X→doc x, world Z→doc y, world Y→elev.
 * projectOrigin을 더하지 말 것 — 저장 좌표는 이미 recenter돼 있고(stored = true − origin,
 * store.ts §projectOrigin), ReferenceLayer 그룹이 -origin 오프셋/언더레이 TRS를 이미 굽는다
 * (FederationReconciler.load) → setFromObject 결과가 곧 doc 프레임.
 */
export function buildImportsManifest(store: DocStore, fed: ImportsProvider): ImportsManifest | null {
  const sources = store.listFederationSources();
  if (sources.length === 0) return null;

  // ready > loading > error · visible 우선 · 최신 추가순 — 상세 슬롯(앞 8개)이 유의미한 소스에 가게.
  const statusRank = (st: string | undefined): number => (st === 'ready' ? 0 : st === 'loading' ? 1 : 2);
  const sorted = [...sources].sort((a, b) => {
    const sr = statusRank(fed.statusOf(a.id)) - statusRank(fed.statusOf(b.id));
    if (sr !== 0) return sr;
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    return b.ts - a.ts;
  });

  const out: ImportSourceManifest[] = [];
  for (let i = 0; i < sorted.length && i < MANIFEST_CAPS.sources; i++) {
    const s = sorted[i]!;
    const status = fed.statusOf(s.id) ?? 'loading';
    const m: ImportSourceManifest = {
      id: s.id,
      name: clip(s.name, MANIFEST_CAPS.nameChars),
      sourceType: s.sourceType,
      status,
      visible: s.visible,
    };
    if (s.underlay?.levelId) m.levelId = s.underlay.levelId;

    const b = fed.worldBoundsOf(s.id);
    if (b) {
      m.bboxMm = {
        x: [Math.round(b.min[0] * 1000), Math.round(b.max[0] * 1000)],
        y: [Math.round(b.min[2] * 1000), Math.round(b.max[2] * 1000)],
        elev: [Math.round(b.min[1] * 1000), Math.round(b.max[1] * 1000)],
      };
    }

    if (i < MANIFEST_CAPS.detailedSources) {
      // 객체 목록 — 이름 dedupe + 인스턴스 수, count desc. 정체성 없으면 objectCount도 생략.
      // 논리 객체 dedupe: 같은 objectId의 서브메시(IFC 멀티지오메트리 제품·figcad-room 커튼월 패널)는
      // 1객체로 센다. objectId 없는 항목(glTF 무명 노드 등)은 개별 유지 — 진짜 인스턴스일 수 있음.
      const raw = fed.objectsOf(s.id);
      const seenIds = new Set<string>();
      const objs: typeof raw[number][] = [];
      for (const o of raw) {
        if (o.objectId) {
          if (seenIds.has(o.objectId)) continue;
          seenIds.add(o.objectId);
        }
        objs.push(o);
      }
      if (objs.length) {
        m.objectCount = objs.length;
        const byName = new Map<string, ImportObjectSummary>();
        for (const o of objs) {
          const nm = o.name ?? o.category;
          if (!nm) continue;
          const key = clip(nm, MANIFEST_CAPS.nameChars);
          const hit = byName.get(key);
          if (hit) hit.count++;
          else byName.set(key, { name: key, ...(o.category ? { category: clip(o.category, MANIFEST_CAPS.categoryChars) } : {}), count: 1 });
        }
        const summaries = [...byName.values()].sort((a, b2) => b2.count - a.count || a.name.localeCompare(b2.name));
        if (summaries.length) {
          m.objects = summaries.slice(0, MANIFEST_CAPS.objects);
          if (summaries.length > MANIFEST_CAPS.objects) m.objectsTruncated = true;
        }
      }
      // DWG/DXF — 보이는 레이어명 + 라벨 텍스트 샘플.
      const u = fed.underlayOf(s.id);
      if (u) {
        const visibleLayers = u.layers.filter((_, li) => !u.layerHidden[li]);
        m.layers = visibleLayers.slice(0, MANIFEST_CAPS.layers).map((l) => clip(l, MANIFEST_CAPS.nameChars));
        if (visibleLayers.length > MANIFEST_CAPS.layers) m.layersTruncated = true;
        const texts = new Set<string>();
        for (const lb of u.labels) {
          const t = lb.text.trim();
          if (t.length < 2) continue;
          texts.add(clip(t, MANIFEST_CAPS.textChars));
          if (texts.size >= MANIFEST_CAPS.textSamples) break;
        }
        if (texts.size) m.textSamples = [...texts];
      }
    }
    out.push(m);
  }

  const manifest: ImportsManifest = { sources: out };
  if (sorted.length > MANIFEST_CAPS.sources) manifest.truncated = true;
  return manifest;
}
