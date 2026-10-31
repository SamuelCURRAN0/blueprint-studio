import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { BlueprintService } from '../../core/services/blueprint.service';
import { Position, ViewportTransform, ViewType, VIEW_AXES } from '../../core/models/blueprint';
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
import { referenceCorners } from '../../core/geometry/reference-image';

@Component({
  selector: 'app-viewport',
  imports: [IconComponent],
  templateUrl: './viewport.component.html',
  styleUrl: './viewport.component.scss',
})
export class ViewportComponent implements AfterViewInit, OnDestroy {
  readonly state = inject(BlueprintService);
  private readonly zone = inject(NgZone);
  readonly view = input.required<ViewType>();
  readonly title = computed(() => `${this.view()[0].toUpperCase()}${this.view().slice(1)} view`);
  readonly axes = computed(() => VIEW_AXES[this.view()].map((a) => a.toUpperCase()).join(' / '));
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
  readonly tooltip = signal('');
  readonly format = format;
  private readonly referenceSource = computed(
    () => this.state.project().referenceImages?.[this.view()]?.dataUrl,
  );
  private readonly referenceImage = signal<HTMLImageElement | null>(null);
  private resize?: ResizeObserver;
  private initialized = false;
  private frame = 0;
  private drag: {
    kind: 'pan' | 'point';
    pointer: number;
    start: Position;
    transform: ViewportTransform;
    id?: string;
    offset?: Position;
    recorded?: boolean;
  } | null = null;
  constructor() {
    effect(() => {
      this.state.project();
      this.state.visiblePoints();
      this.state.selectedId();
      this.state.pending();
      this.state.preview();
      this.state.showGrid();
      this.state.gridSize();
      this.state.showLabels();
      this.transform();
      this.size();
      this.hover();
      this.state.rectangle();
      this.state.measurement();
      this.state.chainId();
      this.referenceImage();
      this.scheduleRender();
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
      selectedId: this.state.selectedId(),
      pending: this.state.pending(),
      preview: this.state.preview(),
      cursor,
      measurement: measurement?.view === this.view() ? measurement : null,
      rectangle:
        rectangle?.view === this.view() && cursor ? { a: rectangle.position, b: cursor } : null,
      chainId: this.state.chainId(),
      referenceImage: this.referenceImage(),
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
  private screen(event: PointerEvent | WheelEvent): Position {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return { u: event.clientX - rect.left, v: event.clientY - rect.top };
  }
  private position(event: PointerEvent): Position {
    const p = screenToWorld(this.screen(event), this.transform());
    return this.state.snap() ? snapToGrid(p, this.state.gridSize()) : p;
  }
  private hit(position: Position): string | null {
    let closest: string | null = null,
      distance = 10;
    for (const point of this.state.visiblePoints()) {
      const p = worldToScreen(projectPoint(point, this.view()), this.transform());
      const d = Math.hypot(position.u - p.u, position.v - p.v);
      if (d < distance) {
        closest = point.id;
        distance = d;
      }
    }
    return closest;
  }
  pointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
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
      if (id && !this.state.pending()) this.state.connect(id);
      else if (this.state.tool() === 'polyline')
        this.state.addClick(this.view(), this.position(event));
      return;
    }
    this.state.select(id);
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
    const pos = this.position(event);
    this.hover.set(pos);
    this.state.hover(this.view(), pos);
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
      if (!this.drag.recorded) {
        this.state.history.record(this.state.project());
        this.drag.recorded = true;
      }
      const world = screenToWorld(screen, this.transform());
      const offset = this.drag.offset ?? { u: 0, v: 0 };
      const target = { u: world.u + offset.u, v: world.v + offset.v };
      this.state.move(
        this.drag.id,
        this.view(),
        this.state.snap() ? snapToGrid(target, this.state.gridSize()) : target,
      );
    }
  }
  pointerUp(event: PointerEvent): void {
    this.drag = null;
    if (this.canvas().nativeElement.hasPointerCapture(event.pointerId))
      this.canvas().nativeElement.releasePointerCapture(event.pointerId);
  }
  wheel(event: WheelEvent): void {
    event.preventDefault();
    this.state.activeView.set(this.view());
    this.zoomAt(this.transform().scale * Math.exp(-event.deltaY * 0.0015), this.screen(event));
  }
  zoomAt(scale: number, anchor = { u: this.size().width / 2, v: this.size().height / 2 }): void {
    scale = Math.max(1e-7, Math.min(1e6, scale));
    const p = screenToWorld(anchor, this.transform());
    this.transform.set({ scale, panX: anchor.u - p.u * scale, panY: anchor.v + p.v * scale });
    this.state.zoom.set((scale / 40) * 100);
    if (this.state.syncZoom())
      this.state.linkedZoom.set({ source: this.view(), scale, tick: Date.now() });
  }
  reset(): void {
    const { width, height } = this.size();
    this.transform.set({ scale: 40, panX: width / 2, panY: height / 2 });
    this.updateZoomStatus();
    if (this.state.syncZoom()) this.zoomAt(40);
  }
  fit(): void {
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
