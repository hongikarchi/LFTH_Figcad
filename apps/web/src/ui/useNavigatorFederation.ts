import { useState } from 'react';
import type { DocStore, FederationSource } from '@figcad/core';
import { backendOrigin } from '../config/backend';
import { parseDwgUnderlay, underlayDenseCenter } from '../interop/dwgClient';

export const SOURCE_BADGE: Record<FederationSource['sourceType'], string> = {
  'figcad-room': 'Figcad',
  '3dm': '.3dm',
  ifc: 'IFC',
  gltf: 'glTF',
  '3dtiles': '3D Tiles',
  dxf: 'DXF',
  dwg: 'DWG',
  image: '🖼 이미지',
  pdf: 'PDF',
};

/** 대형 파일 가드 — 메시/CAD 파서는 브라우저 WASM 힙 한계로 대형서 OOM (interop.md). 래스터는 무관. */
const LARGE_FILE_MB = 50;

/**
 * M13 연동 모델(federation 오버레이) — 룸 id 추가 + glTF/IFC 파일 업로드 핸들러.
 * 입력 상태(fedInput)와 서버 업로드(?op=fed-upload)를 자족. Navigator는 소스 목록만 렌더.
 */
export function useNavigatorFederation(store: DocStore) {
  const [fedInput, setFedInput] = useState('');

  // 입력 = 원시 room id 또는 붙여넣은 ?p=<id> / 전체 URL. p 파라미터를 뽑아낸다.
  const parseRoomId = (raw: string): string => {
    const s = raw.trim();
    if (!s) return '';
    try {
      const p = new URL(s).searchParams.get('p');
      if (p) return p;
    } catch {
      // URL 아님 — ?p= 패턴만 들어왔거나 원시 id
    }
    const m = s.match(/[?&]p=([^&]+)/);
    return m ? decodeURIComponent(m[1]!) : s;
  };

  const fedAuthor = localStorage.getItem('figcad.userName') ?? '게스트';

  const addFederationRoom = () => {
    const roomId = parseRoomId(fedInput);
    if (!roomId) return;
    store.addFederationSource({
      name: `룸 ${roomId}`,
      sourceType: 'figcad-room',
      ref: roomId,
      visible: true,
      addedBy: fedAuthor,
    });
    setFedInput('');
  };

  // glTF/IFC 업로드(M13-F) — 파일을 서버 R2(?op=fed-upload)에 올려 *협업자 전원이 페치 가능한*
  // blob URL로. ref = 그 전체 URL (extractGltf/extractIfc가 fetch). object-URL은 올린 사람만 봄.
  const fedBase = () => backendOrigin();
  const uploadFederationFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,.ifc,.3dm,.dwg,.dxf,.png,.jpg,.jpeg,.pdf,.skp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      // SketchUp = 브라우저 파서 없음(대용량) → 플러그인 export 경로(라이노 커넥터 패턴, 후속).
      if (ext === 'skp' || ext === 'skb') {
        window.alert(
          'SketchUp(.skp)는 브라우저에서 직접 못 엽니다.\nSketchUp 플러그인으로 glTF/OBJ export → "+연동 모델"로 올리세요 (Rhino 커넥터와 동일 패턴, 후속 지원).',
        );
        return;
      }
      const sourceType: FederationSource['sourceType'] | null =
        ext === 'ifc' ? 'ifc' : ext === 'glb' || ext === 'gltf' ? 'gltf' : ext === '3dm' ? '3dm'
          : ext === 'dwg' ? 'dwg' : ext === 'dxf' ? 'dxf'
            : ext === 'png' || ext === 'jpg' || ext === 'jpeg' ? 'image'
              : ext === 'pdf' ? 'pdf' : null;
      if (!sourceType) {
        window.alert('지원: glTF(.glb/.gltf)·IFC·Rhino(.3dm)·CAD(.dwg/.dxf)·이미지(png/jpg)·PDF');
        return;
      }
      // 대형 파일 가드 — 메시/CAD 파서는 OOM 위험(래스터는 다운스케일 안전).
      const isRaster = sourceType === 'image' || sourceType === 'pdf';
      if (!isRaster && file.size > LARGE_FILE_MB * 1024 * 1024) {
        const mb = (file.size / 1048576).toFixed(0);
        if (!window.confirm(`대형 파일 ${mb}MB — 브라우저 파싱이 실패(메모리 초과)할 수 있습니다. 커넥터/서브셋 권장. 그래도 시도할까요?`)) return;
      }
      const room = new URL(location.href).searchParams.get('p');
      if (!room) return;
      try {
        const buf = await file.arrayBuffer();
        // CAD 언더레이(빽도면): 업로드 전 클라 파싱 1회 → 밀집 클러스터를 원점 근처로 센터링하는
        // 기본 배치(메가시트=측량좌표·xref 흩어짐 대비). 렌더는 reconciler가 blob 재페치로(협업자 공통).
        // 래스터(image/pdf): 클라서 px 치수 디코드 → 기본 배치(중심=원점, scale=mm/px로 긴 변 ~10m).
        let underlay: FederationSource['underlay'];
        if (sourceType === 'dwg' || sourceType === 'dxf') {
          const u = await parseDwgUnderlay(buf.slice(0), sourceType);
          const [dx, dy] = underlayDenseCenter(u);
          const levelId = store.listLevels()[0]?.id ?? '';
          underlay = { levelId, origin: [-dx, -dy], rotation: 0, scale: 1 };
        } else if (sourceType === 'image') {
          // 이미지는 실척 없음 → px를 mm처럼 두고 scale=mm/px로 긴 변 ~10m 기본(중심=원점).
          const bmp = await createImageBitmap(file);
          const mmPerPx = 10000 / Math.max(bmp.width, bmp.height, 1);
          bmp.close();
          const levelId = store.listLevels()[0]?.id ?? '';
          underlay = { levelId, origin: [0, 0], rotation: 0, scale: mmPerPx, opacity: 0.85 };
        } else if (sourceType === 'pdf') {
          // PDF는 실척 보유(pt→mm) → reconciler가 페이지 pt 크기로 쿼드 생성, scale=1(실척).
          const levelId = store.listLevels()[0]?.id ?? '';
          underlay = { levelId, origin: [0, 0], rotation: 0, scale: 1, opacity: 0.85 };
        }
        const roomKey = new URL(location.href).searchParams.get('key');
        const res = await fetch(
          `${fedBase()}/parties/doc/${room}?op=fed-upload&ext=${ext}${roomKey ? `&key=${encodeURIComponent(roomKey)}` : ''}`,
          { method: 'POST', body: buf },
        );
        if (!res.ok) throw new Error(`업로드 실패 (${res.status})`);
        const { url } = (await res.json()) as { url: string };
        store.addFederationSource({
          name: file.name,
          sourceType,
          ref: `${fedBase()}/parties/doc/${room}${url}`, // 전체 blob URL — 협업자도 페치 가능
          visible: true,
          addedBy: fedAuthor,
          ...(underlay ? { underlay } : {}),
        });
      } catch (e) {
        window.alert(`연동 모델 업로드 실패: ${e instanceof Error ? e.message : e}`);
      }
    };
    input.click();
  };

  return { fedInput, setFedInput, addFederationRoom, uploadFederationFile };
}
