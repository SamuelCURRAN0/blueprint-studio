import {
  BlueprintPoint,
  Position,
  Projection,
  ViewportTransform,
  ViewType,
  VIEW_AXES,
} from '../models/blueprint';

export function projectPoint(point: BlueprintPoint, view: ViewType): Position {
  const [u, v] = VIEW_AXES[view];
  return { u: point[u], v: point[v] };
}
export function screenToWorld(position: Position, transform: ViewportTransform): Position {
  validateTransform(transform);
  return {
    u: (position.u - transform.panX) / transform.scale,
    v: (transform.panY - position.v) / transform.scale,
  };
}
export function worldToScreen(position: Position, transform: ViewportTransform): Position {
  validateTransform(transform);
  return {
    u: transform.panX + position.u * transform.scale,
    v: transform.panY - position.v * transform.scale,
  };
}
function validateTransform(transform: ViewportTransform): void {
  if (
    !Number.isFinite(transform.scale) ||
    transform.scale <= 0 ||
    !Number.isFinite(transform.panX) ||
    !Number.isFinite(transform.panY)
  )
    throw new Error('Invalid viewport transform.');
}
export function combineProjections(first: Projection, second: Projection, id = ''): BlueprintPoint {
  if (first.view === second.view) throw new Error('Choose two distinct orthographic views.');
  const coordinates: Partial<Record<'x' | 'y' | 'z', number>> = {};
  for (const projection of [first, second]) {
    VIEW_AXES[projection.view].forEach((axis, i) => {
      const value = i === 0 ? projection.position.u : projection.position.v;
      if (!Number.isFinite(value)) throw new Error('Coordinates must be finite.');
      const previous = coordinates[axis];
      if (previous !== undefined && Math.abs(previous - value) > 1e-7)
        throw new Error(`Conflicting ${axis.toUpperCase()} coordinates.`);
      if (previous === undefined) coordinates[axis] = value;
    });
  }
  if (coordinates.x === undefined || coordinates.y === undefined || coordinates.z === undefined)
    throw new Error('Incomplete projections.');
  return { id, x: coordinates.x, y: coordinates.y, z: coordinates.z };
}
/** Preserve the first click's shared coordinate; only the missing axis follows the cursor. */
export function constrainProjection(
  first: Projection,
  view: ViewType,
  position: Position,
): Projection {
  const firstAxes = VIEW_AXES[first.view];
  const values = [first.position.u, first.position.v];
  const next = { ...position };
  VIEW_AXES[view].forEach((axis, index) => {
    const shared = firstAxes.indexOf(axis);
    if (shared >= 0) next[index === 0 ? 'u' : 'v'] = values[shared];
  });
  return { view, position: next };
}
export function movePointInView(
  point: BlueprintPoint,
  view: ViewType,
  position: Position,
): BlueprintPoint {
  if (!Number.isFinite(position.u) || !Number.isFinite(position.v))
    throw new Error('Coordinates must be finite.');
  const [u, v] = VIEW_AXES[view];
  return { ...point, [u]: position.u, [v]: position.v };
}
export function snapToGrid(position: Position, size: number): Position {
  if (!Number.isFinite(size) || size <= 0) throw new Error('Grid size must be positive.');
  const snap = (value: number) => Number((Math.round(value / size) * size).toPrecision(12)) || 0;
  return { u: snap(position.u), v: snap(position.v) };
}
export function distanceToSegment(p: Position, a: Position, b: Position): number {
  const dx = b.u - a.u,
    dy = b.v - a.v;
  const t =
    dx || dy
      ? Math.max(0, Math.min(1, ((p.u - a.u) * dx + (p.v - a.v) * dy) / (dx * dx + dy * dy)))
      : 0;
  return Math.hypot(p.u - a.u - t * dx, p.v - a.v - t * dy);
}

export function fitViewport(points: Position[], width: number, height: number): ViewportTransform {
  if (!points.length) return { scale: 40, panX: width / 2, panY: height / 2 };
  const bounds = points.reduce(
    (b, p) => ({
      minU: Math.min(b.minU, p.u),
      maxU: Math.max(b.maxU, p.u),
      minV: Math.min(b.minV, p.v),
      maxV: Math.max(b.maxV, p.v),
    }),
    { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity },
  );
  const spanU = bounds.maxU - bounds.minU,
    spanV = bounds.maxV - bounds.minV;
  const scale =
    spanU === 0 && spanV === 0
      ? 40
      : Math.max(
          1e-7,
          Math.min(
            1e6,
            (width - Math.min(100, width / 3)) / Math.max(spanU, 1e-12),
            (height - Math.min(100, height / 3)) / Math.max(spanV, 1e-12),
          ),
        );
  return {
    scale,
    panX: width / 2 - (bounds.minU + spanU / 2) * scale,
    panY: height / 2 + (bounds.minV + spanV / 2) * scale,
  };
}
