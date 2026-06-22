import { useState } from 'react';
import type { DocSnapshot, DocStore } from '@figcad/core';
import {
  downloadDxf,
  downloadIfc,
  downloadRhino,
  parseDxf,
  parseIfc,
  parseRhino,
} from '../interop/ifcClient';

type IfcFormat = { ext: '.ifc' | '.3dm' | '.dxf'; label: string; binary: boolean };

const FORMATS: Record<'ifc' | 'rhino' | 'dxf', IfcFormat> = {
  ifc: { ext: '.ifc', label: 'IFC', binary: true },
  rhino: { ext: '.3dm', label: 'Rhino .3dm', binary: true },
  dxf: { ext: '.dxf', label: 'DXF', binary: false },
};

/**
 * 문서 백업(JSON) + interop(IFC/.3dm/DXF) 내보내기·가져오기 핸들러.
 * busy 라벨/확인창/오류 alert까지 자족 — Navigator는 결과만 렌더.
 */
export function useNavigatorIO(store: DocStore) {
  const [ifcBusy, setIfcBusy] = useState<'export' | 'import' | null>(null);

  const exportJson = () => {
    const snap = store.snapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${snap.meta.projectName || 'figcad'}.figcad.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        try {
          const snap = JSON.parse(text) as DocSnapshot;
          const n = store.listElements().length;
          if (
            !window.confirm(
              `현재 문서(요소 ${n}개)를 '${file.name}' 내용으로 교체합니다.\n협업 중인 모든 사용자에게 즉시 적용됩니다 (Ctrl+Z로 되돌리기 가능). 계속할까요?`,
            )
          )
            return;
          store.importSnapshot(snap);
        } catch (e) {
          window.alert(`가져오기 실패: ${e instanceof Error ? e.message : e}`);
        }
      });
    };
    input.click();
  };

  // setState 직후 busy 라벨이 페인트될 틈을 준다 — 이어지는 WASM 동기 호출이
  // 메인 스레드를 막아 '눌렀는데 반응 없음'으로 보이는 것 방지
  const paintYield = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  const exportFile = async (fmt: keyof typeof FORMATS) => {
    setIfcBusy('export');
    try {
      await paintYield();
      const snap = store.snapshot();
      if (fmt === 'ifc') await downloadIfc(snap);
      else if (fmt === 'rhino') await downloadRhino(snap);
      else await downloadDxf(snap);
    } catch (e) {
      window.alert(`${FORMATS[fmt].label} 내보내기 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setIfcBusy(null);
    }
  };

  const importFile = (fmt: keyof typeof FORMATS) => {
    const f = FORMATS[fmt];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = f.ext;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const readP = f.binary ? file.arrayBuffer() : file.text();
      void readP.then(async (data) => {
        setIfcBusy('import');
        try {
          await paintYield();
          const result =
            fmt === 'ifc'
              ? await parseIfc(new Uint8Array(data as ArrayBuffer))
              : fmt === 'rhino'
                ? await parseRhino(new Uint8Array(data as ArrayBuffer))
                : await parseDxf(data as string);
          const { snapshot, skipped } = result;
          const skipNote = Object.keys(skipped).length
            ? `\n무시된 항목: ${Object.entries(skipped).map(([k, n]) => `${k} ${n}`).join(', ')}`
            : '';
          const lossNote =
            fmt === 'ifc' ? '' : '\n(이 포맷은 지오메트리 레벨 — 벽 두께/타입은 기본값으로 들어옵니다)';
          const n = store.listElements().length;
          if (
            !window.confirm(
              `'${file.name}'에서 요소 ${snapshot.elements.length}개를 가져와 현재 문서(요소 ${n}개)를 교체합니다.${skipNote}${lossNote}\n협업 중인 모든 사용자에게 적용됩니다 (Ctrl+Z 가능). 계속할까요?`,
            )
          )
            return;
          store.importSnapshot(snapshot);
        } catch (e) {
          window.alert(`${f.label} 가져오기 실패: ${e instanceof Error ? e.message : e}`);
        } finally {
          setIfcBusy(null);
        }
      });
    };
    input.click();
  };

  return { ifcBusy, FORMATS, exportJson, importJson, exportFile, importFile };
}
