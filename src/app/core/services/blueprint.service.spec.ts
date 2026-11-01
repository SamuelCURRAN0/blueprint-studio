import { TestBed } from '@angular/core/testing';
import { BlueprintService } from './blueprint.service';
import { projectPoint } from '../geometry/geometry';
import { ReferenceImage } from '../models/blueprint';
import { parseProject } from './project-storage.service';

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
  it.each([
    { axis: 'x', view: 'side', expected: { x: -4, y: 2, z: 3 } },
    { axis: 'y', view: 'front', expected: { x: 2, y: -4, z: 3 } },
    { axis: 'y', view: 'back', expected: { x: -2, y: -4, z: 3 } },
    { axis: 'z', view: 'top', expected: { x: 2, y: 3, z: -4 } },
    { axis: 'z', view: 'bottom', expected: { x: -2, y: 3, z: -4 } },
  ] as const)(
    'places $axis-fixed layer points in one click in $view',
    ({ axis, view, expected }) => {
      state.updateLayer('layer-1', { plane: { axis, value: -4 } });
      state.addClick(view, { u: 2, v: 3 });
      expect(state.selected()).toMatchObject(expected);
      expect(state.pending()).toBeNull();
    },
  );
  it('captures a selected coordinate, aligns existing points, and preserves the constraint through edits and history', () => {
    const a = add(),
      b = add();
    state.setCoordinate('z', 7);
    state.setLayerAxis('layer-1', 'z');
    expect(state.activeLayer()?.plane).toEqual({ axis: 'z', value: 7 });
    expect(state.project().points.every((p) => p.z === 7)).toBe(true);
    state.select(a);
    state.move(a, 'front', { u: 6, v: 90 });
    state.setCoordinate('z', 100);
    expect(state.selected()).toMatchObject({ x: 6, z: 7 });
    state.setLayerValue('layer-1', -2);
    expect(state.project().points.every((p) => p.z === -2)).toBe(true);
    state.undo();
    expect(state.project().points.every((p) => p.z === 7)).toBe(true);
    state.redo();
    expect(state.project().points.every((p) => p.z === -2)).toBe(true);
    state.setLayerAxis('layer-1', '');
    state.setCoordinate('z', 8);
    expect(state.selected()?.z).toBe(8);
    expect(state.project().points.find((p) => p.id === b)?.z).toBe(-2);
  });
  it('constrains two-view previews and polyline placement and draws rectangles at the layer depth', () => {
    state.updateLayer('layer-1', { plane: { axis: 'z', value: 8 } });
    state.setTool('polyline');
    state.addClick('front', { u: 2, v: 99 });
    state.hover('side', { u: 5, v: 0 });
    expect(state.preview()).toMatchObject({ x: 2, y: 5, z: 8 });
    state.addClick('side', { u: 5, v: 0 });
    state.addClick('top', { u: 3, v: 4 });
    expect(state.project().points.every((p) => p.z === 8)).toBe(true);
    expect(state.project().edges).toHaveLength(1);
    state.rectangleClick('front', { u: 0, v: 0 });
    expect(state.rectangle()).toBeNull();
    state.rectangleClick('top', { u: 0, v: 0 });
    state.rectangleClick('top', { u: 2, v: 3 });
    expect(state.project().points).toHaveLength(6);
    expect(state.project().points.every((p) => p.z === 8)).toBe(true);
  });
  it('creates only an empty layer as one undo step, preserves selection, and aligns explicitly assigned objects', () => {
    const a = add();
    state.updateLayer('layer-1', { plane: { axis: 'z', value: 4 } });
    const objects = state.project().objects;
    const points = state.project().points;
    const layerId = state.createLayer();
    const layer = state.project().layers.find((l) => l.id === layerId)!;
    expect(layer.id).not.toBe('layer-1');
    expect(state.project().objects).toBe(objects);
    expect(state.project().points).toBe(points);
    expect(state.activeObjectId()).toBe('object-1');
    expect(state.selectedId()).toBe(a);
    state.activateLayer(layerId);
    expect(state.project().objects).toBe(objects);
    expect(state.selectedId()).toBe(a);
    state.undo();
    expect(state.project().layers).toHaveLength(1);
    expect(state.project().objects).toHaveLength(1);
    state.redo();
    state.updateLayer(layer.id, { plane: { axis: 'y', value: 9 } });
    state.updateObject('object-1', { layerId: layer.id });
    expect(state.project().points.find((p) => p.id === a)?.y).toBe(9);
    state.deleteLayer(layer.id);
    expect(state.project().points.find((p) => p.id === a)?.z).toBe(4);
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
  });
  it('translates multi-selection by a shared delta, preserving hidden coordinates, with one undo step', () => {
    const a = add(),
      b = add();
    state.setCoordinate('x', 5);
    state.select(a);
    state.select(b, true);
    expect(state.selectedIds()).toEqual([a, b]);
    state.setCoordinate('x', 10);
    expect(state.project().points.map((p) => p.x)).toEqual([7, 10]);
    expect(state.project().points.every((p) => p.y === 5 && p.z === 3)).toBe(true);
    state.undo();
    expect(state.project().points.map((p) => p.x)).toEqual([2, 5]);
    state.select(b, true);
    expect(state.selectedIds()).toEqual([a]);
  });
  it('moves a mixed-layer selection only along shared free axes and skips locked points', () => {
    const a = add();
    state.updateLayer('layer-1', { plane: { axis: 'z', value: 3 } });
    state.createObject(state.createLayer());
    const b = add();
    state.selectMany([a, b]);
    state.translateSelection({ x: 2, y: 4, z: 50 });
    expect(state.project().points.every((p) => p.x === 4 && p.y === 9 && p.z === 3)).toBe(true);
    state.updateObject(state.project().objects[1].id, { locked: true });
    state.translateSelection({ x: 1 });
    expect(state.project().points.map((p) => p.x)).toEqual([5, 4]);
    state.deleteSelected();
    expect(state.project().points.map((p) => p.id)).toEqual([b]);
    state.undo();
    expect(state.project().points).toHaveLength(2);
  });
  it('rejects out-of-range group moves atomically and invalid or locked layer settings', () => {
    const a = add(),
      b = add();
    state.setCoordinate('x', 1e9);
    state.selectMany([a, b]);
    const before = state.project();
    state.translateSelection({ x: 1 });
    expect(state.project()).toBe(before);
    state.updateLayer('layer-1', { plane: { axis: 'z', value: NaN } });
    expect(state.project()).toBe(before);
    state.updateLayer('layer-1', { locked: true });
    state.setLayerAxis('layer-1', 'z');
    expect(state.activeLayer()?.plane).toBeUndefined();
  });
  it('protects locked object coordinates when configuring or transferring fixed layers', () => {
    add();
    state.createObject(state.createLayer());
    const sourceId = state.activeLayer()!.id;
    const b = add();
    const objectId = state.activeObjectId();
    state.updateObject(objectId, { locked: true });
    state.updateLayer(sourceId, { plane: { axis: 'z', value: 50 } });
    expect(state.activeLayer()?.plane).toBeUndefined();
    state.updateLayer('layer-1', { plane: { axis: 'z', value: 50 } });
    state.updateObject(objectId, { layerId: 'layer-1' });
    state.deleteLayer(sourceId);
    expect(state.project().layers).toHaveLength(2);
    expect(state.project().points.find((p) => p.id === b)?.z).toBe(3);
    state.updateObject(objectId, { locked: false });
    state.deleteLayer(sourceId);
    expect(state.project().points.every((p) => p.z === 50)).toBe(true);
  });
  it('duplicates selected points and internal edges with unique ownership, selects copies, and undoes the entire copy', () => {
    state.rectangleClick('top', { u: 0, v: 0 });
    state.rectangleClick('top', { u: 2, v: 3 });
    const original = structuredClone(state.project());
    state.selectMany(original.points.slice(0, 3).map((p) => p.id));
    state.duplicateSelected();
    const copies = state.project().points.slice(4);
    expect(copies).toHaveLength(3);
    expect(state.project().edges).toHaveLength(6);
    expect(state.selectedIds()).toEqual(copies.map((p) => p.id));
    expect(state.tool()).toBe('move');
    expect(
      state
        .project()
        .edges.slice(4)
        .every(
          (e) =>
            state.selectedIds().includes(e.startPointId) &&
            state.selectedIds().includes(e.endPointId),
        ),
    ).toBe(true);
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
    state.undo();
    expect(state.project()).toEqual(original);
    expect(state.selectedIds()).toEqual([]);
    state.redo();
    expect(state.project().points).toHaveLength(7);
  });
  it('keeps duplicates in their original objects and ignores locked or hidden selections', () => {
    const a = add();
    state.createObject(state.createLayer());
    const layer = state.activeLayer()!.id;
    const b = add();
    state.selectMany([a, b]);
    state.duplicateSelected();
    expect(state.project().objects.map((o) => o.pointIds.length)).toEqual([2, 2]);
    state.updateLayer(layer, { locked: true });
    state.selectMany([b]);
    state.duplicateSelected();
    expect(state.project().points).toHaveLength(4);
    state.selectMany([a, b]);
    state.updateLayer(layer, { visible: false });
    expect(state.selectedIds()).toEqual([a]);
    state.updateLayer(layer, { visible: true });
    expect(state.selectedIds()).toEqual([a]);
  });
  it('moves a subset to another object with internal edges, removes boundary edges and restores everything in one undo', () => {
    state.rectangleClick('top', { u: 0, v: 0 });
    state.rectangleClick('top', { u: 2, v: 3 });
    const [a, b, c, d] = state.project().points.map((p) => p.id);
    state.createObject();
    const target = state.activeObjectId();
    const existing = add();
    state.selectMany([a, b]);
    const before = structuredClone(state.project());
    state.history.clear();
    state.moveSelectedToObject(target);
    expect(state.project().objects[0].pointIds).toEqual([c, d]);
    expect(state.project().objects[1].pointIds).toEqual([existing, a, b]);
    expect(state.project().objects.map((o) => o.edgeIds.length)).toEqual([1, 1]);
    expect(state.project().edges).toHaveLength(2);
    expect(state.project().edges.some((e) => e.startPointId === a && e.endPointId === b)).toBe(
      true,
    );
    expect(state.project().points).toEqual(before.points);
    expect(state.activeObjectId()).toBe(target);
    expect(state.selectedIds()).toEqual([a, b]);
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
    state.undo();
    expect(state.project()).toEqual(before);
    expect(state.history.canUndo()).toBe(false);
    state.redo();
    expect(state.project().objects[1].pointIds).toEqual([existing, a, b]);
  });
  it('combines points from multiple sources without duplicating target points or affecting its existing connections', () => {
    const a = add();
    state.createObject();
    const b = add();
    state.createObject();
    const lockedObject = state.activeObjectId();
    const lockedPoint = add();
    state.updateObject(lockedObject, { locked: true });
    state.createObject();
    const target = state.activeObjectId();
    state.rectangleClick('top', { u: 0, v: 0 });
    state.rectangleClick('top', { u: 2, v: 3 });
    const existingIds = state.activeObject()!.pointIds;
    const existingEdges = structuredClone(state.project().edges);
    state.selectMany([a, b, lockedPoint, existingIds[0]]);
    state.moveSelectedToObject(target);
    expect(state.activeObject()!.pointIds).toEqual([...existingIds, a, b]);
    expect(state.project().objects.find((o) => o.id === lockedObject)?.pointIds).toEqual([
      lockedPoint,
    ]);
    expect(state.project().edges).toEqual(existingEdges);
    expect(state.selectedIds()).toEqual([a, b, existingIds[0]]);
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
  });
  it('applies the destination layer plane and releases the source plane when reassigning points', () => {
    const a = add();
    state.updateLayer('layer-1', { plane: { axis: 'z', value: 3 } });
    state.createObject(state.createLayer());
    const target = state.activeObjectId();
    const targetLayer = state.activeLayer()!.id;
    state.updateLayer(targetLayer, { plane: { axis: 'y', value: -4 } });
    state.select(a);
    state.moveSelectedToObject(target);
    expect(state.selected()).toMatchObject({ id: a, x: 2, y: -4, z: 3 });
    state.move(a, 'front', { u: 10, v: 20 });
    expect(state.selected()).toMatchObject({ x: 10, y: -4, z: 20 });
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
  });
  it('rejects transfers to missing, locked or hidden objects and layers without a history entry', () => {
    const a = add();
    state.createObject(state.createLayer());
    const target = state.activeObjectId();
    const layer = state.activeLayer()!.id;
    state.select(a);
    for (const patch of [{ locked: true }, { visible: false }]) {
      state.updateObject(target, { locked: false, visible: true, ...patch });
      state.history.clear();
      const before = state.project();
      state.moveSelectedToObject(target);
      expect(state.project()).toBe(before);
      expect(state.history.canUndo()).toBe(false);
    }
    state.updateObject(target, { locked: false, visible: true });
    for (const patch of [{ locked: true }, { visible: false }]) {
      state.updateLayer(layer, { locked: false, visible: true, ...patch });
      state.history.clear();
      const before = state.project();
      state.moveSelectedToObject(target);
      state.moveSelectedToObject('missing');
      expect(state.project()).toBe(before);
      expect(state.history.canUndo()).toBe(false);
    }
  });
  it('creates and moves Bottom points consistently and requires another plane to complete them', () => {
    state.addClick('top', { u: 10, v: 3 });
    state.hover('bottom', { u: -2, v: 3 });
    expect(state.preview()).toBeNull();
    state.addClick('bottom', { u: -2, v: 3 });
    expect(state.project().points).toHaveLength(0);
    state.addClick('front', { u: 99, v: 5 });
    expect(state.selected()).toMatchObject({ x: 2, y: 3, z: 5 });
    state.move(state.selectedId()!, 'bottom', { u: 4, v: 6 });
    expect(state.selected()).toMatchObject({ x: -4, y: 6, z: 5 });
    state.setPointPlacement('plane');
    state.planeDepth.set(-7);
    state.addClick('bottom', { u: 2, v: 3 });
    expect(state.selected()).toMatchObject({ x: -2, y: 3, z: -7 });
  });
  it('creates and edits canonical points from Back and never uses Front/Back alone as two planes', () => {
    state.addClick('front', { u: 10, v: 3 });
    state.hover('back', { u: -2, v: 3 });
    expect(state.preview()).toBeNull();
    state.addClick('back', { u: -2, v: 3 });
    expect(state.project().points).toHaveLength(0);
    state.addClick('side', { u: 5, v: 99 });
    expect(state.selected()).toMatchObject({ x: 2, y: 5, z: 3 });
    state.move(state.selectedId()!, 'back', { u: 4, v: 6 });
    expect(state.selected()).toMatchObject({ x: -4, y: 5, z: 6 });
    state.setPointPlacement('plane');
    state.planeDepth.set(-7);
    state.addClick('back', { u: 2, v: 3 });
    expect(state.selected()).toMatchObject({ x: -2, y: -7, z: 3 });
  });
  it('rotates a reference per view with undo/redo and reset while preserving geometry', () => {
    add();
    const points = structuredClone(state.project().points);
    state.setReferenceImage('front', reference);
    state.setReferenceImage('top', { ...reference, rotation: 15 });
    state.rotateReferenceImage('front', 90);
    expect(state.project().referenceImages?.front?.rotation).toBe(90);
    state.rotateReferenceImage('front', 90);
    expect(state.project().referenceImages?.front?.rotation).toBe(-180);
    state.undo();
    expect(state.project().referenceImages?.front?.rotation).toBe(90);
    state.redo();
    expect(state.project().referenceImages?.front?.rotation).toBe(-180);
    state.updateReferenceImage('front', { rotation: -37.5 });
    expect(state.project().referenceImages?.front?.rotation).toBe(-37.5);
    state.updateReferenceImage('front', { rotation: 0 });
    expect(state.project().referenceImages?.front?.rotation).toBe(0);
    expect(state.project().referenceImages?.top?.rotation).toBe(15);
    expect(state.project().points).toEqual(points);
  });
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
