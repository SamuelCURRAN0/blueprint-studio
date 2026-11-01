import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ViewportComponent } from './viewport.component';
import { BlueprintService } from '../../core/services/blueprint.service';
import { referenceCorners } from '../../core/geometry/reference-image';
import { worldToScreen } from '../../core/geometry/geometry';
import { parseProject } from '../../core/services/project-storage.service';
import { PointContextMenuComponent } from './point-context-menu.component';
import { By } from '@angular/platform-browser';

describe('viewport interactions', () => {
  let fixture: ComponentFixture<ViewportComponent>;
  let viewport: ViewportComponent;
  let state: BlueprintService;
  let canvas: HTMLCanvasElement;

  beforeEach(async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await TestBed.configureTestingModule({ imports: [ViewportComponent] }).compileComponents();
    fixture = TestBed.createComponent(ViewportComponent);
    fixture.componentRef.setInput('view', 'front');
    viewport = fixture.componentInstance;
    state = TestBed.inject(BlueprintService);
    state.project.update((project) => ({
      ...project,
      points: [
        { id: 'a', x: 0, y: 1, z: 0 },
        { id: 'b', x: 0, y: 3, z: 0 },
        { id: 'c', x: 2, y: 1, z: 0 },
        { id: 'd', x: 2, y: 3, z: 0 },
        { id: 'e', x: 4, y: 1, z: 1 },
      ],
      objects: project.objects.map((object) => ({
        ...object,
        pointIds: ['a', 'b', 'c', 'd', 'e'],
      })),
    }));
    viewport.size.set({ width: 400, height: 300 });
    viewport.transform.set({ scale: 40, panX: 100, panY: 100 });
    await fixture.whenStable();
    canvas = viewport.canvas().nativeElement;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => false);
    canvas.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function clickAt(u: number, v: number): void {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: rect.left + u,
        clientY: rect.top + v,
        button: 0,
        bubbles: true,
      }),
    );
    fixture.detectChanges();
  }
  function choose(id: string): void {
    const index = viewport.pointChoices().findIndex((choice) => choice.point.id === id);
    const buttons = fixture.nativeElement.querySelectorAll(
      '[data-point-choice]',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[index].click();
    fixture.detectChanges();
  }
  async function addReference(rotation = 0): Promise<void> {
    state.setReferenceImage('front', {
      name: 'reference.png',
      dataUrl: 'data:image/png;base64,YQ==',
      pixelWidth: 800,
      pixelHeight: 400,
      centerU: 0,
      centerV: 0,
      width: 4,
      rotation,
      opacity: 0.5,
      visible: true,
    });
    state.history.clear();
    state.setTool('move-reference');
    await fixture.whenStable();
  }
  it.each([
    { base: 'front', opposite: 'back', title: 'Back' },
    { base: 'top', opposite: 'bottom', title: 'Bottom' },
  ] as const)(
    'switches $base/$opposite in the same canvas while keeping images, adjustments and cameras independent',
    async ({ base, opposite, title }) => {
      await addReference(30);
      fixture.componentRef.setInput('view', base);
      if (base === 'top')
        state.setReferenceImage('top', {
          ...state.project().referenceImages!.front!,
          name: 'Top.png',
        });
      const front = state.project().referenceImages![base]!;
      const back = {
        ...front,
        name: `${title}.png`,
        dataUrl: 'data:image/png;base64,Yg==',
        width: 9,
        rotation: -15,
        centerU: 1,
      };
      state.setReferenceImage(opposite, back);
      await fixture.whenStable();
      const points = structuredClone(state.project().points);
      const frontCamera = { scale: 30, panX: 25, panY: 70 };
      viewport.transform.set(frontCamera);
      state.pending.set({ view: base, position: { u: 2, v: 3 } });
      (
        fixture.nativeElement.querySelector(
          `[aria-label="Switch to ${title} view"]`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(viewport.view()).toBe(opposite);
      expect(state.activeView()).toBe(opposite);
      expect(state.pending()).toBeNull();
      expect(viewport.canvas().nativeElement).toBe(canvas);
      expect(viewport.scene().project.referenceImages?.[viewport.scene().view]).toEqual(back);
      const backCamera = { scale: 55, panX: 100, panY: 120 };
      viewport.transform.set(backCamera);
      state.updateReferenceImage(opposite, { width: 12, rotation: 45, centerV: -3 });
      viewport.switchFacing();
      expect(viewport.view()).toBe(base);
      expect(viewport.transform()).toEqual(frontCamera);
      expect(state.project().referenceImages?.[base]).toEqual(front);
      viewport.switchFacing();
      expect(viewport.transform()).toEqual(backCamera);
      expect(state.project().referenceImages?.[opposite]).toMatchObject({
        width: 12,
        rotation: 45,
        centerV: -3,
      });
      expect(state.project().points).toEqual(points);
      expect(fixture.nativeElement.querySelectorAll('canvas')).toHaveLength(1);
    },
  );
  function pointer(
    type: string,
    u: number,
    v: number,
    options: MouseEventInit = {},
    pointerId = 1,
  ): void {
    const rect = canvas.getBoundingClientRect();
    const event = new MouseEvent(type, {
      clientX: rect.left + u,
      clientY: rect.top + v,
      button: 0,
      bubbles: true,
      ...options,
    });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    canvas.dispatchEvent(event);
    fixture.detectChanges();
  }
  async function openContext(u: number, v: number): Promise<HTMLElement> {
    const rect = canvas.getBoundingClientRect();
    const event = new MouseEvent('contextmenu', {
      clientX: rect.left + u,
      clientY: rect.top + v,
      button: 2,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);
    await fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    const menu = fixture.nativeElement.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    return menu;
  }
  function menuButton(label: string): HTMLButtonElement {
    const button = Array.from(
      fixture.nativeElement.querySelectorAll('[role="menuitem"]') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.replace(/\s+/g, ' ').trim().startsWith(label));
    expect(button, `Menu action: ${label}`).toBeDefined();
    return button!;
  }
  it('right-clicks a point without drawing and deletes it with its connections as one undo step', async () => {
    state.setTool('edge');
    state.connect('c');
    state.connect('e');
    state.setTool('add');
    state.pending.set({ view: 'front', position: { u: 1, v: 1 } });
    const before = structuredClone(state.project());
    await fixture.whenStable();
    await openContext(260, 60);
    expect(state.tool()).toBe('select');
    expect(state.pending()).toBeNull();
    expect(state.selectedIds()).toEqual(['e']);
    expect(state.project()).toEqual(before);
    menuButton('Delete point').click();
    await fixture.whenStable();
    expect(state.project().points.some((p) => p.id === 'e')).toBe(false);
    expect(state.project().edges).toEqual([]);
    expect(state.pointContextMenu()).toBeNull();
    expect(document.activeElement).toBe(canvas);
    state.undo();
    expect(state.project()).toEqual(before);
  });
  it('keeps a right-clicked group selected for duplication and can choose the exact overlapping point for deletion', async () => {
    state.selectMany(['a', 'c']);
    await openContext(100, 100);
    expect(state.selectedIds()).toEqual(['a', 'c']);
    menuButton('Duplicate selected points').click();
    await fixture.whenStable();
    expect(state.project().points).toHaveLength(7);
    expect(state.selectedIds()).toHaveLength(2);
    expect(state.selectedIds().every((id) => !['a', 'c'].includes(id))).toBe(true);
    state.undo();
    await fixture.whenStable();
    state.select(null);
    await openContext(100, 100);
    menuButton('Choose overlapping point').click();
    await fixture.whenStable();
    menuButton('P2').click();
    await fixture.whenStable();
    expect(state.selectedIds()).toEqual(['b']);
    expect(state.pointContextMenu()?.pointId).toBe('b');
    menuButton('Delete point').click();
    expect(state.project().points.some((p) => p.id === 'b')).toBe(false);
    expect(state.project().points.some((p) => p.id === 'a')).toBe(true);
  });
  it('moves selected points through the object submenu without changing ownership incorrectly', async () => {
    state.createObject();
    const target = state.activeObject()!;
    state.selectMany(['a', 'c']);
    await fixture.whenStable();
    await openContext(100, 100);
    menuButton('Move to object').click();
    await fixture.whenStable();
    menuButton(target.name).click();
    expect(state.activeObject()?.pointIds).toEqual(['a', 'c']);
    expect(parseProject(JSON.stringify(state.project()))).toEqual(state.project());
    state.undo();
    expect(state.project().objects[0].pointIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('changes the whole clicked object’s layer from the menu, aligning to the destination plane with undo', async () => {
    const layerId = state.createLayer();
    const layer = state.project().layers.find((l) => l.id === layerId)!;
    state.updateLayer(layer.id, { plane: { axis: 'z', value: 7 } });
    await fixture.whenStable();
    await openContext(260, 60);
    expect(state.selectedIds()).toEqual(['e']);
    menuButton("Change object's layer").click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="menu"]').textContent).toContain(
      'entire object',
    );
    menuButton(layer.name).click();
    expect(state.project().objects[0].layerId).toBe(layer.id);
    expect(state.project().points.every((p) => p.z === 7)).toBe(true);
    state.undo();
    expect(state.project().objects[0].layerId).toBe('layer-1');
    expect(state.project().points.find((p) => p.id === 'e')?.z).toBe(1);
  });
  it('disables editing locked points and offers selection actions on empty space', async () => {
    state.updateObject('object-1', { locked: true });
    await fixture.whenStable();
    await openContext(260, 60);
    expect(menuButton('Delete point').disabled).toBe(true);
    expect(menuButton('Duplicate point').disabled).toBe(true);
    expect(menuButton("Change object's layer").disabled).toBe(true);
    const before = state.project();
    menuButton('Delete point').click();
    expect(state.project()).toBe(before);
    menuButton('Select all points').click();
    await fixture.whenStable();
    expect(state.selectedIds()).toHaveLength(5);
    await openContext(320, 200);
    menuButton('Clear selection').click();
    expect(state.selectedIds()).toEqual([]);
  });
  it('supports keyboard navigation, fits small viewports and dismisses on Escape, outside click, zoom and model changes', async () => {
    viewport.size.set({ width: 220, height: 160 });
    state.select('e');
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }),
    );
    await fixture.whenStable();
    const component = fixture.debugElement.query(By.directive(PointContextMenuComponent))
      .componentInstance as PointContextMenuComponent;
    expect(component.layout().left + component.layout().width).toBeLessThanOrEqual(212);
    expect(component.layout().top + component.layout().maxHeight).toBeLessThanOrEqual(152);
    const duplicate = menuButton('Duplicate point');
    menuButton('Delete point').focus();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(duplicate);
    duplicate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(state.pointContextMenu()).toBeNull();
    expect(document.activeElement).toBe(canvas);
    await openContext(100, 100);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(state.pointContextMenu()).toBeNull();
    await openContext(100, 100);
    viewport.zoomAt(40);
    expect(state.pointContextMenu()).toBeNull();
    await openContext(100, 100);
    state.renameProject('Updated');
    await fixture.whenStable();
    expect(state.pointContextMenu()).toBeNull();
  });
  it('deletes through the advertised keyboard shortcut while the context menu is focused', async () => {
    await openContext(260, 60);
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    menuButton('Delete point').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(state.project().points.some((p) => p.id === 'e')).toBe(false);
    expect(state.pointContextMenu()).toBeNull();
    state.undo();
    expect(state.project().points.some((p) => p.id === 'e')).toBe(true);
  });
  it('toggles multiple points with Shift/Ctrl-click and keeps the group while dragging one selected point', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointerup', 100, 100);
    pointer('pointerdown', 180, 100, { shiftKey: true });
    expect(state.selectedIds()).toEqual(['a', 'c']);
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 120, 80);
    pointer('pointermove', 140, 60);
    pointer('pointerup', 140, 60);
    expect(state.selectedIds()).toEqual(['a', 'c']);
    expect(state.project().points.find((p) => p.id === 'a')).toMatchObject({ x: 1, y: 1, z: 1 });
    expect(state.project().points.find((p) => p.id === 'c')).toMatchObject({ x: 3, y: 1, z: 1 });
    state.undo();
    expect(state.project().points.find((p) => p.id === 'a')?.x).toBe(0);
    expect(state.project().points.find((p) => p.id === 'c')?.x).toBe(2);
    expect(state.history.canUndo()).toBe(false);
    pointer('pointerdown', 180, 100, { ctrlKey: true });
    expect(state.selectedIds()).toEqual(['a']);
  });
  it('box-selects projected points in either direction, including overlapping points, with additive selection', () => {
    state.select('e');
    pointer('pointerdown', 200, 120, { shiftKey: true });
    pointer('pointermove', 80, 80, { shiftKey: true });
    expect(viewport.scene().selectionBox).toEqual({ a: { u: 200, v: 120 }, b: { u: 80, v: 80 } });
    expect(state.selectedIds()).toEqual(['e', 'a', 'b', 'c', 'd']);
    pointer('pointerup', 80, 80);
    expect(viewport.scene().selectionBox).toBeNull();
    pointer('pointerdown', 200, 120);
    pointer('pointermove', 150, 80);
    pointer('pointerup', 150, 80);
    expect(state.selectedIds()).toEqual(['c', 'd']);
    expect(state.history.canUndo()).toBe(false);
  });
  it('drags duplicated points rather than the overlapping originals', () => {
    state.selectMany(['a', 'c']);
    state.duplicateSelected();
    const copies = state.selectedIds();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 60);
    pointer('pointerup', 140, 60);
    expect(state.selectedIds()).toEqual(copies);
    expect(state.project().points.find((p) => p.id === 'a')?.x).toBe(0);
    expect(state.project().points.find((p) => p.id === copies[0])).toMatchObject({ x: 1, z: 1 });
    expect(state.project().points.find((p) => p.id === copies[1])).toMatchObject({ x: 3, z: 1 });
  });
  it('restores the previous selection when a box selection is cancelled', () => {
    state.select('e');
    pointer('pointerdown', 200, 120);
    pointer('pointermove', 80, 80);
    expect(state.selectedIds()).toEqual(['a', 'b', 'c', 'd']);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(state.selectedIds()).toEqual(['e']);
    expect(viewport.selectionBox()).toBeNull();
  });
  it('moves a group in mirrored Bottom coordinates and cancels the whole drag with Escape', () => {
    fixture.componentRef.setInput('view', 'top');
    state.topFacing.set('bottom');
    state.selectMany(['a', 'c']);
    pointer('pointerdown', 100, 60);
    pointer('pointermove', 140, 20);
    expect(state.project().points.find((p) => p.id === 'a')).toMatchObject({ x: -1, y: 2, z: 0 });
    expect(state.project().points.find((p) => p.id === 'c')).toMatchObject({ x: 1, y: 2, z: 0 });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(state.project().points.find((p) => p.id === 'a')).toMatchObject({ x: 0, y: 1, z: 0 });
    expect(state.project().points.find((p) => p.id === 'c')).toMatchObject({ x: 2, y: 1, z: 0 });
    expect(state.history.canUndo()).toBe(false);
  });
  it('does not record a drag that only tries to move a fixed coordinate', () => {
    state.updateLayer('layer-1', { plane: { axis: 'z', value: 0 } });
    state.history.clear();
    state.selectMany(['a', 'c']);
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100, 20);
    pointer('pointerup', 100, 20);
    expect(state.history.canUndo()).toBe(false);
    expect(state.project().points.every((p) => p.z === 0)).toBe(true);
  });
  it.each([0, 1, 2, 3])(
    'resizes from corner %s, preserves the opposite corner and records one undo step',
    async (corner) => {
      await addReference(30);
      const image = state.project().referenceImages!.front!;
      const original = referenceCorners(image),
        anchor = original[(corner + 2) % 4];
      const points = structuredClone(state.project().points);
      const start = worldToScreen(original[corner], viewport.transform());
      const end = worldToScreen(
        {
          u: original[corner].u + (original[corner].u - anchor.u) / 2,
          v: original[corner].v + (original[corner].v - anchor.v) / 2,
        },
        viewport.transform(),
      );
      pointer('pointerdown', start.u, start.v);
      pointer('pointermove', (start.u + end.u) / 2, (start.v + end.v) / 2);
      pointer('pointermove', end.u, end.v);
      pointer('pointerup', end.u, end.v);
      const resized = state.project().referenceImages!.front!;
      expect(resized.width).toBeCloseTo(6);
      expect(resized.rotation).toBe(30);
      const fixed = referenceCorners(resized)[(corner + 2) % 4];
      expect(fixed.u).toBeCloseTo(anchor.u);
      expect(fixed.v).toBeCloseTo(anchor.v);
      expect(state.project().points).toEqual(points);
      expect(state.project().edges).toHaveLength(0);
      state.undo();
      expect(state.project().referenceImages!.front).toEqual(image);
      expect(state.history.canUndo()).toBe(false);
      state.redo();
      expect(state.project().referenceImages!.front!.width).toBeCloseTo(6);
    },
  );
  it('resizes at the current zoom and pan without jumping when grabbing near a handle', async () => {
    await addReference(90);
    state.updateReferenceImage('front', { width: 2, centerU: 1, centerV: -1 });
    state.history.clear();
    viewport.transform.set({ scale: 60, panX: 100, panY: 100 });
    const corners = referenceCorners(state.project().referenceImages!.front!);
    const start = worldToScreen(corners[0], viewport.transform());
    pointer('pointermove', start.u + 5, start.v - 3);
    expect(viewport.referenceResizeCursor()).toContain('resize');
    pointer('pointerdown', start.u + 5, start.v - 3);
    pointer('pointermove', start.u + 50, start.v - 93);
    pointer('pointerup', start.u + 50, start.v - 93);
    const image = state.project().referenceImages!.front!;
    expect(image.width).toBeCloseTo(3.5);
    const fixed = referenceCorners(image)[2];
    expect(fixed.u).toBeCloseTo(corners[2].u);
    expect(fixed.v).toBeCloseTo(corners[2].v);
  });
  it('restores image size and position when cancelling a resize with Escape', async () => {
    await addReference();
    const image = state.project().referenceImages!.front!;
    pointer('pointerdown', 20, 60);
    pointer('pointermove', -60, 20);
    expect(state.project().referenceImages!.front!.width).toBeCloseTo(6);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pointer('pointermove', -100, 0);
    expect(state.project().referenceImages!.front).toEqual(image);
    expect(viewport.draggingReference()).toBe(false);
    expect(viewport.referenceResizeCursor()).toBeNull();
  });
  it('drags a rotated reference freely over nodes without snapping or moving geometry, as one undo step', async () => {
    await addReference(30);
    const points = structuredClone(state.project().points),
      transform = { ...viewport.transform() };
    pointer('pointerdown', 100, 100);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    expect(viewport.draggingReference()).toBe(true);
    pointer('pointermove', 117, 91);
    pointer('pointermove', 131, 115);
    pointer('pointerup', 131, 115);
    expect(state.project().referenceImages?.front).toMatchObject({
      centerU: 0.775,
      centerV: -0.375,
      width: 4,
      rotation: 30,
    });
    expect(viewport.transform()).toEqual(transform);
    expect(state.project().points).toEqual(points);
    expect(state.project().edges).toHaveLength(0);
    expect(viewport.draggingReference()).toBe(false);
    state.undo();
    expect(state.project().referenceImages?.front).toMatchObject({ centerU: 0, centerV: 0 });
    expect(state.history.canUndo()).toBe(false);
    state.redo();
    expect(state.project().referenceImages?.front).toMatchObject({
      centerU: 0.775,
      centerV: -0.375,
    });
  });
  it('moves at the current zoom and pan without jumping to the cursor or accepting another pointer', async () => {
    await addReference();
    viewport.transform.set({ scale: 80, panX: 180, panY: 130 });
    pointer('pointerdown', 200, 150);
    pointer('pointermove', 500, 500, {}, 2);
    pointer('pointerup', 500, 500, {}, 2);
    expect(viewport.draggingReference()).toBe(true);
    pointer('pointermove', 223, 137);
    pointer('pointerup', 223, 137);
    expect(state.project().referenceImages?.front).toMatchObject({
      centerU: 23 / 80,
      centerV: 13 / 80,
    });
  });
  it('hit-tests rotated image bounds, ignores clicks and leaves a hidden reference alone', async () => {
    await addReference(45);
    pointer('pointerdown', 176, 64);
    pointer('pointermove', 190, 64);
    pointer('pointerup', 190, 64);
    expect(canvas.setPointerCapture).not.toHaveBeenCalled();
    expect(state.history.canUndo()).toBe(false);
    pointer('pointerdown', 100, 152);
    pointer('pointermove', 101, 152);
    pointer('pointerup', 101, 152);
    expect(canvas.setPointerCapture).toHaveBeenCalledOnce();
    expect(state.history.canUndo()).toBe(false);
    state.updateReferenceImage('front', { visible: false });
    state.history.clear();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 100);
    pointer('pointerup', 140, 100);
    expect(state.history.canUndo()).toBe(false);
    expect(state.project().referenceImages?.front).toMatchObject({ centerU: 0, centerV: 0 });
  });
  it('nudges by screen pixels with arrows and Shift, with undo and no grid snapping', async () => {
    await addReference(30);
    const points = structuredClone(state.project().points);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }),
    );
    expect(state.project().referenceImages?.front).toMatchObject({ centerU: 0.025, centerV: 0.25 });
    viewport.transform.update((t) => ({ ...t, scale: 80 }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(state.project().referenceImages?.front?.centerU).toBeCloseTo(0.0125);
    state.undo();
    expect(state.project().referenceImages?.front).toMatchObject({ centerU: 0.025, centerV: 0.25 });
    expect(state.project().points).toEqual(points);
    state.setTool('select');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(state.project().referenceImages?.front?.centerU).toBe(0.025);
  });
  it('keeps Alt-drag panning available in image mode', async () => {
    await addReference();
    pointer('pointerdown', 100, 100, { altKey: true });
    pointer('pointermove', 120, 110);
    pointer('pointerup', 120, 110);
    expect(viewport.transform()).toEqual({ scale: 40, panX: 120, panY: 110 });
    expect(state.project().referenceImages?.front).toMatchObject({ centerU: 0, centerV: 0 });
    expect(state.history.canUndo()).toBe(false);
  });
  it('restores the starting position on Escape and stops dragging after switching tools', async () => {
    await addReference();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 120, 110);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pointer('pointermove', 150, 130);
    expect(viewport.draggingReference()).toBe(false);
    expect(state.project().referenceImages?.front).toMatchObject({ centerU: 0, centerV: 0 });
    pointer('pointerdown', 100, 100);
    state.setTool('select');
    pointer('pointermove', 120, 110);
    expect(viewport.draggingReference()).toBe(false);
    expect(state.project().referenceImages?.front).toMatchObject({ centerU: 0, centerV: 0 });
  });
  it('fits all four corners of a rotated reference inside the viewport', () => {
    state.setReferenceImage('front', {
      name: 'reference.png',
      dataUrl: 'data:image/png;base64,YQ==',
      pixelWidth: 800,
      pixelHeight: 400,
      centerU: 6,
      centerV: 7,
      width: 10,
      rotation: 45,
      opacity: 0.5,
      visible: true,
    });
    viewport.fit();
    for (const corner of referenceCorners(state.project().referenceImages!.front!)) {
      const screen = worldToScreen(corner, viewport.transform());
      expect(screen.u).toBeGreaterThanOrEqual(0);
      expect(screen.u).toBeLessThanOrEqual(400);
      expect(screen.v).toBeGreaterThanOrEqual(0);
      expect(screen.v).toBeLessThanOrEqual(300);
    }
  });

  it.each(['edge', 'polyline'] as const)(
    'chooses the exact endpoints for %s without connecting on the ambiguous click',
    (tool) => {
      state.setTool(tool);
      clickAt(100, 100);
      expect(state.chainId()).toBeNull();
      expect(state.project().edges).toHaveLength(0);
      expect(viewport.pointChoices().map((choice) => choice.point.id)).toEqual(['a', 'b']);
      expect(fixture.nativeElement.textContent).toContain('Y 3');
      choose('b');
      expect(state.chainId()).toBe('b');
      clickAt(180, 100);
      choose('d');
      expect(state.project().edges[0]).toMatchObject({ startPointId: 'b', endPointId: 'd' });
      expect(state.project().points).toHaveLength(5);
      expect(state.chainId()).toBe(tool === 'polyline' ? 'd' : null);
      expect(viewport.pointPicker()).toBeNull();
      state.undo();
      expect(state.project().edges).toHaveLength(0);
    },
  );

  it('connects a single hit immediately and allows choosing a different node at the starting projection', () => {
    state.setTool('edge');
    clickAt(260, 60);
    expect(state.chainId()).toBe('e');
    expect(viewport.pointPicker()).toBeNull();
    state.setTool('edge');
    clickAt(100, 100);
    choose('a');
    clickAt(100, 100);
    expect(viewport.pointChoices()[0].disabledReason).toBe('Starting node');
    choose('b');
    expect(state.project().edges[0]).toMatchObject({ startPointId: 'a', endPointId: 'b' });
  });

  it('previews a chosen candidate without changing selection and navigates choices with the keyboard', async () => {
    state.setTool('edge');
    state.select('e');
    clickAt(100, 100);
    await fixture.whenStable();
    const buttons = fixture.nativeElement.querySelectorAll(
      '[data-point-choice]',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    expect(state.highlightedId()).toBe('b');
    expect(viewport.scene().selectedId).toBe('b');
    expect(state.selectedId()).toBe('e');
    buttons[1].click();
    expect(state.chainId()).toBe('b');
    expect(state.highlightedId()).toBeNull();
  });

  it('dismisses with Escape or outside click while keeping the unfinished line', () => {
    state.setTool('polyline');
    clickAt(260, 60);
    clickAt(100, 100);
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(viewport.pointPicker()).toBeNull();
    expect(state.chainId()).toBe('e');
    expect(state.highlightedId()).toBeNull();
    clickAt(100, 100);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(viewport.pointPicker()).toBeNull();
    expect(state.chainId()).toBe('e');
  });

  it('lists locked and other-object nodes as unavailable and excludes hidden nodes', async () => {
    state.project.update((project) => ({
      ...project,
      points: [...project.points, { id: 'hidden', x: 2, y: 9, z: 0 }],
      objects: [
        { ...project.objects[0], pointIds: ['a', 'b', 'e'] },
        { ...project.objects[0], id: 'other', name: 'Other object', pointIds: ['c'], locked: true },
        { ...project.objects[0], id: 'other-2', name: 'Another object', pointIds: ['d'] },
        {
          ...project.objects[0],
          id: 'hidden-object',
          name: 'Hidden',
          pointIds: ['hidden'],
          visible: false,
        },
      ],
    }));
    await fixture.whenStable();
    state.setTool('edge');
    clickAt(260, 60);
    clickAt(180, 100);
    expect(viewport.pointChoices().map((choice) => choice.disabledReason)).toEqual([
      'Locked',
      'Different object',
    ]);
    viewport.choosePoint('c');
    viewport.choosePoint('d');
    expect(state.project().edges).toHaveLength(0);
    expect(viewport.pointChoices()).toHaveLength(2);
  });

  it('keeps two-view polyline point completion working over an overlap', () => {
    state.setTool('polyline');
    state.addClick('top', { u: 0, v: 8 });
    clickAt(100, 100);
    expect(viewport.pointPicker()).toBeNull();
    expect(state.project().points.at(-1)).toMatchObject({ x: 0, y: 8, z: 0 });
  });

  it('keeps the picker inside a small viewport and dismisses it on zoom, tool and model changes', async () => {
    viewport.size.set({ width: 220, height: 160 });
    state.setTool('edge');
    clickAt(180, 100);
    const layout = viewport.pickerLayout();
    expect(layout.left).toBeGreaterThanOrEqual(8);
    expect(layout.left + layout.width).toBeLessThanOrEqual(212);
    expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(152);
    viewport.zoomAt(40);
    expect(viewport.pointPicker()).toBeNull();
    clickAt(100, 100);
    state.setTool('select');
    expect(viewport.pointPicker()).toBeNull();
    state.setTool('edge');
    clickAt(100, 100);
    state.renameProject('Updated');
    await fixture.whenStable();
    expect(viewport.pointPicker()).toBeNull();
    expect(state.highlightedId()).toBeNull();
  });
});
