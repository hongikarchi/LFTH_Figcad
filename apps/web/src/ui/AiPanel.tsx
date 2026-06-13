import { useEffect, useRef, useState } from 'react';
import { applyOpLog, opSummary, type DocStore, type OpLogEntry } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { runAgent, type TranscriptTurn } from '../ai/agentClient';
import { clearSketch, hasSketch, onSketchChange, rasterizeSketch } from '../ai/sketchCapture';

/**
 * AI 모드 채팅 패널 — 우하단 도킹.
 * 요청 → 서버 드라이런 계획(텍스트 스트리밍 + opLog) → 계획 카드 승인/거부.
 * 승인 시에만 applyOpLog로 문서 반영 (DocStore ops 경유 → undo·협업 공짜).
 * v1 자율성 = 항상 승인.
 */

interface ChatMsg {
  role: 'user' | 'assistant' | 'notice';
  text: string;
}

interface Plan {
  opLog: OpLogEntry[];
  summaries: string[];
  note?: string;
}

export function AiPanel({ store }: { store: DocStore }) {
  const aiOpen = useUiStore((s) => s.aiOpen);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [liveOps, setLiveOps] = useState<string[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sketchOn, setSketchOn] = useState(hasSketch());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => onSketchChange(() => setSketchOn(hasSketch())), []);

  if (!aiOpen) return null;

  const scrollDown = () =>
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

  const send = async () => {
    if (running) return;
    // 스케치가 있으면 래스터화해 첨부(소비 후 지움 — 재전송 방지·프리뷰 정리)
    const sketch = hasSketch() ? rasterizeSketch() : null;
    const text = input.trim() || (sketch ? '첨부한 스케치대로 평면을 만들어줘.' : '');
    if (!text) return; // 텍스트도 스케치도 없음
    setInput('');
    setPlan(null);
    setLiveOps([]);
    setRunning(true);

    // 대화 transcript = user/assistant 턴만 (notice 제외)
    const transcript: TranscriptTurn[] = [
      ...msgs
        .filter((m): m is ChatMsg & { role: 'user' | 'assistant' } => m.role !== 'notice')
        .map((m): TranscriptTurn => ({ role: m.role, text: m.text })),
      { role: 'user', text },
    ];

    // 스트리밍 어시스턴트 메시지를 자리에 추가하고 델타로 갱신.
    // 스케치는 여기서 지우지 않는다 — 모델 역질문(opLog 빈)·오류·거부 시 재첨부해야 하므로
    // 승인(approve) 시에만 소비. (전송 실패로 손그림이 사라지는 것 방지)
    const userText = sketch ? `✏ ${text}` : text;
    setMsgs((prev) => [...prev, { role: 'user', text: userText }, { role: 'assistant', text: '' }]);
    scrollDown();

    try {
      const result = await runAgent({
        snapshot: store.snapshot(),
        transcript,
        sketch,
        onText: (delta) => {
          setMsgs((prev) => {
            const next = [...prev];
            const lastIdx = next.length - 1;
            next[lastIdx] = { role: 'assistant', text: next[lastIdx]!.text + delta };
            return next;
          });
          scrollDown();
        },
        onOp: (summary) => {
          setLiveOps((prev) => [...prev, summary]);
          scrollDown();
        },
      });
      if (result.opLog.length > 0) {
        setPlan({
          opLog: result.opLog,
          summaries: result.opLog.map(opSummary),
          ...(result.note ? { note: result.note } : {}),
        });
      }
    } catch (e) {
      setMsgs((prev) => {
        // 스트리밍 자리로 만든 빈 어시스턴트 버블 제거 후 오류 표시
        const next =
          prev.length && prev[prev.length - 1]!.role === 'assistant' && !prev[prev.length - 1]!.text
            ? prev.slice(0, -1)
            : [...prev];
        return [...next, { role: 'notice', text: `오류: ${e instanceof Error ? e.message : e}` }];
      });
    } finally {
      setRunning(false);
      setLiveOps([]);
      scrollDown();
    }
  };

  const approve = () => {
    if (!plan) return;
    clearSketch(); // 계획 승인 = 스케치 소비 (프리뷰 정리)
    const result = applyOpLog(store, plan.opLog);
    const failNote = result.failed.length
      ? ` (${result.failed.length}건 실패: ${result.failed[0]!.error})`
      : '';
    setMsgs((prev) => [
      ...prev,
      { role: 'notice', text: `✓ ${result.applied}개 작업 적용됨${failNote}` },
    ]);
    setPlan(null);
    scrollDown();
  };

  const reject = () => {
    setPlan(null);
    setMsgs((prev) => [...prev, { role: 'notice', text: '계획을 거부했습니다 — 문서 무변경' }]);
    scrollDown();
  };

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="ai-title">AI 모드</span>
        <span className="ai-sub">계획 검토 후 승인해야 반영됩니다</span>
        <button className="ai-close" onClick={() => useUiStore.getState().setAiOpen(false)}>
          ✕
        </button>
      </div>
      <div className="ai-msgs" ref={listRef}>
        {msgs.length === 0 && (
          <div className="ai-empty">
            예: "3m×4m 방 하나 만들어줘. 남쪽 벽에 문, 동쪽 벽에 창 하나."
            <br />
            ✏ 스케치 도구로 평면을 그린 뒤 보내면 손그림대로 만들어줍니다.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            {m.text || (running && i === msgs.length - 1 ? '…' : '')}
          </div>
        ))}
        {running && liveOps.length > 0 && (
          <div className="ai-msg notice">
            {liveOps.map((s, i) => (
              <div key={i}>· {s}</div>
            ))}
          </div>
        )}
        {plan && (
          <div className="ai-plan">
            <div className="ai-plan-title">계획 — {plan.opLog.length}개 작업</div>
            {plan.note && <div className="ai-plan-note">⚠ {plan.note}</div>}
            <ol>
              {plan.summaries.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <div className="ai-plan-actions">
              <button className="ai-approve" onClick={approve}>
                승인 — 문서에 적용
              </button>
              <button className="ai-reject" onClick={reject}>
                거부
              </button>
            </div>
          </div>
        )}
      </div>
      {sketchOn && (
        <div className="ai-sketch-chip">
          <span>✏ 스케치 첨부됨 — 보내면 손그림대로 생성</span>
          <button onClick={() => clearSketch()}>지우기</button>
        </div>
      )}
      <div className="ai-input">
        <input
          value={input}
          placeholder={running ? '계획 작성 중…' : sketchOn ? '스케치 설명(선택) 후 보내기' : '무엇을 모델링할까요?'}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // isComposing 가드 — 한글 조합 확정 Enter가 전송을 쏘면 안 됨
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send();
          }}
        />
        <button disabled={running || (!input.trim() && !sketchOn)} onClick={() => void send()}>
          보내기
        </button>
      </div>
    </div>
  );
}
