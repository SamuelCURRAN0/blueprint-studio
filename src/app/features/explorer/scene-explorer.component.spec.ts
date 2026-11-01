import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SceneExplorerComponent } from './scene-explorer.component';
import { BlueprintService } from '../../core/services/blueprint.service';
import { parseProject } from '../../core/services/project-storage.service';

describe('collections and Explorer menus', () => {
  let fixture: ComponentFixture<SceneExplorerComponent>;
  let explorer: SceneExplorerComponent;
  let state: BlueprintService;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SceneExplorerComponent] }).compileComponents();
    fixture = TestBed.createComponent(SceneExplorerComponent);
    explorer = fixture.componentInstance;
    state = TestBed.inject(BlueprintService);
    state.project.update((p) => ({
      ...p,
      points: [
        { id: 'a', x: 0, y: 1, z: 0 },
        { id: 'b', x: 2, y: 3, z: 0 },
      ],
      edges: [{ id: 'edge-1', startPointId: 'a', endPointId: 'b' }],
      objects: [{ ...p.objects[0], pointIds: ['a', 'b'], edgeIds: ['edge-1'] }],
      layers: [...p.layers, { id: 'layer-2', name: 'Details', visible: true, locked: false }],
    }));
    await fixture.whenStable();
  });
  function button(label: string): HTMLButtonElement {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('[role="menuitem"]') as NodeListOf<HTMLButtonElement>,
    );
    const found = buttons.find((b) => b.textContent?.replace(/\s+/g, ' ').trim().startsWith(label));
    expect(found, label).toBeDefined();
    return found!;
  }
  async function context(selector: string): Promise<void> {
    const element = fixture.nativeElement.querySelector(selector) as HTMLElement;
    expect(element).not.toBeNull();
    const event = new MouseEvent('contextmenu', {
      clientX: 100,
      clientY: 100,
      button: 2,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    await fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="menu"]')).not.toBeNull();
  }
  async function rename(value: string): Promise<void> {
    const input = fixture.nativeElement.querySelector('[data-rename]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    input.value = value;
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
  }
  it('creates and names a collection, moves an object into it through right-click, and expands/collapses its contents', async () => {
    (
      fixture.nativeElement.querySelector('[aria-label="Create collection"]') as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    await rename('Frame');
    const collection = state.project().collections![0];
    const points = structuredClone(state.project().points);
    await context('[data-object-id="object-1"]');
    expect(explorer.context()?.target.kind).toBe('object');
    button('Move to collection').click();
    await fixture.whenStable();
    button('Frame').click();
    await fixture.whenStable();
    expect(state.activeObject()?.collectionId).toBe(collection.id);
    expect(
      fixture.nativeElement.querySelector('.collection-objects [data-object-id="object-1"]'),
    ).not.toBeNull();
    const toggle = fixture.nativeElement.querySelector(
      '[aria-label="Toggle collection Frame"]',
    ) as HTMLButtonElement;
    toggle.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.collection-objects')).toBeNull();
    toggle.click();
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('.collection-objects [data-object-id="object-1"]'),
    ).not.toBeNull();
    expect(state.project().points).toEqual(points);
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
  });
  function dragData() {
    const values = new Map<string, string>();
    return {
      effectAllowed: 'none',
      dropEffect: 'none',
      types: [] as string[],
      setData(type: string, value: string) {
        values.set(type, value);
        this.types = [...values.keys()];
      },
      getData(type: string) {
        return values.get(type) ?? '';
      },
    };
  }
  function dragEvent(
    target: Element,
    type: string,
    data: ReturnType<typeof dragData>,
    relatedTarget: EventTarget | null = null,
  ): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      dataTransfer: { value: data },
      relatedTarget: { value: relatedTarget },
    });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }
  function objectDrag() {
    const source = fixture.nativeElement.querySelector(
      '[data-object-id="object-1"] .object-select',
    ) as HTMLButtonElement;
    expect(source.draggable).toBe(true);
    const data = dragData();
    dragEvent(source, 'dragstart', data);
    return { source, data };
  }
  it('drags into a highlighted collapsed collection, expands it and preserves geometry with one undo step', async () => {
    const id = state.createCollection()!;
    explorer.toggleCollection(id);
    await fixture.whenStable();
    state.history.clear();
    const before = structuredClone(state.project());
    const { data } = objectDrag();
    expect(data.effectAllowed).toBe('move');
    const target = fixture.nativeElement.querySelector(
      `[data-drop-collection-id="${id}"]`,
    ) as HTMLElement;
    expect(dragEvent(target, 'dragover', data).defaultPrevented).toBe(true);
    expect(target.classList.contains('drop-target')).toBe(true);
    expect(data.dropEffect).toBe('move');
    dragEvent(target, 'drop', data);
    await fixture.whenStable();
    expect(state.activeObject()?.collectionId).toBe(id);
    expect(explorer.collapsed().has(id)).toBe(false);
    expect(explorer.draggingObjectId()).toBeNull();
    expect(fixture.nativeElement.querySelector('.drop-target')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.collection-objects [data-object-id="object-1"]'),
    ).not.toBeNull();
    expect(state.project().points).toEqual(before.points);
    expect(state.project().edges).toEqual(before.edges);
    expect(state.activeObject()?.layerId).toBe('layer-1');
    state.undo();
    expect(state.project()).toEqual(before);
    expect(state.history.canUndo()).toBe(false);
    state.redo();
    expect(state.activeObject()?.collectionId).toBe(id);
  });
  it('drags between collections and back to an Ungrouped target that appears while dragging', async () => {
    state.createCollection('object-1');
    const second = state.createCollection()!;
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-drop-ungrouped]')).toBeNull();
    let { data } = objectDrag();
    expect(fixture.nativeElement.querySelector('[data-drop-ungrouped]')).not.toBeNull();
    let target = fixture.nativeElement.querySelector(
      `[data-drop-collection-id="${second}"] .collection-name`,
    ) as HTMLElement;
    dragEvent(target, 'dragover', data);
    dragEvent(target, 'drop', data);
    await fixture.whenStable();
    expect(state.activeObject()?.collectionId).toBe(second);
    ({ data } = objectDrag());
    target = fixture.nativeElement.querySelector('[data-drop-ungrouped]') as HTMLElement;
    dragEvent(target, 'dragover', data);
    expect(target.classList.contains('drop-target')).toBe(true);
    dragEvent(target, 'drop', data);
    await fixture.whenStable();
    expect(state.activeObject()?.collectionId).toBeUndefined();
    expect(target.querySelector('[data-object-id="object-1"]')).not.toBeNull();
  });
  it('ignores same-collection drops and clears feedback on leaving, drag end, Escape or model changes', async () => {
    const current = state.createCollection('object-1')!;
    const other = state.createCollection()!;
    await fixture.whenStable();
    state.history.clear();
    let { source, data } = objectDrag();
    const same = fixture.nativeElement.querySelector(
      `[data-drop-collection-id="${current}"]`,
    ) as HTMLElement;
    expect(dragEvent(same, 'dragover', data).defaultPrevented).toBe(false);
    dragEvent(same, 'drop', data);
    expect(state.history.canUndo()).toBe(false);
    ({ source, data } = objectDrag());
    const target = fixture.nativeElement.querySelector(
      `[data-drop-collection-id="${other}"]`,
    ) as HTMLElement;
    dragEvent(target, 'dragover', data);
    dragEvent(target, 'dragleave', data, target.querySelector('.collection-name'));
    expect(explorer.dropTarget()).toBe(other);
    dragEvent(target, 'dragleave', data);
    expect(explorer.dropTarget()).toBeUndefined();
    dragEvent(target, 'dragover', data);
    dragEvent(source, 'dragend', data);
    expect(explorer.draggingObjectId()).toBeNull();
    expect(explorer.dropTarget()).toBeUndefined();
    ({ data } = objectDrag());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(explorer.draggingObjectId()).toBeNull();
    dragEvent(target, 'drop', data);
    expect(state.activeObject()?.collectionId).toBe(current);
    expect(state.history.canUndo()).toBe(false);
    objectDrag();
    state.renameProject('Updated');
    await fixture.whenStable();
    expect(explorer.draggingObjectId()).toBeNull();
  });
  it('rejects external or mismatched drag payloads', async () => {
    const id = state.createCollection()!;
    await fixture.whenStable();
    const before = state.project();
    const target = fixture.nativeElement.querySelector(
      `[data-drop-collection-id="${id}"]`,
    ) as HTMLElement;
    const external = dragData();
    external.setData('application/x-blueprint-object', 'object-1');
    expect(dragEvent(target, 'dragover', external).defaultPrevented).toBe(false);
    dragEvent(target, 'drop', external);
    expect(state.project()).toBe(before);
    const { data } = objectDrag();
    data.setData('application/x-blueprint-object', 'different-object');
    dragEvent(target, 'drop', data);
    expect(state.project()).toBe(before);
  });
  it('adds objects to a collection and removes the collection without deleting its objects', async () => {
    const id = state.createCollection('object-1')!;
    await fixture.whenStable();
    await context(`[data-collection-id="${id}"]`);
    button('Add object to collection').click();
    await fixture.whenStable();
    expect(state.project().objects).toHaveLength(2);
    expect(state.activeObject()?.collectionId).toBe(id);
    const before = structuredClone(state.project());
    await context(`[data-collection-id="${id}"]`);
    button('Remove collection (keep objects)').click();
    await fixture.whenStable();
    expect(state.project().objects).toHaveLength(2);
    expect(state.project().objects.every((o) => !o.collectionId)).toBe(true);
    expect(state.project().points).toEqual(before.points);
    state.undo();
    expect(state.project()).toEqual(before);
  });
  it('hides and shows a collapsed collection using its eye button and right-click menu', async () => {
    const id = state.createCollection('object-1')!;
    const name = state.project().collections![0].name;
    explorer.toggleCollection(id);
    await fixture.whenStable();
    const hide = fixture.nativeElement.querySelector(
      `[aria-label="Hide collection ${name}"]`,
    ) as HTMLButtonElement;
    expect(hide).not.toBeNull();
    hide.click();
    await fixture.whenStable();
    expect(state.project().collections![0].visible).toBe(false);
    expect(state.visiblePoints()).toEqual([]);
    expect(
      fixture.nativeElement.querySelector(`[aria-label="Show collection ${name}"]`),
    ).not.toBeNull();
    await context(`[data-collection-id="${id}"]`);
    button('Show collection').click();
    await fixture.whenStable();
    expect(state.visiblePoints()).toHaveLength(2);
    expect(explorer.collapsed().has(id)).toBe(true);
    await context(`[data-collection-id="${id}"]`);
    button('Hide collection').click();
    await fixture.whenStable();
    expect(state.visiblePoints()).toEqual([]);
    state.undo();
    expect(state.visiblePoints()).toHaveLength(2);
    expect(state.project().objects[0].visible).toBe(true);
  });
  it('creates a new collection from an object in one undo step and supports renaming and moving back to Ungrouped', async () => {
    await context('[data-object-id="object-1"]');
    button('Move to collection').click();
    await fixture.whenStable();
    state.history.clear();
    button('New collection with this object').click();
    await fixture.whenStable();
    const id = state.activeObject()!.collectionId!;
    const input = fixture.nativeElement.querySelector('[data-rename]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    state.undo();
    await fixture.whenStable();
    expect(state.project().collections).toBeUndefined();
    expect(state.activeObject()?.collectionId).toBeUndefined();
    state.redo();
    await fixture.whenStable();
    await context(`[data-collection-id="${id}"]`);
    button('Rename collection').click();
    await fixture.whenStable();
    await rename('Running gear');
    expect(state.project().collections![0].name).toBe('Running gear');
    await context('[data-object-id="object-1"]');
    button('Rename object').click();
    await fixture.whenStable();
    await rename('Front axle');
    expect(state.activeObject()?.name).toBe('Front axle');
    await context('[data-object-id="object-1"]');
    button('Move to collection').click();
    await fixture.whenStable();
    button('Ungrouped').click();
    expect(state.activeObject()?.collectionId).toBeUndefined();
  });
  it('changes an object layer from Explorer and protects locked objects from deletion', async () => {
    state.updateLayer('layer-2', { plane: { axis: 'z', value: 8 } });
    await fixture.whenStable();
    await context('[data-object-id="object-1"]');
    button('Change layer').click();
    await fixture.whenStable();
    button('Details').click();
    await fixture.whenStable();
    expect(state.activeObject()?.layerId).toBe('layer-2');
    expect(state.project().points.every((p) => p.z === 8)).toBe(true);
    await context('[data-object-id="object-1"]');
    button('Lock object').click();
    await fixture.whenStable();
    await context('[data-object-id="object-1"]');
    expect(button('Delete object').disabled).toBe(true);
    expect(button('Change layer').disabled).toBe(true);
    button('Unlock object').click();
    await fixture.whenStable();
    const before = structuredClone(state.project());
    await context('[data-object-id="object-1"]');
    button('Delete object').click();
    expect(state.project().points).toEqual([]);
    expect(state.project().edges).toEqual([]);
    state.undo();
    expect(state.project()).toEqual(before);
  });
  it('opens from the keyboard, navigates and closes with Escape, outside click, or a model change', async () => {
    const object = fixture.nativeElement.querySelector(
      '[data-object-id="object-1"] .object-select',
    ) as HTMLButtonElement;
    object.focus();
    state.pointContextMenu.set({
      view: 'front',
      pointId: 'a',
      pointIds: ['a'],
      position: { u: 10, v: 10 },
    });
    object.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }),
    );
    await fixture.whenStable();
    expect(state.pointContextMenu()).toBeNull();
    expect(explorer.context()?.target.kind).toBe('object');
    button('Move to collection').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(button('Change layer'));
    button('Change layer').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(explorer.context()).toBeNull();
    await context('[data-object-id="object-1"]');
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(explorer.context()).toBeNull();
    await context('[data-object-id="object-1"]');
    state.renameProject('Changed');
    await fixture.whenStable();
    expect(explorer.context()).toBeNull();
  });
});
