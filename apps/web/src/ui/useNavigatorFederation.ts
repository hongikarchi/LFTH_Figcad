import { useState } from 'react';
import type { DocStore, FederationSource } from '@figcad/core';
import { backendOrigin } from '../config/backend';

export const SOURCE_BADGE: Record<FederationSource['sourceType'], string> = {
  'figcad-room': 'Figcad',
  '3dm': '.3dm',
  ifc: 'IFC',
  gltf: 'glTF',
  '3dtiles': '3D Tiles',
  dxf: 'DXF',
  dwg: 'DWG',
};

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
    input.accept = '.glb,.gltf,.ifc,.3dm';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      const sourceType: FederationSource['sourceType'] | null =
        ext === 'ifc' ? 'ifc' : ext === 'glb' || ext === 'gltf' ? 'gltf' : ext === '3dm' ? '3dm' : null;
      if (!sourceType) {
        window.alert('glTF(.glb/.gltf)·IFC(.ifc)·Rhino(.3dm) 파일만 지원');
        return;
      }
      const room = new URL(location.href).searchParams.get('p');
      if (!room) return;
      try {
        const buf = await file.arrayBuffer();
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
        });
      } catch (e) {
        window.alert(`연동 모델 업로드 실패: ${e instanceof Error ? e.message : e}`);
      }
    };
    input.click();
  };

  return { fedInput, setFedInput, addFederationRoom, uploadFederationFile };
}
