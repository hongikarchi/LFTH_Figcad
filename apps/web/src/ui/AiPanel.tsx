import { useEffect, useRef, useState } from 'react';
import { applyOpLog, opSummary, KIND_LABEL, type DocStore, type OpLogEntry } from '@figcad/core';
import { useUiStore, type AiModelId } from '../state/uiStore';
import { runAgent, type AiLintFinding, type TranscriptTurn } from '../ai/agentClient';
import { clearSketch, hasSketch, onSketchChange, rasterizeSketch } from '../ai/sketchCapture';
import { fileToAttachment, type ImageAttachment } from '../ai/imageAttach';
import { startVoice, voiceSupported } from '../ai/voiceInput';

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
  lintFindings?: AiLintFinding[];
}

export function AiPanel({ store }: { store: DocStore }) {
  // AI = peer 모드(피드백). aiOpen 게이트 대신 activeMode==='ai'서 보임 — 단 항상 mount(챗 history 보존).
  const activeMode = useUiStore((s) => s.activeMode);
  const selection = useUiStore((s) => s.selection);
  const aiModel = useUiStore((s) => s.aiModel);
  const aiAutoApply = useUiStore((s) => s.aiAutoApply);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [liveOps, setLiveOps] = useState<string[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sketchOn, setSketchOn] = useState(hasSketch());
  // 생각 과정 — 임시(transcript/msgs 미저장 → context 무증가). running 중에만 표시.
  const [thinking, setThinking] = useState('');
  const [thinkOpen, setThinkOpen] = useState(false);
  const [imageAtt, setImageAtt] = useState<ImageAttachment | null>(null);
  const [listening, setListening] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<{ stop: () => void } | null>(null);
  const voiceOk = voiceSupported();

  useEffect(() => onSketchChange(() => setSketchOn(hasSketch())), []);

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImageAtt(await fileToAttachment(file));
    } catch {
      window.alert('이미지 처리 실패');
    }
  };
  const toggleVoice = () => {
    if (listening) {
      voiceRef.current?.stop();
      return;
    }
    const h = startVoice(
      (t) => setInput(t),
      () => {
        setListening(false);
        voiceRef.current = null;
      },
    );
    if (h) {
      voiceRef.current = h;
      setListening(true);
    }
  };

  const scrollDown = () =>
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

  const send = async () => {
    if (running) return;
    // 스케치가 있으면 래스터화해 첨부(소비 후 지움 — 재전송 방지·프리뷰 정리)
    const sketch = hasSketch() ? rasterizeSketch() : null;
    const img = imageAtt;
    const text =
      input.trim() ||
      (sketch ? '첨부한 스케치대로 평면을 만들어줘.' : img ? '첨부한 사진을 참고해 만들어줘.' : '');
    if (!text) return; // 텍스트·스케치·사진 전부 없음
    setInput('');
    setImageAtt(null);
    setPlan(null);
    setLiveOps([]);
    setThinking('');
    setThinkOpen(false);
    setRunning(true);

    // 선택 grounding(피드백) — 현재 선택 요소를 프롬프트에 명시해 "이거/이 벽"이 해소되게.
    // 서버 변경 없이 클라가 ref를 덧붙임(에이전트는 이미 문서 스냅샷 보유 → id로 해소).
    const selRefs = useUiStore
      .getState()
      .selection.map((id) => {
        const el = store.getElement(id);
        return el ? `${KIND_LABEL[el.kind] ?? el.kind} #${id}` : null;
      })
      .filter(Boolean);
    const groundedText = selRefs.length
      ? `${text}\n(참조: 사용자가 캔버스에서 선택한 요소 = ${selRefs.join(', ')}. "이거/이 ~" 등은 이 요소를 가리킴.)`
      : text;

    // 대화 transcript = user/assistant 턴만 (notice 제외)
    const transcript: TranscriptTurn[] = [
      ...msgs
        .filter((m): m is ChatMsg & { role: 'user' | 'assistant' } => m.role !== 'notice')
        .map((m): TranscriptTurn => ({ role: m.role, text: m.text })),
      { role: 'user', text: groundedText },
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
        image: img,
        model: useUiStore.getState().aiModel,
        onThinking: (delta) => {
          setThinking((p) => p + delta);
          setThinkOpen(true);
          scrollDown();
        },
        onText: (delta) => {
          setMsgs((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            // critic notice가 중간에 끼면 마지막이 assistant가 아닐 수 있음 →
            // 새 assistant 버블 시작(델타가 notice를 덮어쓰지 않게)
            if (last && last.role === 'assistant') {
              next[next.length - 1] = { role: 'assistant', text: last.text + delta };
            } else {
              next.push({ role: 'assistant', text: delta });
            }
            return next;
          });
          scrollDown();
        },
        onOp: (summary) => {
          setLiveOps((prev) => [...prev, summary]);
          scrollDown();
        },
        onLint: (round, findings) => {
          // critic이 결정적 lint error를 발견해 모델에 수정 재요청 중
          setMsgs((prev) => [
            ...prev,
            {
              role: 'notice',
              text: `🔍 자동검증 ${round}회 — ${findings.length}건 수정 요청: ${findings
                .map((f) => f.message)
                .join('; ')}`,
            },
          ]);
          scrollDown();
        },
      });
      if (result.opLog.length > 0) {
        const built: Plan = {
          opLog: result.opLog,
          summaries: result.opLog.map(opSummary),
          ...(result.note ? { note: result.note } : {}),
          ...(result.lintFindings?.length ? { lintFindings: result.lintFindings } : {}),
        };
        // auto mode = 카드 없이 즉시 적용(undo 가능). 단 에러 잔존(critic 2라운드 후)이면 게이트로 fallback
        // (BIM은 기하 틀리면 사람 검토가 안전). 안전 근거: ops=zod+서버 lint critic → 임의코드와 다름.
        const hasErr = !!result.lintFindings?.some((f) => f.severity === 'error');
        if (useUiStore.getState().aiAutoApply && !hasErr) applyPlan(built);
        else setPlan(built);
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
      setThinkOpen(false); // 답 도착 → 생각 블록 접기(텍스트 유지 — 다음 전송 시 비움. transcript엔 안 들어감)
      scrollDown();
    }
  };

  // 순수 적용 — auto mode가 setPlan 직후 호출해도 stale closure 안 타게 plan 객체를 인자로 받음.
  const applyPlan = (p: Plan) => {
    clearSketch(); // 적용 = 스케치 소비 (프리뷰 정리)
    const result = applyOpLog(store, p.opLog);
    const failNote = result.failed.length
      ? ` (${result.failed.length}건 실패: ${result.failed[0]!.error})`
      : '';
    setMsgs((prev) => [
      ...prev,
      { role: 'notice', text: `✓ ${result.applied}개 작업 적용됨${failNote}` },
    ]);
    scrollDown();
  };

  const approve = () => {
    if (!plan) return;
    applyPlan(plan);
    setPlan(null);
  };

  const reject = () => {
    setPlan(null);
    setMsgs((prev) => [...prev, { role: 'notice', text: '계획을 거부했습니다 — 문서 무변경' }]);
    scrollDown();
  };

  return (
    <div className={`ai-panel ${activeMode === 'ai' ? '' : 'ai-hidden'}`}>
      <div className="ai-head">
        <span className="ai-title">AI 모드</span>
        <div className="ai-controls">
          <select
            className="ai-model"
            value={aiModel}
            disabled={running}
            title="모델 — 정확(Opus)·균형(Sonnet)·빠름(Haiku)"
            onChange={(e) => useUiStore.getState().setAiModel(e.target.value as AiModelId)}
          >
            <option value="claude-opus-4-8">정확</option>
            <option value="claude-sonnet-4-6">균형</option>
            <option value="claude-haiku-4-5-20251001">빠름</option>
          </select>
          <label className="ai-auto" title="자동적용 — 계획 승인 없이 바로 반영(Ctrl+Z로 되돌리기)">
            <input
              type="checkbox"
              checked={aiAutoApply}
              onChange={(e) => useUiStore.getState().setAiAutoApply(e.target.checked)}
            />
            자동
          </label>
        </div>
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
        {thinking && (
          <div className="ai-thinking">
            <button className="ai-thinking-toggle" onClick={() => setThinkOpen((o) => !o)}>
              💭 {running ? '생각 중…' : '생각 과정'} {thinkOpen ? '▾' : '▸'}
            </button>
            {thinkOpen && <div className="ai-thinking-body">{thinking}</div>}
          </div>
        )}
        {running && liveOps.length > 0 && (
          <div className="ai-msg notice ai-progress">
            {liveOps.map((s, i) => (
              <div key={i}>⚙ {s}</div>
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
            {plan.lintFindings?.length ? (
              <div className="ai-plan-lint">
                {plan.lintFindings.map((f, i) => (
                  <div key={i} className={`ai-lint-${f.severity}`}>
                    {f.severity === 'error' ? '✖' : '⚠'} {f.message}
                  </div>
                ))}
              </div>
            ) : null}
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
      {selection.length > 0 && (
        <div className="ai-ref-chip">
          📌 참조 {selection.length}개 선택됨 — "이거/이 ~"로 지시 가능
        </div>
      )}
      {sketchOn && (
        <div className="ai-sketch-chip">
          <span>✏ 스케치 첨부됨 — 보내면 손그림대로 생성</span>
          <button onClick={() => clearSketch()}>지우기</button>
        </div>
      )}
      {imageAtt && (
        <div className="ai-sketch-chip">
          <span>📷 사진 첨부됨 — 보내면 참고해 생성</span>
          <button onClick={() => setImageAtt(null)}>지우기</button>
        </div>
      )}
      <div className="ai-input">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void pickImage(e.target.files?.[0]);
            e.target.value = ''; // 같은 파일 재선택 허용
          }}
        />
        <button
          className="ai-icon-btn"
          title="사진 첨부 — 참고 이미지(카메라/앨범)"
          disabled={running}
          onClick={() => fileRef.current?.click()}
        >
          📷
        </button>
        {voiceOk && (
          <button
            className={`ai-icon-btn ${listening ? 'active' : ''}`}
            title="음성 입력 (한국어)"
            disabled={running}
            onClick={toggleVoice}
          >
            🎤
          </button>
        )}
        <input
          value={input}
          placeholder={
            running ? '계획 작성 중…' : listening ? '듣는 중…' : sketchOn ? '스케치 설명(선택)' : imageAtt ? '사진 설명(선택)' : '무엇을 모델링할까요?'
          }
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // isComposing 가드 — 한글 조합 확정 Enter가 전송을 쏘면 안 됨
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send();
          }}
        />
        <button disabled={running || (!input.trim() && !sketchOn && !imageAtt)} onClick={() => void send()}>
          보내기
        </button>
      </div>
    </div>
  );
}
