// @figcad/core — 문서 스키마 + 스토어(ops) + 지오메트리 파생 + 스냅.
// 불변 규칙:
//   1. 지오메트리는 문서에 저장·동기화하지 않는다 — 파라미터에서 순수 함수로 파생.
//   2. 모든 문서 변경은 DocStore의 ops 메서드를 경유한다.

export * from './schema';
export * from './store';
export * from './geometry';
export * from './snap';
export * from './ai';
export * from './capabilities';
export * from './lint';
export * from './diff';
