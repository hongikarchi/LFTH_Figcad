/**
 * 음성 입력 — 브라우저 Web Speech API(SpeechRecognition) → 텍스트. 클라 전용(서버 무관).
 * Chrome/Edge/Safari(iPad 포함) 지원. 미지원 브라우저는 voiceSupported()=false → 버튼 숨김.
 */
interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

function ctor(): (new () => Recognition) | undefined {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const voiceSupported = (): boolean => !!ctor();

/** 인식 시작 — 누적 transcript를 onText로, 종료 시 onEnd. 반환 핸들의 stop()으로 중단. */
export function startVoice(onText: (t: string) => void, onEnd: () => void): { stop: () => void } | null {
  const C = ctor();
  if (!C) return null;
  const rec = new C();
  rec.lang = 'ko-KR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) t += e.results[i]?.[0]?.transcript ?? '';
    onText(t);
  };
  rec.onend = onEnd;
  rec.onerror = onEnd;
  rec.start();
  return { stop: () => rec.stop() };
}
