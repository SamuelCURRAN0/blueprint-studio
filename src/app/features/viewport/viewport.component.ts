import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  NgZone,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { BlueprintService } from '../../core/services/blueprint.service';
import {
  AXIS_COLORS,
  Position,
  ReferenceImage,
  ViewportTransform,
  ViewType,
  VIEW_AXES,
  VIEW_HORIZONTAL_SIGN,
} from '../../core/models/blueprint';
import {
  distanceToSegment,
  fitViewport,
  projectPoint,
  screenToWorld,
  snapToGrid,
  worldToScreen,
} from '../../core/geometry/geometry';
import { format, RenderScene, renderViewport } from './viewport-renderer';
import { IconComponent } from '../../shared/icon.component';
import { PointContextMenuComponent } from './point-context-menu.component';
import {
  containsReference,
  referenceCorners,
  resizeReference,
} from '../../core/geometry/reference-image';

@Component({
  selector: 'app-viewport',
  imports: [IconComponent, PointContextMenuComponent],
  templateUrl: './viewport.component.html',
  styleUrl: './viewport.component.scss',
})
export class ViewportComponent implements AfterViewInit, OnDestroy {
  readonly state = inject(BlueprintService);
  private readonly zone = inject(NgZone);
  readonly baseView = input.required<ViewType>({ alias: 'view' });
  readonly view = computed(() =>
    this.baseView() === 'front'
      ? this.state.frontFacing()
      : this.baseView() === 'top'
        ? this.state.topFacing()
        : this.baseView(),
  );
  readonly alternateView = computed(() =>
    this.baseView() === 'front'
      ? this.view() === 'front'
        ? 'back'
        : 'front'
      : this.baseView() === 'top'
        ? this.view() === 'top'
          ? 'bottom'
          : 'top'
        : null,
  );
  readonly alternateTitle = computed(() => {
    const view = this.alternateView();
    return view ? view[0].toUpperCase() + view.slice(1) : '';
  });
  readonly facingChanged = output<ViewType>();
  private readonly facingTransforms = new Map<ViewType, ViewportTransform>();
  readonly title = computed(() => `${this.view()[0].toUpperCase()}${this.view().slice(1)} view`);
  readonly axisLabels = computed(() =>
    VIEW_AXES[this.view()].map((axis, index) => ({
      label: (index === 0 && VIEW_HORIZONTAL_SIGN[this.view()] < 0 ? '−' : '') + axis.toUpperCase(),
      color: AXIS_COLORS[axis],
    })),
  );
  readonly axes = computed(() =>
    this.axisLabels()
      .map((axis) => axis.label)
      .join(' / '),
  );
  readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  readonly transform = signal<ViewportTransform>({ scale: 40, panX: 0, panY: 0 });
  readonly size = signal({ width: 1, height: 1 });
  readonly scaleBar = computed(() => {
    const scale = this.transform().scale,
      target = 75 / scale;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const length = [5, 2, 1].find((n) => n * magnitude <= target)! * magnitude;
    return { length, pixels: length * scale };
  });
  readonly hover = signal<Position | null>(null);
  readonly selectionBox = signal<{ a: Position; b: Position } | null>(null);
  readonly tooltip = signal('');
  readonly draggingReference = signal(false);
  readonly referenceResizeCursor = signal<string | null>(null);
  readonly referenceMovable = computed(
    () => !!this.state.project().referenceImages?.[this.view()]?.visible,
  );
  readonly pointPicker = computed(() => {
    const picker = this.state.pointPicker();
    return picker?.view === this.view() ? picker : null;
  });
  readonly pointContextMenu = computed(() => {
    const menu = this.state.pointContextMenu();
    return menu?.view === this.view() ? menu : null;
  });
  readonly pointChoices = computed(() => {
    const project = this.state.project();
    const visible = new Set(this.state.visiblePoints().map((p) => p.id));
    const points = new Map(
      project.points.map((point, index) => [point.id, { point, number: index + 1 }]),
    );
    const owners = new Map(
      project.objects.flatMap((o) => o.pointIds.map((id) => [id, o] as const)),
    );
    const start = this.state.chainId();
    const startOwner = start ? owners.get(start) : null;
    return (this.pointPicker()?.pointIds ?? [])
      .filter((id) => visible.has(id))
      .map((id) => {
        const { point, number } = points.get(id)!;
        const object = owners.get(id)!;
        const disabledReason = !this.state.isEditable(id)
          ? 'Locked'
          : start === id
            ? 'Starting node'
            : startOwner && startOwner.id !== object.id
              ? 'Different object'
              : '';
        return { point, number, object, disabledReason };
      });
  });
  readonly pickerLayout = computed(() => {
    const position = this.pointPicker()?.position ?? { u: 0, v: 0 };
    const { width, height } = this.size();
    const panelWidth = Math.max(0, Math.min(280, width - 16));
    const panelHeight = Math.max(0, Math.min(300, height - 16));
    const estimatedHeight = Math.min(panelHeight, 50 + this.pointChoices().length * 66);
    return {
      width: panelWidth,
      maxHeight: panelHeight,
      left: Math.max(8, Math.min(position.u + 12, width - panelWidth - 8)),
      top: Math.max(8, Math.min(position.v + 12, height - estimatedHeight - 8)),
    };
  });
  readonly pickerElement = viewChild<ElementRef<HTMLElement>>('pointPickerElement');
  readonly format = format;
  private readonly referenceSource = computed(
    () => this.state.project().referenceImages?.[this.view()]?.dataUrl,
  );
  private readonly referenceImage = signal<HTMLImageElement | null>(null);
  private resize?: ResizeObserver;
  private initialized = false;
  private frame = 0;
  private drag: {
    kind: 'pan' | 'point' | 'box' | 'reference' | 'reference-resize';
    pointer: number;
    start: Position;
    transform: ViewportTransform;
    id?: string;
    offset?: Position;
    recorded?: boolean;
    reference?: ReferenceImage;
    resizeCorner?: number;
    selection?: string[];
    selectionBefore?: string[];
  } | null = null;
  constructor() {
    effect(() => {
      this.state.project();
      this.view();
      this.state.visiblePoints();
      this.state.selectedIds();
      this.state.highlightedId();
      this.state.pending();
      this.state.preview();
      this.state.showGrid();
      this.state.gridSize();
      this.state.showLabels();
      this.transform();
      this.size();
      this.hover();
      this.selectionBox();
      this.state.rectangle();
      this.state.measurement();
      this.state.chainId();
      this.state.tool();
      this.referenceImage();
      this.scheduleRender();
    });
    effect(() => {
      this.pickerElement()
        ?.nativeElement.querySelector<HTMLButtonElement>('[data-point-choice]:not(:disabled)')
        ?.focus();
    });
    effect((onCleanup) => {
      const source = this.referenceSource();
      this.referenceImage.set(null);
      if (!source) return;
      let cancelled = false;
      const image = new Image();
      image.onload = () => {
        if (!cancelled) this.referenceImage.set(image);
      };
      image.onerror = () => {
        if (!cancelled)
          this.state.notice.set(
            `Could not load the ${this.view()} reference image. Replace it with another image.`,
          );
      };
      image.src = source;
      onCleanup(() => {
        cancelled = true;
        image.onload = image.onerror = null;
      });
    });
    effect(() => {
      const linked = this.state.linkedZoom();
      if (!this.state.syncZoom() || !linked || linked.source === this.view()) return;
      const anchor = { u: this.size().width / 2, v: this.size().height / 2 };
      const p = screenToWorld(anchor, this.transform());
      if (this.transform().scale !== linked.scale)
        this.transform.set({
          scale: linked.scale,
          panX: anchor.u - p.u * linked.scale,
          panY: anchor.v + p.v * linked.scale,
        });
    });
  }
  ngAfterViewInit(): void {
    this.resize = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const firstResize = !this.initialized;
      const old = this.size();
      this.size.set({ width, height });
      this.transform.update((t) => ({
        ...t,
        panX: this.initialized ? t.panX + (width - old.width) / 2 : width / 2,
        panY: this.initialized ? t.panY + (height - old.height) / 2 : height / 2,
      }));
      this.initialized = true;
      if (
        firstResize &&
        width > 0 &&
        height > 0 &&
        (this.state.visiblePoints().length ||
          this.state.project().referenceImages?.[this.view()]?.visible)
      )
        this.fit();
    });
    this.resize.observe(this.canvas().nativeElement);
  }
  ngOnDestroy(): void {
    if (this.pointPicker()) this.state.dismissPointPicker();
    if (this.pointContextMenu()) this.state.dismissPointContextMenu();
    this.resize?.disconnect();
    cancelAnimationFrame(this.frame);
  }
  private scheduleRender(): void {
    cancelAnimationFrame(this.frame);
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => this.draw());
    });
  }
  scene(): RenderScene {
    const rectangle = this.state.rectangle(),
      measurement = this.state.measurement(),
      cursor = this.hover();
    return {
      project: this.state.project(),
      points: this.state.visiblePoints(),
      view: this.view(),
      transform: this.transform(),
      ...this.size(),
      grid: this.state.showGrid(),
      gridSize: this.state.gridSize(),
      labels: this.state.showLabels(),
      selectedId: this.state.highlightedId() ?? this.state.selectedId(),
      selectedIds: this.state.selectedIds(),
      selectionBox: this.selectionBox(),
      pending: this.state.pending(),
      preview: this.state.preview(),
      cursor,
      measurement: measurement?.view === this.view() ? measurement : null,
      rectangle:
        rectangle?.view === this.view() && cursor ? { a: rectangle.position, b: cursor } : null,
      chainId: this.state.chainId(),
      referenceImage: this.referenceImage(),
      referenceEditing: this.state.tool() === 'move-reference',
    };
  }
  draw(): void {
    const canvas = this.canvas()?.nativeElement;
    if (!canvas) return;
    const { width, height } = this.size(),
      dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderViewport(ctx, this.scene());
  }
  private screen(event: MouseEvent): Position {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return { u: event.clientX - rect.left, v: event.clientY - rect.top };
  }
  private position(event: PointerEvent): Position {
    const p = screenToWorld(this.screen(event), this.transform());
    return this.state.snap() ? snapToGrid(p, this.state.gridSize()) : p;
  }
  private hit(position: Position): string | null {
    return this.hitPoints(position)[0] ?? null;
  }
  private referenceHandle(position: Position): number | null {
    const image = this.state.project().referenceImages?.[this.view()];
    if (!image?.visible) return null;
    let closest: number | null = null,
      distance = 10;
    referenceCorners(image).forEach((corner, index) => {
      const screen = worldToScreen(corner, this.transform());
      const d = Math.hypot(position.u - screen.u, position.v - screen.v);
      if (d < distance) {
        closest = index;
        distance = d;
      }
    });
    return closest;
  }
  private resizeCursor(corner: number): string {
    const image = this.state.project().referenceImages![this.view()]!;
    const corners = referenceCorners(image).map((p) => worldToScreen(p, this.transform()));
    const anchor = corners[(corner + 2) % 4];
    const angle =
      ((Math.atan2(corners[corner].v - anchor.v, corners[corner].u - anchor.u) * 180) / Math.PI +
        180) %
      180;
    return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(angle / 45) % 4];
  }
  pointerLeave(): void {
    this.hover.set(null);
    this.tooltip.set('');
    if (!this.drag) this.referenceResizeCursor.set(null);
  }
  private hitPoints(position: Position): string[] {
    return this.state
      .visiblePoints()
      .map((point) => {
        const p = worldToScreen(projectPoint(point, this.view()), this.transform());
        return { id: point.id, distance: Math.hypot(position.u - p.u, position.v - p.v) };
      })
      .filter((hit) => hit.distance < 10)
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          Number(this.state.selectedIds().includes(b.id)) -
            Number(this.state.selectedIds().includes(a.id)),
      )
      .map((hit) => hit.id);
  }
  choosePoint(id: string): void {
    if (
      !this.pointPicker() ||
      this.state.pending() ||
      !['edge', 'polyline'].includes(this.state.tool()) ||
      !this.pointChoices().some((choice) => choice.point.id === id && !choice.disabledReason)
    )
      return;
    this.state.connect(id);
    this.canvas().nativeElement.focus();
  }
  closePointPicker(): void {
    this.state.dismissPointPicker();
    this.canvas().nativeElement.focus();
  }
  pickerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closePointPicker();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = Array.from(
        this.pickerElement()!.nativeElement.querySelectorAll<HTMLButtonElement>(
          '[data-point-choice]:not(:disabled)',
        ),
      );
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        index < 0
          ? 0
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
  @HostListener('document:pointerdown', ['$event'])
  outsidePointPicker(event: PointerEvent): void {
    if (
      this.pointContextMenu() &&
      !(event.target instanceof Element && event.target.closest('app-point-context-menu'))
    )
      this.state.dismissPointContextMenu();
    if (
      this.pointPicker() &&
      event.target !== this.canvas().nativeElement &&
      !(event.target instanceof Element && event.target.closest('.point-picker'))
    )
      this.state.dismissPointPicker();
  }
  focusCanvas(): void {
    this.canvas().nativeElement.focus();
  }
  openPointContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.drag) return;
    const position = this.screen(event);
    this.showPointContextMenu(position, this.hitPoints(position));
  }
  private showPointContextMenu(position: Position, pointIds: string[]): void {
    this.state.setTool('select');
    this.state.activeView.set(this.view());
    this.state.zoom.set((this.transform().scale / 40) * 100);
    const pointId = pointIds.at(0) ?? null;
    if (pointId && !this.state.selectedIds().includes(pointId)) this.state.select(pointId);
    this.tooltip.set('');
    this.state.pointContextMenu.set({ view: this.view(), position, pointId, pointIds });
  }
  pointerDown(event: PointerEvent): void {
    if (this.drag) return;
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    this.state.dismissPointContextMenu();
    this.state.dismissPointPicker();
    this.state.activeView.set(this.view());
    this.state.zoom.set((this.transform().scale / 40) * 100);
    this.canvas().nativeElement.focus();
    const screen = this.screen(event);
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      this.drag = {
        kind: 'pan',
        pointer: event.pointerId,
        start: screen,
        transform: this.transform(),
      };
      this.canvas().nativeElement.setPointerCapture(event.pointerId);
      return;
    }
    if (this.state.tool() === 'move-reference') {
      const image = this.state.project().referenceImages?.[this.view()];
      const corner = this.referenceHandle(screen);
      if (
        !image?.visible ||
        (corner === null && !containsReference(image, screenToWorld(screen, this.transform())))
      ) {
        this.state.notice.set('Drag the reference image to move it, or drag a corner to resize.');
        return;
      }
      this.drag = {
        kind: corner === null ? 'reference' : 'reference-resize',
        pointer: event.pointerId,
        start: screen,
        transform: this.transform(),
        reference: image,
        resizeCorner: corner ?? undefined,
      };
      this.referenceResizeCursor.set(corner === null ? null : this.resizeCursor(corner));
      this.draggingReference.set(true);
      this.tooltip.set('');
      this.canvas().nativeElement.setPointerCapture(event.pointerId);
      return;
    }
    if (this.state.tool() === 'add') {
      this.state.addClick(this.view(), this.position(event));
      return;
    }
    if (this.state.tool() === 'rectangle') {
      this.state.rectangleClick(this.view(), this.position(event));
      return;
    }
    if (this.state.tool() === 'measure') {
      this.state.measureClick(this.view(), this.position(event));
      return;
    }
    if (this.state.tool() === 'delete-edge') {
      const edge = this.hitEdge(screen);
      if (edge) this.state.deleteEdge(edge);
      return;
    }
    const id = this.hit(screen);
    if (this.state.tool() === 'delete-point') {
      if (id) this.state.deletePoint(id);
      return;
    }
    if (this.state.tool() === 'edge' || this.state.tool() === 'polyline') {
      const candidates = this.hitPoints(screen);
      if (candidates.length > 1 && !this.state.pending()) {
        this.tooltip.set('');
        this.state.pointPicker.set({ view: this.view(), position: screen, pointIds: candidates });
      } else if (id && !this.state.pending()) this.state.connect(id);
      else if (this.state.tool() === 'polyline')
        this.state.addClick(this.view(), this.position(event));
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive && id) {
      this.state.select(id, true);
      return;
    }
    if (!id) {
      const selectionBefore = this.state.selectedIds();
      const selection = additive ? selectionBefore : [];
      if (!additive) this.state.select(null);
      this.drag = {
        kind: 'box',
        pointer: event.pointerId,
        start: screen,
        transform: this.transform(),
        selection,
        selectionBefore,
      };
      this.canvas().nativeElement.setPointerCapture(event.pointerId);
      return;
    }
    if (!this.state.selectedIds().includes(id)) this.state.select(id);
    if (id && this.state.isEditable(id)) {
      const point = this.state.project().points.find((p) => p.id === id)!;
      const projected = projectPoint(point, this.view()),
        world = screenToWorld(screen, this.transform());
      this.drag = {
        kind: 'point',
        pointer: event.pointerId,
        start: screen,
        transform: this.transform(),
        id,
        offset: { u: projected.u - world.u, v: projected.v - world.v },
      };
      this.canvas().nativeElement.setPointerCapture(event.pointerId);
    }
  }
  pointerMove(event: PointerEvent): void {
    if (this.drag && this.drag.pointer !== event.pointerId) return;
    if (this.drag?.kind === 'box') {
      const screen = this.screen(event),
        start = this.drag.start;
      if (Math.hypot(screen.u - start.u, screen.v - start.v) >= 3) {
        this.selectionBox.set({ a: start, b: screen });
        const ids = this.state
          .visiblePoints()
          .filter((point) => {
            const p = worldToScreen(projectPoint(point, this.view()), this.transform());
            return (
              p.u >= Math.min(start.u, screen.u) &&
              p.u <= Math.max(start.u, screen.u) &&
              p.v >= Math.min(start.v, screen.v) &&
              p.v <= Math.max(start.v, screen.v)
            );
          })
          .map((point) => point.id);
        this.state.selectMany([...(this.drag.selection ?? []), ...ids]);
      }
      return;
    }
    if (this.drag?.kind === 'reference' || this.drag?.kind === 'reference-resize') {
      if (this.state.tool() !== 'move-reference' || !this.referenceMovable()) {
        this.pointerUp(event);
        return;
      }
      const screen = this.screen(event),
        drag = this.drag;
      this.state.cursor.set(screenToWorld(screen, this.transform()));
      if (!drag.recorded && Math.hypot(screen.u - drag.start.u, screen.v - drag.start.v) < 3)
        return;
      const delta = {
        u: (screen.u - drag.start.u) / drag.transform.scale,
        v: -(screen.v - drag.start.v) / drag.transform.scale,
      };
      const patch =
        drag.kind === 'reference-resize'
          ? resizeReference(drag.reference!, drag.resizeCorner!, delta)
          : {
              centerU: drag.reference!.centerU + delta.u,
              centerV: drag.reference!.centerV + delta.v,
            };
      const current = this.state.project().referenceImages![this.view()]!;
      if (
        current.centerU === patch.centerU &&
        current.centerV === patch.centerV &&
        (!('width' in patch) || current.width === patch.width)
      )
        return;
      if (!drag.recorded) {
        this.state.history.record(this.state.project());
        drag.recorded = true;
      }
      this.state.transformReferenceImage(this.view(), patch);
      return;
    }
    const pos = this.position(event);
    this.hover.set(pos);
    this.state.hover(this.view(), pos);
    if (this.state.tool() === 'move-reference' && !this.drag) {
      const corner = this.referenceHandle(this.screen(event));
      this.referenceResizeCursor.set(corner === null ? null : this.resizeCursor(corner));
      this.tooltip.set('');
      return;
    }
    const id = this.hit(this.screen(event));
    const point = this.state.project().points.find((p) => p.id === id);
    this.tooltip.set(
      point
        ? `P${this.state.project().points.indexOf(point) + 1} · X ${format(point.x)}  Y ${format(point.y)}  Z ${format(point.z)}`
        : '',
    );
    if (!this.drag) return;
    if (this.drag.kind === 'pan') {
      const p = this.screen(event),
        t = this.drag.transform;
      this.transform.set({
        ...t,
        panX: t.panX + p.u - this.drag.start.u,
        panY: t.panY + p.v - this.drag.start.v,
      });
    } else if (this.drag.id) {
      const screen = this.screen(event);
      if (
        !this.drag.recorded &&
        Math.hypot(screen.u - this.drag.start.u, screen.v - this.drag.start.v) < 3
      )
        return;
      const world = screenToWorld(screen, this.transform());
      const offset = this.drag.offset ?? { u: 0, v: 0 };
      const target = { u: world.u + offset.u, v: world.v + offset.v };
      const before = this.state.project();
      const moved = this.state.move(
        this.drag.id,
        this.view(),
        this.state.snap() ? snapToGrid(target, this.state.gridSize()) : target,
      );
      if (moved && !this.drag.recorded) {
        this.state.history.record(before);
        this.drag.recorded = true;
      }
    }
  }
  pointerUp(event: PointerEvent): void {
    this.finishDrag(event.pointerId);
  }
  private finishDrag(pointer: number): void {
    if (this.drag && this.drag.pointer !== pointer) return;
    this.drag = null;
    this.selectionBox.set(null);
    this.draggingReference.set(false);
    this.referenceResizeCursor.set(null);
    if (this.canvas().nativeElement.hasPointerCapture(pointer))
      this.canvas().nativeElement.releasePointerCapture(pointer);
  }
  toggleReferenceMove(): void {
    const selected =
      this.state.tool() === 'move-reference' && this.state.activeView() === this.view();
    this.state.activeView.set(this.view());
    this.state.setTool(selected ? 'select' : 'move-reference');
    this.canvas().nativeElement.focus();
  }
  showView(view: ViewType): void {
    if (
      ((this.baseView() === 'front' && (view === 'front' || view === 'back')) ||
        (this.baseView() === 'top' && (view === 'top' || view === 'bottom'))) &&
      this.view() !== view
    ) {
      if (this.drag) this.finishDrag(this.drag.pointer);
      this.facingTransforms.set(this.view(), { ...this.transform() });
      this.state.cancel();
      this.hover.set(null);
      this.tooltip.set('');
      this.referenceResizeCursor.set(null);
      if (view === 'front' || view === 'back') this.state.frontFacing.set(view);
      else if (view === 'top' || view === 'bottom') this.state.topFacing.set(view);
      const saved = this.facingTransforms.get(view);
      if (saved) {
        this.transform.set(saved);
        if (this.state.syncZoom()) this.zoomAt(saved.scale);
      } else this.fit();
    }
    this.state.activeView.set(this.view());
    this.updateZoomStatus();
  }
  switchFacing(): void {
    const next = this.alternateView();
    if (!next) return;
    this.showView(next);
    this.facingChanged.emit(this.view());
    this.canvas().nativeElement.focus();
    this.state.notice.set(`${this.title()}. Each side has its own reference image and settings.`);
  }
  canvasKeydown(event: KeyboardEvent): void {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      event.stopPropagation();
      if (this.drag) return;
      const point = this.state.selected();
      this.showPointContextMenu(
        point
          ? worldToScreen(projectPoint(point, this.view()), this.transform())
          : { u: this.size().width / 2, v: this.size().height / 2 },
        point ? [point.id] : [],
      );
      return;
    }
    if (this.drag?.kind === 'point' || this.drag?.kind === 'box') {
      if (event.key === 'Escape') {
        const drag = this.drag;
        this.finishDrag(drag.pointer);
        if (drag.kind === 'point' && drag.recorded) this.state.undo();
        if (drag.kind === 'box') this.state.selectMany(drag.selectionBefore ?? []);
        event.preventDefault();
        event.stopPropagation();
      } else if (event.ctrlKey || event.metaKey) this.finishDrag(this.drag.pointer);
      return;
    }
    if (this.state.tool() !== 'move-reference') return;
    if (this.drag?.kind === 'reference' || this.drag?.kind === 'reference-resize') {
      if (event.key === 'Escape') {
        const recorded = this.drag.recorded;
        this.finishDrag(this.drag.pointer);
        if (recorded) this.state.undo();
        this.state.notice.set('Image adjustment cancelled.');
        event.preventDefault();
        event.stopPropagation();
      } else if (event.ctrlKey || event.metaKey) {
        this.finishDrag(this.drag.pointer);
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const direction: Record<string, Position> = {
      ArrowLeft: { u: -1, v: 0 },
      ArrowRight: { u: 1, v: 0 },
      ArrowUp: { u: 0, v: 1 },
      ArrowDown: { u: 0, v: -1 },
    };
    const delta = direction[event.key];
    const image = this.state.project().referenceImages?.[this.view()];
    if (!delta || !image?.visible) return;
    event.preventDefault();
    event.stopPropagation();
    this.state.activeView.set(this.view());
    const step = (event.shiftKey ? 10 : 1) / this.transform().scale;
    this.state.updateReferenceImage(this.view(), {
      centerU: image.centerU + delta.u * step,
      centerV: image.centerV + delta.v * step,
    });
  }
  wheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.drag) return;
    this.state.activeView.set(this.view());
    this.zoomAt(this.transform().scale * Math.exp(-event.deltaY * 0.0015), this.screen(event));
  }
  zoomAt(scale: number, anchor = { u: this.size().width / 2, v: this.size().height / 2 }): void {
    this.state.dismissPointPicker();
    this.state.dismissPointContextMenu();
    scale = Math.max(1e-7, Math.min(1e6, scale));
    const p = screenToWorld(anchor, this.transform());
    this.transform.set({ scale, panX: anchor.u - p.u * scale, panY: anchor.v + p.v * scale });
    this.state.zoom.set((scale / 40) * 100);
    if (this.state.syncZoom())
      this.state.linkedZoom.set({ source: this.view(), scale, tick: Date.now() });
  }
  reset(): void {
    this.state.dismissPointPicker();
    this.state.dismissPointContextMenu();
    const { width, height } = this.size();
    this.transform.set({ scale: 40, panX: width / 2, panY: height / 2 });
    this.updateZoomStatus();
    if (this.state.syncZoom()) this.zoomAt(40);
  }
  fit(): void {
    this.state.dismissPointPicker();
    this.state.dismissPointContextMenu();
    const points = this.state.visiblePoints().map((p) => projectPoint(p, this.view()));
    const reference = this.state.project().referenceImages?.[this.view()];
    if (reference?.visible) points.push(...referenceCorners(reference));
    const { width, height } = this.size();
    this.transform.set(fitViewport(points, width, height));
    this.updateZoomStatus();
    if (this.state.syncZoom()) this.zoomAt(this.transform().scale);
  }
  private updateZoomStatus(): void {
    if (this.state.activeView() === this.view())
      this.state.zoom.set((this.transform().scale / 40) * 100);
  }
  private hitEdge(position: Position): string | null {
    const points = new Map(this.state.visiblePoints().map((p) => [p.id, p]));
    let closest: string | null = null,
      distance = 7;
    for (const edge of this.state.project().edges) {
      const a = points.get(edge.startPointId),
        b = points.get(edge.endPointId);
      if (!a || !b) continue;
      const d = distanceToSegment(
        position,
        worldToScreen(projectPoint(a, this.view()), this.transform()),
        worldToScreen(projectPoint(b, this.view()), this.transform()),
      );
      if (d < distance) {
        distance = d;
        closest = edge.id;
      }
    }
    return closest;
  }
}
