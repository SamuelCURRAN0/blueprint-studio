import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import {
  Axis,
  BlueprintEdge,
  BlueprintLayer,
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
import {
  combineProjections,
  constrainProjection,
  movePointInView,
  sameProjectionPlane,
} from '../geometry/geometry';
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
  private readonly selection = signal<string[]>([]);
  readonly selectedIds = computed(() => {
    const visible = new Set(this.visiblePoints().map((p) => p.id));
    return this.selection().filter((id) => visible.has(id));
  });
  readonly selectedId = computed(() => this.selectedIds().at(-1) ?? null);
  readonly editableSelection = computed(() =>
    this.selectedIds().filter((id) => this.isEditable(id)),
  );
  readonly pointMoveTargets = computed(() => {
    const selected = this.editableSelection();
    return this.project().objects.filter((o) => {
      if (!this.isObjectEditable(o.id)) return false;
      const owned = new Set(o.pointIds);
      return selected.some((id) => !owned.has(id));
    });
  });
  readonly pointContextMenu = signal<{
    view: ViewType;
    position: Position;
    pointId: string | null;
    pointIds: string[];
  } | null>(null);
  readonly highlightedId = signal<string | null>(null);
  readonly pointPicker = signal<{
    view: ViewType;
    position: Position;
    pointIds: string[];
  } | null>(null);
  readonly activeObjectId = signal('object-1');
  readonly activeView = signal<ViewType>('front');
  readonly frontFacing = signal<'front' | 'back'>('front');
  readonly topFacing = signal<'top' | 'bottom'>('top');
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
  readonly activeLayer = computed(() =>
    this.project().layers.find((l) => l.id === this.activeObject()?.layerId),
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
  private readonly pointOwners = computed(
    () => new Map(this.project().objects.flatMap((o) => o.pointIds.map((id) => [id, o] as const))),
  );
  private readonly editableObjectIds = computed(() => {
    const layers = new Set(
      this.project()
        .layers.filter((l) => l.visible && !l.locked)
        .map((l) => l.id),
    );
    return new Set(
      this.project()
        .objects.filter((o) => o.visible && !o.locked && layers.has(o.layerId))
        .map((o) => o.id),
    );
  });
  constructor() {
    effect(() => {
      this.project();
      untracked(() => {
        this.dismissPointPicker();
        this.dismissPointContextMenu();
      });
    });
  }
  dismissPointPicker(): void {
    this.pointPicker.set(null);
    this.highlightedId.set(null);
  }
  dismissPointContextMenu(): void {
    this.pointContextMenu.set(null);
  }
  id(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  replaceProject(project: BlueprintProject): void {
    this.history.record(this.project());
    this.project.set(project);
    this.activeObjectId.set(project.objects[0]?.id ?? '');
    this.select(null);
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
    this.selection.set(this.selectedIds());
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
    const plane = this.activeLayer()?.plane;
    const layerHint = plane
      ? `Layer keeps ${plane.axis.toUpperCase()} = ${plane.value}. Click once in ${plane.axis === 'x' ? 'Side' : plane.axis === 'y' ? 'Front / Back' : 'Top / Bottom'}.`
      : null;
    const hints: Record<Tool, string> = {
      select:
        'Shift-click to select multiple points, or drag a box. Drag selected points to move them together.',
      add:
        layerHint ??
        (this.pointPlacement() === 'plane'
          ? 'Click to place a point at the construction depth. Change depth in Properties.'
          : 'Click in two different views to define a 3D point.'),
      move: 'Drag selected points to move them together. Shift-click adds or removes points.',
      'move-reference':
        'Drag the image to move; drag a corner to resize. Arrows nudge 1 pixel; Shift nudges 10. Select (V) finishes.',
      'delete-point': 'Click a point to delete it and its connected edges.',
      edge: 'Click two existing points in the same object to connect them.',
      'delete-edge': 'Click an edge to delete it.',
      rectangle: plane
        ? `Layer keeps ${plane.axis.toUpperCase()} = ${plane.value}. Click two opposite corners in ${plane.axis === 'x' ? 'Side' : plane.axis === 'y' ? 'Front / Back' : 'Top / Bottom'}.`
        : 'Set the construction plane, then click two corners in one view.',
      polyline:
        layerHint ??
        'Click existing points, or define new points in two views. Escape ends the polyline.',
      measure: 'Click two positions in one view to measure their projected distance.',
    };
    this.notice.set(hints[tool]);
  }
  cancel(): void {
    this.dismissPointPicker();
    this.dismissPointContextMenu();
    this.pending.set(null);
    this.preview.set(null);
    this.chainId.set(null);
    this.rectangle.set(null);
    this.measurement.set(null);
  }
  isEditable(id: string): boolean {
    const object = this.pointOwners().get(id);
    return !!object && this.isObjectEditable(object.id);
  }
  isObjectEditable(id: string): boolean {
    return this.editableObjectIds().has(id);
  }
  canCreate(): boolean {
    return this.isObjectEditable(this.activeObjectId());
  }
  hover(view: ViewType, position: Position): void {
    this.cursor.set(position);
    const first = this.pending();
    if (first && !sameProjectionPlane(first.view, view))
      this.preview.set(
        this.constrainPoint(
          combineProjections(first, constrainProjection(first, view, position)),
          this.activeLayer()?.plane,
        ),
      );
    const measurement = this.measurement();
    if (measurement && !measurement.complete && measurement.view === view)
      this.measurement.set({ ...measurement, b: position });
  }
  addClick(view: ViewType, position: Position): void {
    if (!this.canCreate()) {
      this.notice.set('Select an unlocked, visible object to add geometry.');
      return;
    }
    const hidden = (['x', 'y', 'z'] as const).find((a) => !VIEW_AXES[view].includes(a))!;
    const layerPlane = this.activeLayer()?.plane;
    if (this.pointPlacement() === 'plane' || layerPlane?.axis === hidden) {
      const plane = layerPlane?.axis === hidden ? layerPlane.value : this.planeDepth();
      if (!Number.isFinite(plane) || Math.abs(plane) > 1e9) {
        this.notice.set('Enter a finite construction depth within ±1 billion.');
        return;
      }
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
    if (sameProjectionPlane(first.view, view)) {
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
    point = this.constrainPoint(point, this.activeLayer()?.plane);
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
    this.select(point.id);
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
    patch: Partial<
      Pick<ReferenceImage, 'centerU' | 'centerV' | 'width' | 'rotation' | 'opacity' | 'visible'>
    >,
  ): void {
    const image = this.project().referenceImages?.[view];
    if (image) this.setReferenceImage(view, { ...image, ...patch });
  }
  rotateReferenceImage(view: ViewType, degrees: number): void {
    const image = this.project().referenceImages?.[view];
    if (!image || !Number.isFinite(degrees)) return;
    const rotation = (((((image.rotation ?? 0) + degrees + 180) % 360) + 360) % 360) - 180;
    this.updateReferenceImage(view, { rotation });
  }
  /** Continuous drag update; the viewport records one history entry for the whole gesture. */
  transformReferenceImage(
    view: ViewType,
    patch: Pick<ReferenceImage, 'centerU' | 'centerV'> & { width?: number },
  ): void {
    const image = this.project().referenceImages?.[view];
    const width = patch.width ?? image?.width ?? 0;
    if (
      !image?.visible ||
      ![patch.centerU, patch.centerV].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9) ||
      !Number.isFinite(width) ||
      width < 0.000001 ||
      width > 1e9 ||
      (image.centerU === patch.centerU && image.centerV === patch.centerV && image.width === width)
    )
      return;
    this.project.update((project) => ({
      ...project,
      referenceImages: {
        ...project.referenceImages,
        [view]: { ...image, centerU: patch.centerU, centerV: patch.centerV, width },
      },
    }));
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
  private constrainPoint(point: BlueprintPoint, plane: BlueprintLayer['plane']): BlueprintPoint {
    return plane ? { ...point, [plane.axis]: plane.value } : point;
  }
  pointPlane(id: string): BlueprintLayer['plane'] {
    const object = this.pointOwners().get(id);
    return this.project().layers.find((l) => l.id === object?.layerId)?.plane;
  }
  selectionAxisFixed(axis: Axis): boolean {
    return this.editableSelection().some((id) => this.pointPlane(id)?.axis === axis);
  }
  /** Translate the editable points as one group, preserving their relative positions. */
  translateSelection(
    delta: Partial<Record<Axis, number>>,
    ids = this.selectedIds(),
    record = true,
  ): boolean {
    const editable = new Set(ids.filter((id) => this.isEditable(id)));
    const fixed = new Set([...editable].map((id) => this.pointPlane(id)?.axis));
    const shift = { x: delta.x ?? 0, y: delta.y ?? 0, z: delta.z ?? 0 };
    for (const axis of ['x', 'y', 'z'] as const) if (fixed.has(axis)) shift[axis] = 0;
    if (
      !editable.size ||
      !Object.values(shift).every(Number.isFinite) ||
      !Object.values(shift).some((n) => n !== 0)
    )
      return false;
    const points = this.project().points.map((p) =>
      editable.has(p.id) ? { ...p, x: p.x + shift.x, y: p.y + shift.y, z: p.z + shift.z } : p,
    );
    if (points.some((p) => [p.x, p.y, p.z].some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9))) {
      this.notice.set('The move would exceed the supported coordinate range.');
      return false;
    }
    if (record) this.history.record(this.project());
    this.project.update((p) => ({ ...p, points }));
    return true;
  }
  move(id: string, view: ViewType, position: Position): boolean {
    const point = this.project().points.find((p) => p.id === id);
    if (!point || !this.isEditable(id)) return false;
    const target = movePointInView(point, view, position);
    return this.translateSelection(
      { x: target.x - point.x, y: target.y - point.y, z: target.z - point.z },
      this.selectedIds().includes(id) ? this.selectedIds() : [id],
      false,
    );
  }
  setCoordinate(axis: Axis, value: number): void {
    const point = this.selected();
    if (!point || !this.isEditable(point.id) || !Number.isFinite(value) || Math.abs(value) > 1e9)
      return;
    this.translateSelection({ [axis]: value - point[axis] });
  }
  selectMany(ids: string[], additive = false): void {
    const visible = new Set(this.visiblePoints().map((p) => p.id));
    this.selection.set(
      [...new Set([...(additive ? this.selectedIds() : []), ...ids])].filter((id) =>
        visible.has(id),
      ),
    );
    const object = this.project().objects.find((o) => o.pointIds.includes(this.selectedId() ?? ''));
    if (object) this.activeObjectId.set(object.id);
  }
  select(id: string | null, toggle = false): void {
    this.selectMany(
      id
        ? toggle && this.selectedIds().includes(id)
          ? this.selectedIds().filter((selected) => selected !== id)
          : toggle
            ? [...this.selectedIds(), id]
            : [id]
        : [],
    );
  }
  selectAll(): void {
    this.setTool('select');
    this.selectMany(this.visiblePoints().map((p) => p.id));
    const count = this.selectedIds().length;
    this.notice.set(
      `${count} visible point${count === 1 ? '' : 's'} selected. Delete removes the unlocked points.`,
    );
  }
  moveSelectedToObject(targetId: string): void {
    const project = this.project();
    const target = project.objects.find((o) => o.id === targetId);
    if (!target || !this.isObjectEditable(targetId)) {
      this.notice.set('Choose an unlocked, visible destination object and layer.');
      return;
    }
    const selected = this.selectedIds();
    const targetPoints = new Set(target.pointIds);
    const movedIds = this.editableSelection().filter((id) => !targetPoints.has(id));
    if (!movedIds.length) {
      this.notice.set('Select unlocked points in another object to move here.');
      return;
    }
    const moved = new Set(movedIds);
    const transferredEdges = new Set(
      project.edges
        .filter((e) => moved.has(e.startPointId) && moved.has(e.endPointId))
        .map((e) => e.id),
    );
    const removedEdges = new Set(
      project.edges
        .filter((e) => moved.has(e.startPointId) !== moved.has(e.endPointId))
        .map((e) => e.id),
    );
    const plane = project.layers.find((l) => l.id === target.layerId)?.plane;
    this.history.record(project);
    this.project.set({
      ...project,
      points: project.points.map((p) => (moved.has(p.id) ? this.constrainPoint(p, plane) : p)),
      edges: project.edges.filter((e) => !removedEdges.has(e.id)),
      objects: project.objects.map((o) =>
        o.id === targetId
          ? {
              ...o,
              pointIds: [...o.pointIds, ...movedIds],
              edgeIds: [...o.edgeIds, ...transferredEdges],
            }
          : {
              ...o,
              pointIds: o.pointIds.filter((id) => !moved.has(id)),
              edgeIds: o.edgeIds.filter((id) => !transferredEdges.has(id) && !removedEdges.has(id)),
            },
      ),
    });
    this.cancel();
    this.selectMany(selected.filter((id) => moved.has(id) || targetPoints.has(id)));
    this.activeObjectId.set(targetId);
    this.notice.set(
      `${movedIds.length} point${movedIds.length === 1 ? '' : 's'} moved to ${target.name}.${removedEdges.size ? ` ${removedEdges.size} connection${removedEdges.size === 1 ? '' : 's'} to points left behind removed.` : ''} Undo restores the change.`,
    );
  }
  duplicateSelected(): void {
    const ids = new Set(this.editableSelection());
    if (!ids.size) return;
    const project = this.project();
    const copies = project.points
      .filter((p) => ids.has(p.id))
      .map((p) => ({ ...p, id: this.id('p') }));
    const mapping = new Map(
      project.points.filter((p) => ids.has(p.id)).map((p, i) => [p.id, copies[i].id]),
    );
    const edges = project.edges.filter((e) => ids.has(e.startPointId) && ids.has(e.endPointId));
    if (
      project.points.length + copies.length > 50_000 ||
      project.edges.length + edges.length > 100_000
    ) {
      this.notice.set('Duplicating these points would exceed the supported geometry limit.');
      return;
    }
    const edgeMapping = new Map(edges.map((e) => [e.id, this.id('e')]));
    this.history.record(project);
    this.project.set({
      ...project,
      points: [...project.points, ...copies],
      edges: [
        ...project.edges,
        ...edges.map((e) => ({
          id: edgeMapping.get(e.id)!,
          startPointId: mapping.get(e.startPointId)!,
          endPointId: mapping.get(e.endPointId)!,
        })),
      ],
      objects: project.objects.map((o) => ({
        ...o,
        pointIds: [
          ...o.pointIds,
          ...o.pointIds.filter((id) => mapping.has(id)).map((id) => mapping.get(id)!),
        ],
        edgeIds: [
          ...o.edgeIds,
          ...o.edgeIds.filter((id) => edgeMapping.has(id)).map((id) => edgeMapping.get(id)!),
        ],
      })),
    });
    this.selectMany(copies.map((p) => p.id));
    this.setTool('move');
    this.notice.set(
      `${copies.length} point${copies.length === 1 ? '' : 's'} duplicated in place. Drag the selected copies to move them.`,
    );
  }
  connect(id: string): void {
    this.dismissPointPicker();
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
    this.select(id);
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
    this.deletePoints([id]);
  }
  deleteSelected(): void {
    const ids = this.editableSelection();
    const locked = this.selectedIds().length - ids.length;
    this.deletePoints(ids);
    this.notice.set(
      `${ids.length} point${ids.length === 1 ? '' : 's'} deleted.${locked ? ` ${locked} locked point${locked === 1 ? '' : 's'} kept.` : ''}`,
    );
  }
  private deletePoints(ids: string[]): void {
    if (!ids.length) return;
    const removed = new Set(ids);
    this.history.record(this.project());
    const edges = this.project().edges.filter(
      (e) => !removed.has(e.startPointId) && !removed.has(e.endPointId),
    );
    const edgeIds = new Set(edges.map((e) => e.id));
    this.project.update((p) => ({
      ...p,
      points: p.points.filter((point) => !removed.has(point.id)),
      edges,
      objects: p.objects.map((o) => ({
        ...o,
        pointIds: o.pointIds.filter((pid) => !removed.has(pid)),
        edgeIds: o.edgeIds.filter((eid) => edgeIds.has(eid)),
      })),
    }));
    this.selection.set(this.selectedIds());
    if (removed.has(this.chainId() ?? '')) this.cancel();
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
    const hidden = (['x', 'y', 'z'] as const).find((a) => !VIEW_AXES[view].includes(a))!;
    const layerPlane = this.activeLayer()?.plane;
    if (layerPlane && layerPlane.axis !== hidden) {
      this.notice.set(
        `Draw this layer's rectangle in a view with ${layerPlane.axis.toUpperCase()} as its hidden axis.`,
      );
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
    const plane = layerPlane?.value ?? this.planeDepth();
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
    this.selectMany(points.map((p) => p.id));
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
  createObject(
    layerId = this.activeObject()?.layerId ?? this.project().layers[0].id,
    record = true,
    collectionId: string | null = this.activeObject()?.collectionId ?? null,
  ): void {
    if (!this.project().layers.some((l) => l.id === layerId)) return;
    if (collectionId && !this.project().collections?.some((c) => c.id === collectionId)) return;
    if (record) this.history.record(this.project());
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
          layerId,
          ...(collectionId ? { collectionId } : {}),
        },
      ],
    }));
    this.activeObjectId.set(id);
    this.select(null);
    this.cancel();
  }
  updateObject(
    id: string,
    patch: Partial<Pick<BlueprintObject, 'name' | 'color' | 'visible' | 'locked' | 'layerId'>>,
  ): void {
    const object = this.project().objects.find((o) => o.id === id);
    if (
      !object ||
      (patch.layerId !== undefined && !this.project().layers.some((l) => l.id === patch.layerId))
    )
      return;
    if (
      patch.layerId &&
      patch.layerId !== object.layerId &&
      (object.locked ||
        this.project().layers.some(
          (l) => (l.id === object.layerId || l.id === patch.layerId) && l.locked,
        ))
    ) {
      this.notice.set('Unlock the object and its layers before changing its layer.');
      return;
    }
    if (patch.name !== undefined) {
      if (!patch.name.trim()) return;
      patch = { ...patch, name: patch.name.trim().slice(0, 120) };
    }
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      points: patch.layerId
        ? p.points.map((point) =>
            object.pointIds.includes(point.id)
              ? this.constrainPoint(point, p.layers.find((l) => l.id === patch.layerId)?.plane)
              : point,
          )
        : p.points,
      objects: p.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
    this.selection.set(this.selectedIds());
    this.cancel();
    if (patch.layerId && patch.layerId !== object.layerId) {
      const layer = this.project().layers.find((l) => l.id === patch.layerId)!;
      this.notice.set(
        `${object.name} moved to layer ${layer.name}.${layer.plane ? ` Points aligned to ${layer.plane.axis.toUpperCase()} = ${layer.plane.value}.` : ''} Undo restores the change.`,
      );
    }
  }
  deleteObject(id: string): void {
    const object = this.project().objects.find((o) => o.id === id);
    if (!object) return;
    if (object.locked || this.project().layers.some((l) => l.id === object.layerId && l.locked)) {
      this.notice.set('Unlock the object and its layer before deleting it.');
      return;
    }
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      objects: p.objects.filter((o) => o.id !== id),
      points: p.points.filter((point) => !object.pointIds.includes(point.id)),
      edges: p.edges.filter((e) => !object.edgeIds.includes(e.id)),
    }));
    this.activeObjectId.set(this.project().objects[0]?.id ?? '');
    this.select(null);
    this.cancel();
  }
  activateObject(id: string): void {
    if (!this.project().objects.some((o) => o.id === id)) return;
    this.select(null);
    this.activeObjectId.set(id);
    this.cancel();
  }
  createCollection(objectId?: string): string | null {
    const project = this.project();
    if (
      (project.collections?.length ?? 0) >= 1000 ||
      (objectId && !project.objects.some((o) => o.id === objectId))
    )
      return null;
    const collection = {
      id: this.id('collection'),
      name: `Collection ${String((project.collections?.length ?? 0) + 1).padStart(2, '0')}`,
    };
    this.history.record(project);
    this.project.set({
      ...project,
      collections: [...(project.collections ?? []), collection],
      objects: objectId
        ? project.objects.map((o) =>
            o.id === objectId ? { ...o, collectionId: collection.id } : o,
          )
        : project.objects,
    });
    this.cancel();
    this.notice.set(
      `${collection.name} created.${objectId ? ' Object moved into the collection.' : ' Move objects into it using their right-click menu or Properties.'}`,
    );
    return collection.id;
  }
  renameCollection(id: string, name: string): void {
    const collection = this.project().collections?.find((c) => c.id === id);
    name = name.trim().slice(0, 120);
    if (!collection || !name || name === collection.name) return;
    this.history.record(this.project());
    this.project.update((p) => ({
      ...p,
      collections: p.collections!.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
    this.cancel();
  }
  moveObjectToCollection(id: string, collectionId: string | null): void {
    const project = this.project(),
      object = project.objects.find((o) => o.id === id);
    const collection = project.collections?.find((c) => c.id === collectionId);
    if (
      !object ||
      (collectionId !== null && !collection) ||
      (object.collectionId ?? null) === collectionId
    )
      return;
    this.history.record(project);
    this.project.set({
      ...project,
      objects: project.objects.map((o) => {
        if (o.id !== id) return o;
        const { collectionId: previous, ...ungrouped } = o;
        return collectionId ? { ...ungrouped, collectionId } : ungrouped;
      }),
    });
    this.cancel();
    this.notice.set(
      `${object.name} moved to ${collection?.name ?? 'Ungrouped'}. Geometry and layer are unchanged.`,
    );
  }
  deleteCollection(id: string): void {
    const project = this.project(),
      collection = project.collections?.find((c) => c.id === id);
    if (!collection) return;
    this.history.record(project);
    this.project.set({
      ...project,
      collections: project.collections!.filter((c) => c.id !== id),
      objects: project.objects.map((o) => {
        if (o.collectionId !== id) return o;
        const { collectionId, ...ungrouped } = o;
        return ungrouped;
      }),
    });
    this.cancel();
    this.notice.set(
      `${collection.name} removed. Its objects are now Ungrouped. Undo restores the collection.`,
    );
  }
  createLayer(): string {
    this.history.record(this.project());
    const id = this.id('layer');
    this.project.update((p) => ({
      ...p,
      layers: [
        ...p.layers,
        {
          id,
          name: `Layer ${p.layers.length + 1}`,
          visible: true,
          locked: false,
        },
      ],
    }));
    this.cancel();
    this.notice.set(
      'Empty layer created. Assign an object using Active object → Layer in Properties.',
    );
    return id;
  }
  activateLayer(id: string): void {
    const layer = this.project().layers.find((l) => l.id === id);
    if (!layer?.visible || layer.locked) return;
    const object = this.project().objects.find((o) => o.layerId === id && o.visible && !o.locked);
    if (!object) {
      this.notice.set(
        `${layer.name} has no visible, unlocked object. Assign an object to it in Properties or create one explicitly.`,
      );
      return;
    }
    this.select(null);
    this.cancel();
    this.activeObjectId.set(object.id);
  }
  setLayerAxis(id: string, axis: Axis | ''): void {
    const layer = this.project().layers.find((l) => l.id === id);
    if (!layer || (axis !== '' && !['x', 'y', 'z'].includes(axis))) return;
    const selected = this.selected();
    const first = this.project().points.find((p) =>
      this.project().objects.some((o) => o.layerId === id && o.pointIds.includes(p.id)),
    );
    const value = axis
      ? selected &&
        this.project().objects.some((o) => o.layerId === id && o.pointIds.includes(selected.id))
        ? selected[axis]
        : (first?.[axis] ?? this.planeDepth())
      : 0;
    this.updateLayer(id, { plane: axis ? { axis, value } : undefined });
  }
  setLayerValue(id: string, value: number): void {
    const layer = this.project().layers.find((l) => l.id === id);
    if (layer?.plane) this.updateLayer(id, { plane: { ...layer.plane, value } });
  }
  updateLayer(
    id: string,
    patch: Partial<Pick<BlueprintLayer, 'name' | 'visible' | 'locked' | 'plane'>>,
  ): void {
    const layer = this.project().layers.find((l) => l.id === id);
    if (!layer) return;
    if (
      'plane' in patch &&
      (layer.locked ||
        (patch.plane &&
          (!['x', 'y', 'z'].includes(patch.plane.axis) ||
            !Number.isFinite(patch.plane.value) ||
            Math.abs(patch.plane.value) > 1e9)))
    )
      return;
    const plane = patch.plane;
    const lockedIds = new Set(
      this.project()
        .objects.filter((o) => o.layerId === id && o.locked)
        .flatMap((o) => o.pointIds),
    );
    if (
      plane &&
      this.project().points.some((p) => lockedIds.has(p.id) && p[plane.axis] !== plane.value)
    ) {
      this.notice.set('Unlock objects on this layer before changing their fixed coordinate.');
      return;
    }
    if (patch.name !== undefined) {
      if (!patch.name.trim()) return;
      patch = { ...patch, name: patch.name.trim().slice(0, 120) };
    }
    this.history.record(this.project());
    const ids = new Set(
      this.project()
        .objects.filter((o) => o.layerId === id)
        .flatMap((o) => o.pointIds),
    );
    this.project.update((p) => ({
      ...p,
      points: patch.plane
        ? p.points.map((point) =>
            ids.has(point.id) ? this.constrainPoint(point, patch.plane) : point,
          )
        : p.points,
      layers: p.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
    this.selection.set(this.selectedIds());
    this.cancel();
    if (patch.plane)
      this.notice.set(
        `${layer.name}: all points keep ${patch.plane.axis.toUpperCase()} = ${patch.plane.value}. Existing points have been aligned.`,
      );
  }
  deleteLayer(id: string): void {
    if (this.project().layers.length < 2 || !this.project().layers.some((l) => l.id === id)) return;
    const destination = this.project().layers.find((l) => l.id !== id)!;
    const source = this.project().layers.find((l) => l.id === id)!;
    const plane = destination.plane;
    const lockedIds = new Set(
      this.project()
        .objects.filter(
          (o) => o.layerId === id && (o.locked || source.locked || destination.locked),
        )
        .flatMap((o) => o.pointIds),
    );
    if (
      plane &&
      this.project().points.some((p) => lockedIds.has(p.id) && p[plane.axis] !== plane.value)
    ) {
      this.notice.set(
        'Unlock the affected objects and layers before moving their points to a fixed layer.',
      );
      return;
    }
    this.history.record(this.project());
    const ids = new Set(
      this.project()
        .objects.filter((o) => o.layerId === id)
        .flatMap((o) => o.pointIds),
    );
    this.project.update((p) => ({
      ...p,
      points: destination.plane
        ? p.points.map((point) =>
            ids.has(point.id) ? this.constrainPoint(point, destination.plane) : point,
          )
        : p.points,
      layers: p.layers.filter((l) => l.id !== id),
      objects: p.objects.map((o) => (o.layerId === id ? { ...o, layerId: destination.id } : o)),
    }));
    this.selection.set(this.selectedIds());
    this.cancel();
  }
}
