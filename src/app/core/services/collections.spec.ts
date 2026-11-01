import { TestBed } from '@angular/core/testing';
import { BlueprintService } from './blueprint.service';
import { parseProject } from './project-storage.service';

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
});
