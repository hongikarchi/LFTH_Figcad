// 일회성 — web-ifc IFC4 생성자 시그니처 추출 (구현 시 참조용)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../node_modules/web-ifc/ifc-schema.d.ts', import.meta.url), 'utf8');
const ifc4 = src.slice(src.indexOf('export declare namespace IFC4 {'), src.indexOf('export declare namespace IFC4X3 {'));
const names = process.argv.slice(2);
for (const n of names) {
  const m = ifc4.match(new RegExp('class ' + n + ' extends [^{]+\\{([\\s\\S]*?)\\n    \\}'));
  if (!m) { console.log('### ' + n + ': NOT FOUND'); continue; }
  const ctor = m[1].match(/constructor\(([\s\S]*?)\);/);
  console.log('### ' + n);
  console.log((ctor ? ctor[1] : 'no ctor').replace(/\s+/g, ' ').trim());
}
