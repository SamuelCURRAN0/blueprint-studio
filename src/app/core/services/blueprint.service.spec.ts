import { TestBed } from '@angular/core/testing';
import { BlueprintService } from './blueprint.service';
import { projectPoint } from '../geometry/geometry';
import { ReferenceImage } from '../models/blueprint';

const reference: ReferenceImage = {
  name: 'Front.png',
  dataUrl: 'data:image/png;base64,YQ==',
  pixelWidth: 800,
  pixelHeight: 400,
  centerU: 0,
  centerV: 0,
  width: 10,
  opacity: 0.5,
  visible: true,
};

describe('shared blueprint state', () => {
  let state: BlueprintService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    state = TestBed.inject(BlueprintService);
  });
  function add(): string {
    state.addClick('front', { u: 2, v: 3 });
    state.addClick('side', { u: 5, v: 99 });
    return state.selectedId()!;
  }
  it('does not create a point from a single projection, and constrains the second', () => {
    state.addClick('front', { u: 2, v: 3 });
    expect(state.project().points).toHaveLength(0);
    state.hover('side', { u: 5, v: 99 });
    expect(state.preview()).toMatchObject({ x: 2, y: 5, z: 3 });
    state.addClick('side', { u: 5, v: 99 });
    expect(state.project().points).toHaveLength(1);
    expect(projectPoint(state.project().points[0], 'top')).toEqual({ u: 2, v: 5 });
  });
  it('cancels pending geometry without adding anything', () => {
    state.addClick('top', { u: -4, v: 2 });
    state.cancel();
    expect(state.pending()).toBeNull();
    expect(state.project().points).toHaveLength(0);
  });
  it('moves the shared point while edges retain IDs and the hidden coordinate', () => {
    const a = add();
    const b = add();
    state.setTool('edge');
    state.connect(a);
    state.connect(b);
    state.move(a, 'front', { u: 10, v: 20 });
    expect(state.project().points.find((p) => p.id === a)).toMatchObject({ x: 10, y: 5, z: 20 });
    expect(state.project().edges[0]).toMatchObject({ startPointId: a, endPointId: b });
    state.deletePoint(a);
    expect(state.project().edges).toHaveLength(0);
  });
  it('protects locked objects and layers and excludes hidden geometry', () => {
    const id = add();
    state.updateObject('object-1', { locked: true });
    state.move(id, 'top', { u: 99, v: 99 });
    state.deletePoint(id);
    expect(state.project().points[0]).toMatchObject({ x: 2, y: 5, z: 3 });
    state.updateObject('object-1', { locked: false });
    state.updateLayer('layer-1', { locked: true });
    expect(state.isEditable(id)).toBe(false);
    state.updateLayer('layer-1', { visible: false });
    expect(state.visiblePoints()).toHaveLength(0);
  });
  it('creates a rectangle on an explicit construction plane', () => {
    state.planeDepth.set(-2);
    state.rectangleClick('top', { u: -1, v: 1 });
    state.rectangleClick('top', { u: 3, v: 5 });
    expect(state.project().points).toHaveLength(4);
    expect(state.project().edges).toHaveLength(4);
    expect(state.project().points.every((p) => p.z === -2)).toBe(true);
  });
  it('connects successive two-view polyline points as one operation per point', () => {
    state.setTool('polyline');
    add();
    add();
    expect(state.project().points).toHaveLength(2);
    expect(state.project().edges).toHaveLength(1);
    const previous = state.history.undo(state.project())!;
    expect(previous.points).toHaveLength(1);
    expect(previous.edges).toHaveLength(0);
  });
  it('traces single-click points in each view at the explicit hidden-axis depth', () => {
    state.setPointPlacement('plane');
    state.planeDepth.set(-4);
    for (const view of ['front', 'side', 'top'] as const) state.addClick(view, { u: 2, v: 3 });
    expect(state.project().points.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
      { x: 2, y: -4, z: 3 },
      { x: -4, y: 2, z: 3 },
      { x: 2, y: 3, z: -4 },
    ]);
    expect(state.pending()).toBeNull();
    state.undo();
    expect(state.project().points).toHaveLength(2);
    state.redo();
    expect(state.project().points).toHaveLength(3);
  });
  it('connects traced polyline points and keeps each new segment in one undo step', () => {
    state.setPointPlacement('plane');
    state.setTool('polyline');
    state.addClick('top', { u: 1, v: 2 });
    state.addClick('top', { u: 3, v: 4 });
    expect(state.project().edges).toHaveLength(1);
    state.undo();
    expect(state.project().points).toHaveLength(1);
    expect(state.project().edges).toHaveLength(0);
  });
  it('cancels unfinished projections when switching placement and respects locks and invalid depth', () => {
    state.addClick('front', { u: 2, v: 3 });
    state.setPointPlacement('plane');
    expect(state.pending()).toBeNull();
    state.planeDepth.set(NaN);
    state.addClick('front', { u: 2, v: 3 });
    expect(state.project().points).toHaveLength(0);
    state.planeDepth.set(0);
    state.updateLayer('layer-1', { locked: true });
    state.addClick('front', { u: 2, v: 3 });
    expect(state.project().points).toHaveLength(0);
    state.updateLayer('layer-1', { locked: false });
    state.setPointPlacement('two-views');
    add();
    expect(state.project().points[0]).toMatchObject({ x: 2, y: 5, z: 3 });
  });
  it('undoes reference changes per view and preserves traced geometry when removing an image', () => {
    state.setReferenceImage('front', reference);
    state.setReferenceImage('top', { ...reference, name: 'Top.png' });
    state.updateReferenceImage('front', { width: 20, centerU: -3, visible: false });
    expect(state.project().referenceImages?.top?.name).toBe('Top.png');
    state.undo();
    expect(state.project().referenceImages?.front).toEqual(reference);
    state.setPointPlacement('plane');
    state.addClick('front', { u: 2, v: 3 });
    state.removeReferenceImage('front');
    expect(state.project().referenceImages?.front).toBeUndefined();
    expect(state.project().points).toHaveLength(1);
    state.undo();
    expect(state.project().referenceImages?.front).toEqual(reference);
    expect(state.project().points).toHaveLength(1);
  });
});
