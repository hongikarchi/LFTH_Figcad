import { useUiStore } from '../state/uiStore';

/**
 * 디바이스 클래스 판정 (모바일 반응형) — 단일 소스.
 * 폰 = coarse 포인터 + (좁은 폭 ≤540 OR 낮은 높이 ≤460[가로 폰]). 아이패드 세로(768+)·데스크톱은 비매치 → 현행 레일 UI.
 * matchMedia 'change'는 리사이즈/회전이 경계를 넘을 때 발화 → orientationchange/resize 별도 구독 불필요.
 */
const PHONE_QUERY =
  '(pointer: coarse) and (max-width: 540px), (pointer: coarse) and (max-height: 460px)';

/** main에서 React mount 전 1회 호출 — 첫 페인트부터 body.device-phone + store.device 정확. */
export function initDeviceClass(): void {
  const mql = window.matchMedia(PHONE_QUERY);
  const apply = (phone: boolean): void => {
    document.body.classList.toggle('device-phone', phone);
    const st = useUiStore.getState();
    const next = phone ? 'phone' : 'desktop';
    if (st.device !== next) st.setDevice(next);
  };
  apply(mql.matches);
  mql.addEventListener('change', (e) => apply(e.matches));
}
