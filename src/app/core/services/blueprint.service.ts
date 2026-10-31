import { computed, inject, Injectable, signal } from '@angular/core';
import {
  BlueprintEdge,
  BlueprintObject,
  BlueprintPoint,
  BlueprintProject,
  Position,
  Projection,
  ReferenceImage,
  Tool,
  ViewType,
  VIEW_AXES,
} from '../models/blueprint';
import { combineProjections, constrainProjection, movePointInView } from '../geometry/geometry';
import { HistoryService } from './history.service';
import { validReferenceImage } from '../geometry/reference-image';

export function emptyProject(): BlueprintProject {
  return {
    version: 1,
    name: 'Untitled blueprint',
    units: 'm',
    points: [],
    edges: [],
    objects: [
      {
        id: 'object-1',
        name: 'Object 01',
        color: '#8cd5ba',
        visible: true,
        locked: false,
        pointIds: [],
        edgeIds: [],
        layerId: 'layer-1',
      },
    ],
    layers: [{ id: 'layer-1', name: 'Geometry', visible: true, locked: false }],
  };
}
@Injectable({ providedIn: 'root' })
export class BlueprintService {
  readonly history = inject(HistoryService);
  readonly project = signal<BlueprintProject>(emptyProject());
  readonly tool = signal<Tool>('select');
  readonly selectedId = signal<string | null>(null);
  readonly activeObjectId = signal('object-1');
  readonly activeView = signal<ViewType>('front');
  readonly pending = signal<Projection | null>(null);
  readonly preview = signal<BlueprintPoint | null>(null);
  readonly cursor = signal<Position>({ u: 0, v: 0 });
  readonly gridSize = signal(0.5);
  readonly snap = signal(true);
  readonly showGrid = signal(true);
  readonly showLabels = signal(true);
  readonly syncZoom = signal(false);
  readonly linkedZoom = signal<{ source: ViewType; scale: number; tick: number } | null>(null);
  readonly zoom = signal(100);
  readonly planeDepth = signal(0);
  readonly pointPlacement = signal<'two-views' | 'plane'>('two-views');
  readonly chainId = signal<string | null>(null);
  readonly rectangle = signal<Projection | null>(null);
  readonly measurement = signal<{
    view: ViewType;
    a: Position;
    b: Position;
    complete: boolean;
  } | null>(null);
  readonly notice = signal('Ready. Add a point to begin your blueprint.');
  readonly selected = computed(
    () => this.project().points.find((p) => p.id === this.selectedId()) ?? null,
  );
  readonly activeObject = computed(() =>
    this.project().objects.find((o) => o.id === this.activeObjectId()),
  );
  readonly dirty = signal(false);
  readonly visiblePoints = computed(() => {
    const project = this.project(),
      layers = new Set(project.layers.filter((l) => l.visible).map((l) => l.id));
    const ids = new Set(
      project.objects.filter((o) => o.visible && layers.has(o.layerId)).flatMap((o) => o.pointIds),
    );
    return project.points.filter((p) => ids.has(p.id));
  });
  id(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  replaceProject(project: BlueprintProject): void {
    this.history.record(this.project());
    this.project.set(project);
    this.activeObjectId.set(project.objects[0]?.id ?? '');
    this.selectedId.set(null);
    this.cancel();
  }
  undo(): void {
    const p = this.history.undo(this.project());
    if (p) this.restore(p, 'Undo');
  }
  redo(): void {
    const p = this.history.redo(this.project());
    if (p) this.restore(p, 'Redo');
  }
  private restore(project: BlueprintProject, operation: string): void {
    this.project.set(project);
    this.cancel();
    if (!project.points.some((p) => p.id === this.selectedId())) this.selectedId.set(null);
    if (!project.objects.some((o) => o.id === this.activeObjectId()))
      this.activeObjectId.set(project.objects[0]?.id ?? '');
    this.notice.set(`${operation} complete.`);
  }
  renameProject(name: string): void {
    if (name.trim() && name !== this.project().name) {
      this.history.record(this.project());
      this.project.update((p) => ({ ...p, name: name.trim().slice(0, 120) }));
    }
  }
  setUnits(units: BlueprintProject['units']): void {
    this.history.record(this.project());
    this.project.update((p) => ({ ...p, units }));
  }
  setTool(tool: Tool): void {
    this.cancel();
    this.tool.set(tool);
    const hints: Record<Tool, string> = {
      select: 'Select or drag a point. Hold Alt or middle-drag to pan.',
      add:
        this.pointPlacement() === 'plane'
          ? 'Click to place a point at the construction depth. Change depth in Properties.'
          : 'Click in two different views to define a 3D point.',
      move: 'Drag a point to move its two visible coordinates.',
      'delete-point': 'Click a point to delete it and its connected edges.',
      edge: 'Click two existing points in the same object to connect them.',
      'delete-edge': 'Click an edge to delete it.',
      rectangle: 'Set the construction plane, then click two corners in one view.',
      polyline:
        'Click existing points, or define new points in two views. Escape ends the polyline.',
      measure: 'Click two positions in one view to measure their projected distance.',
    };
    this.notice.set(hints[tool]);
  }
  cancel(): void {
    this.pending.set(null);
    this.preview.set(null);
    this.chainId.set(null);
    this.rectangle.set(null);
    this.measurement.set(null);
  }
  isEditable(id: string): boolean {
    const object = this.project().objects.find((o) => o.pointIds.includes(id));
    return (
      !!object &&
      object.visible &&
      !object.locked &&
      this.project().layers.some((l) => l.id === object.layerId && l.visible && !l.locked)
    );
  }
  canCreate(): boolean {
    const o = this.activeObject();
    return (
      !!o &&
      o.visible &&
      !o.locked &&
      this.project().layers.some((l) => l.id === o.layerId && l.visible && !l.locked)
    );
  }
  hover(view: ViewType, position: Position): void {
    this.cursor.set(position);
    const first = this.pending();
    if (first && first.view !== view)
      this.preview.set(combineProjections(first, constrainProjection(first, view, position)));
    const measurement = this.measurement();
    if (measurement && !measurement.complete && measurement.view === view)
      this.measurement.set({ ...measurement, b: position });
  }
  addClick(view: ViewType, position: Position): void {
    if (!this.canCreate()) {
      this.notice.set('Select an unlocked, visible object to add geometry.');
      return;
    }
    if (this.pointPlacement() === 'plane') {
      const plane = this.planeDepth();
      if (!Number.isFinite(plane) || Math.abs(plane) > 1e9) {
        this.notice.set('Enter a finite construction depth within ±1 billion.');
        return;
      }
      const hidden = (['x', 'y', 'z'] as const).find((a) => !VIEW_AXES[view].includes(a))!;
      const point = movePointInView(
        { id: this.id('p'), x: 0, y: 0, z: 0, [hidden]: plane },
        view,
        position,
      );
      this.commitPoint(point);
      return;
    }
    const first = this.pending();
    if (!first) {
      this.pending.set({ view, position });
      this.notice.set('Choose another view. The shared coordinate is constrained to the guide.');
      return;
    }
    if (first.view === view) {
      this.pending.set({ view, position });
      this.preview.set(null);
      return;
    }
    const point = combineProjections(
      first,
      constrainProjection(first, view, position),
      this.id('p'),
    );
    this.commitPoint(point);
  }
  private commitPoint(point: BlueprintPoint): void {
    this.history.record(this.project());
    const chain = this.chainId();
    const edge =
      this.tool() === 'polyline' && chain
        ? { id: this.id('e'), startPointId: chain, endPointId: point.id }
        : null;
    this.project.update((p) => ({
      ...p,
      points: [...p.points, point],
      edges: edge ? [...p.edges, edge] : p.edges,
      objects: p.objects.map((o) =>
        o.id === this.activeObjectId()
          ? {
              ...o,
              pointIds: [...o.pointIds, point.id],
              edgeIds: edge ? [...o.edgeIds, edge.id] : o.edgeIds,
            }
          : o,
      ),
    }));
    this.selectedId.set(point.id);
    this.pending.set(null);
    this.preview.set(null);
    if (this.tool() === 'polyline') this.chainId.set(point.id);
    this.notice.set(
      this.tool() === 'polyline'
        ? 'Polyline extended. Add another point or press Escape to finish.'
        : 'Point created in all three views.',
    );
  }
  setPointPlacement(mode: 'two-views' | 'plane'): void {
    this.cancel();
    this.pointPlacement.set(mode);
    this.setTool(this.tool());
  }
  setReferenceImage(view: ViewType, image: ReferenceImage): void {
    if (!validReferenceImage(image)) return;
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      referenceImages: { ...p.referenceImages, [view]: image },
    }));
  }
  updateReferenceImage(
    view: ViewType,
    patch: Partial<Pick<ReferenceImage, 'centerU' | 'centerV' | 'width' | 'opacity' | 'visible'>>,
  ): void {
    const image = this.project().referenceImages?.[view];
    if (image) this.setReferenceImage(view, { ...image, ...patch });
  }
  removeReferenceImage(view: ViewType): void {
    if (!this.project().referenceImages?.[view]) return;
    this.history.record(this.project());
    this.project.update((p) => {
      const referenceImages = { ...p.referenceImages };
      delete referenceImages[view];
      return { ...p, referenceImages };
    });
    this.notice.set('Reference image removed. Your geometry is preserved.');
  }
  move(id: string, view: ViewType, position: Position): void {
    if (!this.isEditable(id)) return;
    this.project.update((p) => ({
      ...p,
      points: p.points.map((point) =>
        point.id === id ? movePointInView(point, view, position) : point,
      ),
    }));
  }
  setCoordinate(axis: 'x' | 'y' | 'z', value: number): void {
    const id = this.selectedId();
    if (
      !id ||
      !Number.isFinite(value) ||
      Math.abs(value) > 1e9 ||
      !this.isEditable(id) ||
      this.selected()?.[axis] === value
    )
      return;
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      points: p.points.map((point) => (point.id === id ? { ...point, [axis]: value } : point)),
    }));
  }
  select(id: string | null): void {
    this.selectedId.set(id);
    const object = this.project().objects.find((o) => o.pointIds.includes(id ?? ''));
    if (object) this.activeObjectId.set(object.id);
  }
  connect(id: string): void {
    if (!this.isEditable(id)) {
      this.notice.set('Unlock the object before editing.');
      return;
    }
    const start = this.chainId();
    if (!start) {
      this.select(id);
      this.chainId.set(id);
      this.notice.set('Choose the next point in this object.');
      return;
    }
    if (start === id) return;
    const object = this.project().objects.find((o) => o.pointIds.includes(start));
    if (!object?.pointIds.includes(id)) {
      this.notice.set('Both endpoints must belong to the same object.');
      return;
    }
    if (
      !this.project().edges.some(
        (e) =>
          (e.startPointId === start && e.endPointId === id) ||
          (e.startPointId === id && e.endPointId === start),
      )
    ) {
      this.history.record(this.project());
      const edge = { id: this.id('e'), startPointId: start, endPointId: id };
      this.project.update((p) => ({
        ...p,
        edges: [...p.edges, edge],
        objects: p.objects.map((o) =>
          o.id === object.id ? { ...o, edgeIds: [...o.edgeIds, edge.id] } : o,
        ),
      }));
    }
    this.selectedId.set(id);
    this.chainId.set(this.tool() === 'polyline' ? id : null);
    this.pending.set(null);
    this.preview.set(null);
    this.notice.set('Edge created. All projections updated.');
  }
  deletePoint(id: string): void {
    if (!this.isEditable(id)) {
      this.notice.set('Unlock the object before deleting its points.');
      return;
    }
    this.history.record(this.project());
    const edges = this.project().edges.filter((e) => e.startPointId !== id && e.endPointId !== id);
    const edgeIds = new Set(edges.map((e) => e.id));
    this.project.update((p) => ({
      ...p,
      points: p.points.filter((point) => point.id !== id),
      edges,
      objects: p.objects.map((o) => ({
        ...o,
        pointIds: o.pointIds.filter((pid) => pid !== id),
        edgeIds: o.edgeIds.filter((eid) => edgeIds.has(eid)),
      })),
    }));
    if (this.selectedId() === id) this.selectedId.set(null);
    if (this.chainId() === id) this.cancel();
  }
  deleteEdge(id: string): void {
    const object = this.project().objects.find((o) => o.edgeIds.includes(id));
    if (
      !object ||
      object.locked ||
      !object.visible ||
      !this.project().layers.some((l) => l.id === object.layerId && l.visible && !l.locked)
    ) {
      this.notice.set('Unlock the object and layer before deleting edges.');
      return;
    }
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      edges: p.edges.filter((e) => e.id !== id),
      objects: p.objects.map((o) => ({ ...o, edgeIds: o.edgeIds.filter((eid) => eid !== id) })),
    }));
  }
  rectangleClick(view: ViewType, position: Position): void {
    if (!this.canCreate()) {
      this.notice.set('Select an unlocked, visible object.');
      return;
    }
    const first = this.rectangle();
    if (!first || first.view !== view) {
      this.rectangle.set({ view, position });
      return;
    }
    if (
      Math.abs(first.position.u - position.u) < 1e-8 ||
      Math.abs(first.position.v - position.v) < 1e-8
    ) {
      this.notice.set('Choose a second corner with a non-zero width and height.');
      return;
    }
    const hidden = (['x', 'y', 'z'] as const).find((a) => !VIEW_AXES[view].includes(a))!;
    const plane = this.planeDepth();
    if (!Number.isFinite(plane) || Math.abs(plane) > 1e9) {
      this.notice.set('Enter a finite construction depth within ±1 billion.');
      return;
    }
    const corners: Position[] = [
      first.position,
      { u: position.u, v: first.position.v },
      position,
      { u: first.position.u, v: position.v },
    ];
    const points = corners.map((corner) =>
      movePointInView({ id: this.id('p'), x: 0, y: 0, z: 0, [hidden]: plane }, view, corner),
    );
    const edges: BlueprintEdge[] = points.map((p, i) => ({
      id: this.id('e'),
      startPointId: p.id,
      endPointId: points[(i + 1) % 4].id,
    }));
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      points: [...p.points, ...points],
      edges: [...p.edges, ...edges],
      objects: p.objects.map((o) =>
        o.id === this.activeObjectId()
          ? {
              ...o,
              pointIds: [...o.pointIds, ...points.map((p) => p.id)],
              edgeIds: [...o.edgeIds, ...edges.map((e) => e.id)],
            }
          : o,
      ),
    }));
    this.rectangle.set(null);
    this.selectedId.set(points[0].id);
    this.notice.set(`Rectangle created on ${hidden.toUpperCase()} = ${plane}.`);
  }
  measureClick(view: ViewType, position: Position): void {
    const previous = this.measurement();
    this.measurement.set(
      previous && previous.view === view && !previous.complete
        ? { ...previous, b: position, complete: true }
        : { view, a: position, b: position, complete: false },
    );
    this.notice.set('Measurement is the 2D distance in this projection. Escape clears it.');
  }
  createObject(): void {
    this.history.record(this.project());
    const id = this.id('object');
    const colors = ['#8cd5ba', '#9aaee2', '#d4b37b', '#c997ba', '#85b7cf'];
    this.project.update((p) => ({
      ...p,
      objects: [
        ...p.objects,
        {
          id,
          name: `Object ${String(p.objects.length + 1).padStart(2, '0')}`,
          color: colors[p.objects.length % colors.length],
          visible: true,
          locked: false,
          pointIds: [],
          edgeIds: [],
          layerId: p.layers[0].id,
        },
      ],
    }));
    this.activeObjectId.set(id);
    this.cancel();
  }
  updateObject(
    id: string,
    patch: Partial<Pick<BlueprintObject, 'name' | 'color' | 'visible' | 'locked' | 'layerId'>>,
  ): void {
    if (patch.name !== undefined) {
      if (!patch.name.trim()) return;
      patch = { ...patch, name: patch.name.trim().slice(0, 120) };
    }
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      objects: p.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
    this.cancel();
  }
  deleteObject(id: string): void {
    const object = this.project().objects.find((o) => o.id === id);
    if (!object) return;
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      objects: p.objects.filter((o) => o.id !== id),
      points: p.points.filter((point) => !object.pointIds.includes(point.id)),
      edges: p.edges.filter((e) => !object.edgeIds.includes(e.id)),
    }));
    this.activeObjectId.set(this.project().objects[0]?.id ?? '');
    this.selectedId.set(null);
    this.cancel();
  }
  createLayer(): void {
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      layers: [
        ...p.layers,
        {
          id: this.id('layer'),
          name: `Layer ${p.layers.length + 1}`,
          visible: true,
          locked: false,
        },
      ],
    }));
  }
  updateLayer(id: string, patch: { name?: string; visible?: boolean; locked?: boolean }): void {
    if (patch.name !== undefined) {
      if (!patch.name.trim()) return;
      patch = { ...patch, name: patch.name.trim().slice(0, 120) };
    }
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      layers: p.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
    this.cancel();
  }
  deleteLayer(id: string): void {
    if (this.project().layers.length < 2) return;
    this.history.record(this.project());
    const destination = this.project().layers.find((l) => l.id !== id)!;
    this.project.update((p) => ({
      ...p,
      layers: p.layers.filter((l) => l.id !== id),
      objects: p.objects.map((o) => (o.layerId === id ? { ...o, layerId: destination.id } : o)),
    }));
    this.cancel();
  }
}
