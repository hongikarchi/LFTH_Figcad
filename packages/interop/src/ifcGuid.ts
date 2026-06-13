/**
 * IFC GlobalId — 128비트를 64진수 22자로 압축 (buildingSMART 표준).
 * 요소 id에서 결정론적으로 파생 → export가 결정론적(테스트 안정, 재export 시 동일 GUID).
 */

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** FNV-1a 32비트 (seed로 변형) — 문자열 → 4바이트 */
function fnv1a(str: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 16바이트를 IFC GUID 22자로 (1바이트→2자 + 5×3바이트→4자) */
function bytesToIfcGuid(b: Uint8Array): string {
  const num = (lo: number, len: number): number => {
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + b[lo + i]!;
    return v;
  };
  const to64 = (v: number, digits: number): string => {
    let s = '';
    for (let i = 0; i < digits; i++) {
      s = B64[v % 64] + s;
      v = Math.floor(v / 64);
    }
    return s;
  };
  return (
    to64(num(0, 1), 2) +
    to64(num(1, 3), 4) +
    to64(num(4, 3), 4) +
    to64(num(7, 3), 4) +
    to64(num(10, 3), 4) +
    to64(num(13, 3), 4)
  );
}

/** 요소 id(+네임스페이스) → 결정론적 IFC GlobalId */
export function ifcGuidFromId(id: string): string {
  const bytes = new Uint8Array(16);
  for (let k = 0; k < 4; k++) {
    const h = fnv1a(id, k * 0x9e3779b1);
    bytes[k * 4] = (h >>> 24) & 0xff;
    bytes[k * 4 + 1] = (h >>> 16) & 0xff;
    bytes[k * 4 + 2] = (h >>> 8) & 0xff;
    bytes[k * 4 + 3] = h & 0xff;
  }
  return bytesToIfcGuid(bytes);
}
