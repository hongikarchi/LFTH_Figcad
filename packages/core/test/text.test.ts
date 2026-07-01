import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { DeriveCache } from '../src/geometry';
import { lint } from '../src/lint';
import { elementFootprint } from '../src/select';
import type { TextElement } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

describe('텍스트 주석 (back-compat — 생성 UI·AI 제거, 스토어 API·스키마·렌더만 보존)', () => {
  it('createText → 라벨 채널 + 픽 프록시', () => {
    const { store, seed } = setup();
    const id = store.createText({ levelId: seed.levelId, at: [1000, 2000], text: '거실' });
    const geo = new DeriveCache().derive(store, id)!;
    expect(geo.labels?.[0]).toMatchObject({ text: '거실', style: 'text' });
    expect(geo.positions.length).toBeGreaterThan(0); // 픽 프록시
  });

  it('updateElement 문자열/위치 + 이동/복사 (at)', () => {
    const { store, seed } = setup();
    const id = store.createText({ levelId: seed.levelId, at: [0, 0], text: 'A' });
    store.updateElement(id, { text: '침실', at: [10.4, 20.6] });
    const t = store.getElement(id) as TextElement;
    expect(t.text).toBe('침실');
    expect(t.at).toEqual([10, 21]);
    store.moveElements([id], [100, 200]);
    expect((store.getElement(id) as TextElement).at).toEqual([110, 221]);
    const [copy] = store.duplicateElements([id], [500, 0]);
    expect((store.getElement(copy!) as TextElement).at).toEqual([610, 221]);
  });

  it('풋프린트 = 점, lint 클린', () => {
    const { store, seed } = setup();
    const id = store.createText({ levelId: seed.levelId, at: [1000, 1000], text: '주방' });
    expect(elementFootprint(store.getElement(id)!, store)).toEqual({ kind: 'point', p: [1000, 1000] });
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
  });
});
