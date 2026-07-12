// 최소 window 스텁 — CameraRig 등이 리사이즈 리스너·뷰포트 치수만 쓴다(DOM 렌더 없음).
// jsdom을 피하는 이유: 무겁고, 여기 테스트는 순수 수학이라 뷰포트 숫자만 있으면 된다.
(globalThis as unknown as { window: unknown }).window = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
  devicePixelRatio: 1,
};
