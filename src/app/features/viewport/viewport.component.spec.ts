import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ViewportComponent } from './viewport.component';
import { BlueprintService } from '../../core/services/blueprint.service';

describe('overlapping endpoint picker', () => {
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
    state.selectedId.set('e');
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
