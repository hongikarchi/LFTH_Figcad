import type { Pt } from '@figcad/core';
import type { DwgUnderlay } from './dwgUnderlay';

/**
 * 빽도면(DWG/DXF 언더레이) 끝점 스냅 인덱스 — 평면 모드에서 줄자·라벨·그리기 도구가
 * 도면 선 끝점에 스냅하게 한다 (읽기전용 — 언더레이 편집 아님, 후보점만 제공).
 * 순수 로직(DOM/Three 무의존)이라 interop에 두고 테스트한다 — 소비는 apps/web FederationReconciler.
 *
 * 빌드 = 세그 1패스: layerHidden·clip 제외(addUnderlay 렌더 규칙과 동일 — 화면에 보이는 선만 스냅)
 * → 도면 로컬 mm → doc mm 변환 → 1mm 양자화 dedupe → 균일 그리드 해시(셀 1024mm).
 * 메가시트 100k세그 ≈ 수 MB·빌드 수십 ms(호출자가 lazy) · 쿼리 = 3×3 셀 스캔 µs.
 *
 * 좌표 변환 = **ReferenceLayer.addUnderlay의 TRS와 동일해야 함** (스케일→회전→이동):
 *   Three group: scale s → rotation.y = -r → position origin.
 *   R_y(-r): x' = cos r·x - sin r·z, z' = sin r·x + cos r·z (Three [x,·,z] = doc [x,y]).
 *   ⇒ doc = origin + s·[cos r·lx - sin r·ly, sin r·lx + cos r·ly]  — underlay-snap.test.ts가 부호 고정.
 */

/** 언더레이 배치 (ReferenceLayer.UnderlayPlacement의 구조적 서브셋 — 순환 의존 회피). */
export interface UnderlaySnapPlacement {
  origin: [number, number];
  rotation: number;
  scale: number;
  /** XCLIP 사각형 [minX,minY,maxX,maxY] 도면 로컬 mm — 이 안만 스냅(렌더 트림과 동일). */
  clip?: [number, number, number, number];
}

const CELL_MM = 1024;
const DEFAULT_CAP = 300_000;

export class UnderlaySnapIndex {
  /** 양자화된 doc mm 끝점 (dedupe 후) */
  private xs: Int32Array;
  private ys: Int32Array;
  /** 셀키 "cx,cy" → 점 인덱스 목록 */
  private cells = new Map<string, Uint32Array>();
  /** capPoints 초과로 일부 드롭됨 (1회 log는 호출자) */
  readonly capped: boolean;

  constructor(underlay: DwgUnderlay, placement: UnderlaySnapPlacement, capPoints = DEFAULT_CAP) {
    const { origin, rotation, scale, clip } = placement;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const seg = underlay.segments;
    const seen = new Set<string>();
    const px: number[] = [];
    const py: number[] = [];
    let capped = false;

    const addPt = (lx: number, ly: number): void => {
      // clip = 도면 로컬 mm AABB (addUnderlay와 동일 규칙 — 밖이면 렌더 안 됨 = 스냅도 안 함).
      if (clip && (lx < clip[0] || lx > clip[2] || ly < clip[1] || ly > clip[3])) return;
      const dx = Math.round(origin[0] + scale * (cos * lx - sin * ly));
      const dy = Math.round(origin[1] + scale * (sin * lx + cos * ly));
      const key = `${dx},${dy}`; // 1mm 양자화 dedupe — 문자열 키(빌드 1회, 좌표 크기 무관 안전)
      if (seen.has(key)) return;
      if (px.length >= capPoints) {
        capped = true;
        return;
      }
      seen.add(key);
      px.push(dx);
      py.push(dy);
    };

    for (let i = 0; i < seg.length; i += 4) {
      if (underlay.layerHidden[underlay.segLayer[i / 4]!]) continue;
      addPt(seg[i]!, seg[i + 1]!);
      addPt(seg[i + 2]!, seg[i + 3]!);
      if (capped) break;
    }
    this.capped = capped;
    this.xs = Int32Array.from(px);
    this.ys = Int32Array.from(py);

    // 셀 버킷 2패스(카운팅 → 채움) — per-셀 배열 churn 없이 Uint32Array 고정 할당.
    // 셀키 문자열은 점당 1회만 생성(두 패스 공유) — 빌드 문자열 churn 절반 (리뷰: 메가시트 빌드 hitch).
    const keys: string[] = new Array(this.xs.length);
    const counts = new Map<string, number>();
    for (let i = 0; i < this.xs.length; i++) {
      const k = `${Math.floor(this.xs[i]! / CELL_MM)},${Math.floor(this.ys[i]! / CELL_MM)}`;
      keys[i] = k;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [k, n] of counts) this.cells.set(k, new Uint32Array(n));
    const fill = new Map<string, number>();
    for (let i = 0; i < this.xs.length; i++) {
      const k = keys[i]!;
      const at = fill.get(k) ?? 0;
      this.cells.get(k)![at] = i;
      fill.set(k, at + 1);
    }
  }

  get pointCount(): number {
    return this.xs.length;
  }

  /** doc mm 반경 내 끝점 후보를 out에 push (호출자 배열 재사용 — 이동당 재할당 억제). */
  candidatesNear(pt: Pt, radiusMm: number, out: Pt[]): void {
    const r2 = radiusMm * radiusMm;
    const cx0 = Math.floor((pt[0] - radiusMm) / CELL_MM);
    const cx1 = Math.floor((pt[0] + radiusMm) / CELL_MM);
    const cy0 = Math.floor((pt[1] - radiusMm) / CELL_MM);
    const cy1 = Math.floor((pt[1] + radiusMm) / CELL_MM);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = this.cells.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const i = bucket[bi]!;
          const dx = this.xs[i]! - pt[0];
          const dy = this.ys[i]! - pt[1];
          if (dx * dx + dy * dy <= r2) out.push([this.xs[i]!, this.ys[i]!]);
        }
      }
    }
  }
}
