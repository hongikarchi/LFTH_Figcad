// 최소 window/localStorage 스텁 — CameraRig(뷰포트 치수·리사이즈 리스너)·uiStore(모듈 스코프
// localStorage 영속)가 쓰는 표면만. jsdom을 피하는 이유: 무겁고, 여기 테스트는 순수 로직이라
// 이 정도 표면이면 충분하다.
(globalThis as unknown as { window: unknown }).window = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
  devicePixelRatio: 1,
};
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};
// WalkController가 visibilitychange 리스너만 등록 — 최소 document 스텁
(globalThis as unknown as { document: unknown }).document = {
  addEventListener: () => {},
  removeEventListener: () => {},
};
