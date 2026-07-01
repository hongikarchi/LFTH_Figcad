import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';

const CAM = { target: [1, 2, 3] as [number, number, number], distance: 25, theta: 0.5, phi: 0.7 };

function setup(): DocStore {
  const s = new DocStore();
  seedDocument(s);
  return s;
}

describe('뷰포인트(저장 단면) 채널', () => {
  it('addViewpoint → 자동 index·name (커스텀 이름 우선), listViewpoints 정렬', () => {
    const s = setup();
    s.addViewpoint({ camera: CAM, viewMode: '3d', clip: { axis: 'x', t: 0.5, flip: false }, author: '나' });
    s.addViewpoint({ camera: CAM, viewMode: 'plan', clip: null, author: '나', name: '메인 단면' });
    const list = s.listViewpoints();
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('단면 1');
    expect(list[0]!.index).toBe(1);
    expect(list[1]!.name).toBe('메인 단면');
    expect(list[1]!.index).toBe(2);
    expect(list[0]!.clip).toEqual({ axis: 'x', t: 0.5, flip: false });
    expect(list[1]!.clip).toBeNull();
    expect(list[0]!.camera.target).toEqual([1, 2, 3]);
    expect(list[0]!.viewMode).toBe('3d');
  });

  it('rename(trim) · delete', () => {
    const s = setup();
    const id = s.addViewpoint({ camera: CAM, viewMode: '3d', clip: null, author: '나' });
    s.renameViewpoint(id, '  로비 단면 ');
    expect(s.listViewpoints()[0]!.name).toBe('로비 단면');
    s.renameViewpoint(id, '   '); // 빈 이름 무시
    expect(s.listViewpoints()[0]!.name).toBe('로비 단면');
    s.deleteViewpoint(id);
    expect(s.listViewpoints()).toHaveLength(0);
  });

  it('snapshot 라운드트립 — fromSnapshot 보존 (클립 float 무손실)', () => {
    const s = setup();
    s.addViewpoint({ camera: CAM, viewMode: '3d', clip: { axis: 'y', t: 0.33, flip: true }, author: '나' });
    const snap = s.snapshot();
    expect(snap.viewpoints).toHaveLength(1);
    const s2 = DocStore.fromSnapshot(snap);
    const vp = s2.listViewpoints()[0]!;
    expect(vp.clip).toEqual({ axis: 'y', t: 0.33, flip: true });
    expect(vp.camera.phi).toBeCloseTo(0.7);
  });

  it('동시 저장(concurrent) — 인덱스 로컬 계산: 둘 다 index=3 가능. 데이터 손실 없음(id 상이), 표시명만 중복', () => {
    // 알려진 CRDT 한계(리뷰): 두 사용자가 각자 [1,2] 상태서 동시에 저장하면 둘 다 max+1=3.
    // 서버 조율 없이는 불가피. "N번 단면 봐주세요" 참조 안정성 위해 stored index 유지(삭제 시 재번호 안 함).
    const a = setup();
    const b = setup();
    a.addViewpoint({ camera: CAM, viewMode: '3d', clip: null, author: 'A' });
    a.addViewpoint({ camera: CAM, viewMode: '3d', clip: null, author: 'A' });
    b.addViewpoint({ camera: CAM, viewMode: '3d', clip: null, author: 'B' });
    b.addViewpoint({ camera: CAM, viewMode: '3d', clip: null, author: 'B' });
    const idA = a.addViewpoint({ camera: CAM, viewMode: '3d', clip: null, author: 'A' });
    const idB = b.addViewpoint({ camera: CAM, viewMode: '3d', clip: null, author: 'B' });
    expect(a.listViewpoints()[2]!.index).toBe(3);
    expect(b.listViewpoints()[2]!.index).toBe(3); // 동일 index(중복 표시명) — 하지만
    expect(idA).not.toBe(idB); // id 상이 → CRDT 병합 시 둘 다 생존(데이터 손실 없음)
  });

  it('importSnapshot — 커밋복원(viewpoints 부재)=보존, JSON백업(명시)=교체', () => {
    const s = setup();
    s.addViewpoint({ camera: CAM, viewMode: '3d', clip: null, author: '나' });
    // 커밋 복원 시뮬(viewpoints 필드 부재) → 라이브 뷰포인트 보존
    const commitSnap = s.snapshot();
    delete (commitSnap as { viewpoints?: unknown }).viewpoints;
    s.importSnapshot(commitSnap);
    expect(s.listViewpoints()).toHaveLength(1);
    // JSON 백업(viewpoints=[] 명시) → 교체(비움)
    s.importSnapshot({ ...s.snapshot(), viewpoints: [] });
    expect(s.listViewpoints()).toHaveLength(0);
  });
});
