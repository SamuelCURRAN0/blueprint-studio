import { TestBed } from '@angular/core/testing';
import { BlueprintService } from './blueprint.service';
import { parseProject } from './project-storage.service';
import { exportSvg } from '../geometry/export';

describe('object collections', () => {
  let state: BlueprintService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    state = TestBed.inject(BlueprintService);
    state.rectangleClick('top', { u: 0, v: 0 });
    state.rectangleClick('top', { u: 2, v: 3 });
    state.history.clear();
  });
  it('creates a collection containing an existing object in one undo step without moving geometry or changing its layer', () => {
    const before = structuredClone(state.project());
    const id = state.createCollection('object-1')!;
    expect(state.project().collections).toHaveLength(1);
    expect(state.activeObject()?.collectionId).toBe(id);
    expect(state.project().points).toEqual(before.points);
    expect(state.project().edges).toEqual(before.edges);
    expect(state.activeObject()?.layerId).toBe('layer-1');
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
    state.undo();
    expect(state.project()).toEqual(before);
    expect(state.history.canUndo()).toBe(false);
    state.redo();
    expect(state.activeObject()?.collectionId).toBe(id);
  });
  it('moves objects between collections and Ungrouped, and makes new objects in the active collection', () => {
    const first = state.createCollection('object-1')!;
    const second = state.createCollection()!;
    state.createObject();
    expect(state.activeObject()?.collectionId).toBe(first);
    state.moveObjectToCollection('object-1', second);
    expect(state.project().objects[0].collectionId).toBe(second);
    state.moveObjectToCollection('object-1', null);
    expect(state.project().objects[0].collectionId).toBeUndefined();
    state.createObject(undefined, true, second);
    expect(state.activeObject()?.collectionId).toBe(second);
    state.createObject(undefined, true, null);
    expect(state.activeObject()?.collectionId).toBeUndefined();
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
  });
  it('renames collections, rejects invalid/no-op changes and removes a collection while keeping all its objects and geometry', () => {
    const id = state.createCollection('object-1')!;
    state.renameCollection(id, '  Chassis  ');
    expect(state.project().collections?.[0].name).toBe('Chassis');
    state.history.clear();
    const before = structuredClone(state.project());
    state.renameCollection(id, ' ');
    state.renameCollection(id, 'Chassis');
    state.moveObjectToCollection('object-1', id);
    state.moveObjectToCollection('object-1', 'missing');
    state.deleteCollection('missing');
    expect(state.createCollection('missing')).toBeNull();
    expect(state.history.canUndo()).toBe(false);
    state.deleteCollection(id);
    expect(state.project().collections).toEqual([]);
    expect(state.project().objects[0].collectionId).toBeUndefined();
    expect(state.project().points).toEqual(before.points);
    expect(state.project().edges).toEqual(before.edges);
    state.undo();
    expect(state.project()).toEqual(before);
  });
  it('keeps grouping separate from visibility, locks and fixed layers, and protects locked object deletion', () => {
    state.updateLayer('layer-1', { plane: { axis: 'z', value: 7 } });
    state.updateObject('object-1', { locked: true, visible: false });
    const before = structuredClone(state.project().points);
    const id = state.createCollection('object-1')!;
    expect(state.activeObject()?.collectionId).toBe(id);
    state.deleteObject('object-1');
    expect(state.project().objects).toHaveLength(1);
    state.deleteCollection(id);
    expect(state.activeObject()).toMatchObject({
      locked: true,
      visible: false,
      layerId: 'layer-1',
    });
    expect(state.project().points).toEqual(before);
    expect(state.visiblePoints()).toEqual([]);
  });
  it('hides and shows collection geometry as one undo step without changing individual object visibility', () => {
    const id = state.createCollection('object-1')!;
    const pointIds = state.activeObject()!.pointIds;
    state.createObject();
    state.setPointPlacement('plane');
    state.addClick('top', { u: 9, v: 9 });
    state.updateObject(state.activeObjectId(), { visible: false });
    state.selectMany(pointIds);
    const points = state.project().points,
      edges = state.project().edges;
    state.history.clear();
    state.setCollectionVisibility(id, false);
    expect(state.visiblePoints()).toEqual([]);
    expect(state.selectedIds()).toEqual([]);
    expect(state.isEditable(pointIds[0])).toBe(false);
    expect(state.canCreate()).toBe(false);
    state.move(pointIds[0], 'top', { u: 50, v: 50 });
    state.deleteEdge(edges[0].id);
    state.addClick('top', { u: 6, v: 6 });
    state.selectAll();
    expect(state.selectedIds()).toEqual([]);
    expect(state.project().points).toBe(points);
    expect(state.project().edges).toBe(edges);
    expect(state.project().objects.map((o) => o.visible)).toEqual([true, false]);
    state.undo();
    expect(state.visiblePoints()).toHaveLength(4);
    expect(state.history.canUndo()).toBe(false);
    state.redo();
    expect(state.visiblePoints()).toEqual([]);
    state.setCollectionVisibility(id, true);
    expect(state.visiblePoints()).toHaveLength(4);
    expect(state.project().objects[1].visible).toBe(false);
    expect(state.selectedIds()).toEqual([]);
  });
  it('combines collection, object and layer visibility and ignores unchanged or missing collection toggles', () => {
    const id = state.createCollection('object-1')!;
    state.history.clear();
    state.setCollectionVisibility(id, true);
    state.setCollectionVisibility('missing', false);
    expect(state.history.canUndo()).toBe(false);
    state.setCollectionVisibility(id, false);
    state.updateLayer('layer-1', { visible: false });
    state.setCollectionVisibility(id, true);
    expect(state.visiblePoints()).toEqual([]);
    state.updateLayer('layer-1', { visible: true });
    expect(state.visiblePoints()).toHaveLength(4);
    state.updateObject('object-1', { visible: false });
    state.setCollectionVisibility(id, false);
    state.setCollectionVisibility(id, true);
    expect(state.visiblePoints()).toEqual([]);
  });
  it('applies hidden collections to reassignment, drawing targets and SVG exports, and restores visibility on Ungrouped', () => {
    const id = state.createCollection()!;
    state.setCollectionVisibility(id, false);
    state.moveObjectToCollection('object-1', id);
    expect(state.selectedIds()).toEqual([]);
    state.createObject('layer-1', true, null);
    const visibleObject = state.activeObjectId();
    state.setPointPlacement('plane');
    state.addClick('top', { u: 9, v: 9 });
    state.activateObject('object-1');
    state.activateLayer('layer-1');
    expect(state.activeObjectId()).toBe(visibleObject);
    const svg = exportSvg(state.project(), 'top', state.project().points);
    expect(svg).not.toContain('<line');
    expect(svg.match(/<circle/g)).toHaveLength(1);
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
    state.moveObjectToCollection('object-1', null);
    expect(state.visiblePoints()).toHaveLength(5);
  });
});
