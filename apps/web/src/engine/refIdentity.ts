import type * as THREE from 'three';
import type { DocStore } from '@figcad/core';
import type { ReferenceMeshGroup } from './ReferenceLayer';

/**
 * 임포트(연동 모델) 객체 식별 — ReferenceLayer가 메시 userData에 심은 정체성을 해석한다.
 * 읽기전용 상호작용(측정 스냅 정보·라벨 프리필)용, 편집 아님. 클라 로컬(Y.Doc 밖).
 *
 * userData 계약(ReferenceLayer.add):
 *   refSourceId = federation source id (필수 — 없으면 네이티브 메시 = null)
 *   refGroups   = 병합 버퍼(.3dm) 객체별 삼각형 range (start 오름차순 — 이진탐색)
 *   refObject   = 메시 전체 = 한 객체 (glTF/IFC/figcad-room)
 */

export interface RefObjectInfo {
  sourceId: string;
  objectName?: string;
  objectId?: string;
  category?: string;
}

/** 히트 메시 + faceIndex → 임포트 객체 식별. 네이티브 메시(refSourceId 없음) = null. */
export function refObjectInfoAt(obj: THREE.Object3D, faceIndex?: number): RefObjectInfo | null {
  const sourceId = obj.userData['refSourceId'];
  if (typeof sourceId !== 'string') return null;
  const groups = obj.userData['refGroups'] as ReferenceMeshGroup[] | undefined;
  if (groups && faceIndex !== undefined) {
    // start 오름차순·연속(방출 순서 = tris 단조 증가) → 이진탐색 log2(50k)≈16.
    let lo = 0;
    let hi = groups.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = groups[mid]!;
      if (faceIndex < g.start) hi = mid - 1;
      else if (faceIndex >= g.start + g.count) lo = mid + 1;
      else return { sourceId, objectName: g.name, objectId: g.objectId, category: g.category };
    }
    return { sourceId }; // 캡 초과 열화분 등 range 밖 — 소스레벨 정체성만
  }
  const single = obj.userData['refObject'] as ReferenceMeshGroup | undefined;
  if (single) {
    return { sourceId, objectName: single.name, objectId: single.objectId, category: single.category };
  }
  return { sourceId };
}

/** UI 표시명 폴백 체인: 객체명 → 카테고리(레이어/IFC타입/kind) → 연동 모델 이름 → '외부 모델'. */
export function refDisplayName(store: DocStore, info: RefObjectInfo): string {
  return (
    info.objectName ||
    info.category ||
    store.getFederationSource(info.sourceId)?.name ||
    '외부 모델'
  );
}
