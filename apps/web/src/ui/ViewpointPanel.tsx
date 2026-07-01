import type { DocStore } from '@figcad/core';
import { useDocVersion, type ViewActions } from './App';

/**
 * 뷰포인트(저장 단면) 패널 — 협업·리뷰 레일. 현재 카메라+단면(클립)을 "단면 N"으로 저장(문서·전원 공유),
 * 목록 클릭 = 그 카메라+단면으로 점프("3번 단면 봐주세요"). 데이터=store.viewpoints 채널, 지오메트리 아님.
 */
export function ViewpointPanel({ store, actions }: { store: DocStore; actions: ViewActions }) {
  useDocVersion(store);
  const vps = store.listViewpoints();
  return (
    <div className="rail-section vp-panel">
      <div className="vp-head">
        <span className="vp-title">단면 뷰포인트</span>
        <button className="vp-save" onClick={() => actions.saveViewpoint()} title="현재 카메라+단면을 저장">
          ＋ 현재 뷰
        </button>
      </div>
      {vps.length === 0 ? (
        <div className="vp-hint">현재 카메라·단면을 저장해 “3번 단면 봐주세요”로 팀에 공유하세요.</div>
      ) : (
        <ul className="vp-list">
          {vps.map((vp) => (
            <li key={vp.id} className="vp-item">
              <button className="vp-open" onClick={() => actions.jumpViewpoint(vp)} title="이 뷰포인트로 점프">
                <span className={`vp-badge ${vp.clip ? 'cut' : ''}`}>{vp.clip ? '단면' : '뷰'}</span>
                <span className="vp-name">{vp.name}</span>
                <span className="vp-author">{vp.author}</span>
              </button>
              <button className="vp-del" onClick={() => store.deleteViewpoint(vp.id)} title="삭제">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
