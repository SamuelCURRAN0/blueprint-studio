import {
  AXIS_COLORS,
  BlueprintPoint,
  BlueprintProject,
  Position,
  Projection,
  ViewportTransform,
  ViewType,
  VIEW_AXES,
  VIEW_HORIZONTAL_SIGN,
} from '../../core/models/blueprint';
import {
  constrainProjection,
  projectPoint,
  screenToWorld,
  worldToScreen,
} from '../../core/geometry/geometry';
import { referenceCorners } from '../../core/geometry/reference-image';

export interface RenderScene {
  project: BlueprintProject;
  points: BlueprintPoint[];
  view: ViewType;
  transform: ViewportTransform;
  width: number;
  height: number;
  grid: boolean;
  gridSize: number;
  labels: boolean;
  selectedId: string | null;
  pending: Projection | null;
  preview: BlueprintPoint | null;
  cursor?: Position | null;
  measurement?: { a: Position; b: Position } | null;
  rectangle?: { a: Position; b: Position } | null;
  chainId?: string | null;
  referenceImage?: CanvasImageSource | null;
  referenceEditing?: boolean;
}
export function renderViewport(
  ctx: CanvasRenderingContext2D,
  scene: RenderScene,
  exporting = false,
): void {
  const { width, height, transform: t, view } = scene;
  const screen = (p: Position) => worldToScreen(p, t);
  const line = (a: Position, b: Position, color: string, lineWidth = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(a.u, a.v);
    ctx.lineTo(b.u, b.v);
    ctx.stroke();
  };
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#1b1e22';
  ctx.fillRect(0, 0, width, height);
  const reference = scene.project.referenceImages?.[view];
  if (!exporting && reference?.visible && scene.referenceImage) {
    const center = screen({ u: reference.centerU, v: reference.centerV });
    const imageWidth = reference.width * t.scale;
    const imageHeight = (imageWidth * reference.pixelHeight) / reference.pixelWidth;
    ctx.save();
    ctx.globalAlpha = reference.opacity;
    ctx.translate(center.u, center.v);
    ctx.rotate(((reference.rotation ?? 0) * Math.PI) / 180);
    ctx.drawImage(scene.referenceImage, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
    ctx.restore();
  }
  const min = screenToWorld({ u: 0, v: height }, t),
    max = screenToWorld({ u: width, v: 0 }, t);
  let spacing = scene.gridSize;
  while (spacing * t.scale < 14) spacing *= 2;
  while (spacing * t.scale > 120) spacing /= 2;
  if (scene.grid) {
    for (let i = Math.floor(min.u / spacing); i <= Math.ceil(max.u / spacing); i++) {
      const x = screen({ u: i * spacing, v: 0 }).u;
      line({ u: x, v: 0 }, { u: x, v: height }, i % 5 === 0 ? '#30343a' : '#24282d');
    }
    for (let i = Math.floor(min.v / spacing); i <= Math.ceil(max.v / spacing); i++) {
      const y = screen({ u: 0, v: i * spacing }).v;
      line({ u: 0, v: y }, { u: width, v: y }, i % 5 === 0 ? '#30343a' : '#24282d');
    }
  }
  const [uAxis, vAxis] = VIEW_AXES[view];
  ctx.globalAlpha = 0.5;
  line({ u: 0, v: t.panY }, { u: width, v: t.panY }, AXIS_COLORS[uAxis]);
  line({ u: t.panX, v: 0 }, { u: t.panX, v: height }, AXIS_COLORS[vAxis]);
  ctx.globalAlpha = 1;
  ctx.font = '10px "Segoe UI", sans-serif';
  const labelStep = spacing * 2;
  ctx.fillStyle = '#69717b';
  ctx.textAlign = 'center';
  for (let i = Math.ceil(min.u / labelStep); i <= Math.floor(max.u / labelStep); i++) {
    if (!i) continue;
    ctx.fillText(
      format(i * labelStep * VIEW_HORIZONTAL_SIGN[view]),
      screen({ u: i * labelStep, v: 0 }).u,
      height - 10,
    );
  }
  ctx.textAlign = 'left';
  for (let i = Math.ceil(min.v / labelStep); i <= Math.floor(max.v / labelStep); i++) {
    if (!i) continue;
    ctx.fillText(format(i * labelStep), 9, screen({ u: 0, v: i * labelStep }).v + 3);
  }
  const byId = new Map(scene.points.map((p) => [p.id, p]));
  const pointOwners = new Map(
    scene.project.objects.flatMap((o) => o.pointIds.map((id) => [id, o] as const)),
  );
  const edgeOwners = new Map(
    scene.project.objects.flatMap((o) => o.edgeIds.map((id) => [id, o] as const)),
  );
  const pointNumbers = new Map(scene.project.points.map((p, i) => [p.id, i + 1]));
  const occupiedLabels: { x: number; y: number; width: number }[] = [];
  for (const edge of scene.project.edges) {
    const object = edgeOwners.get(edge.id);
    if (!object?.visible) continue;
    ctx.globalAlpha = object.locked ? 0.45 : 1;
    const a = byId.get(edge.startPointId),
      b = byId.get(edge.endPointId);
    if (a && b)
      line(screen(projectPoint(a, view)), screen(projectPoint(b, view)), object.color, 1.3);
  }
  ctx.globalAlpha = 1;
  for (const [index, point] of scene.points.entries()) {
    const pos = screen(projectPoint(point, view));
    const selected = point.id === scene.selectedId;
    const object = pointOwners.get(point.id);
    const color = selected ? '#9aead2' : (object?.color ?? '#b6c4cb');
    if (pos.u < -20 || pos.u > width + 20 || pos.v < -20 || pos.v > height + 20) continue;
    ctx.globalAlpha = object?.locked ? 0.5 : 1;
    if (selected) {
      ctx.fillStyle = '#8cd5ba20';
      ctx.beginPath();
      ctx.arc(pos.u, pos.v, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = selected ? '#a8f5df' : '#1b1e22';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(pos.u, pos.v, selected ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (scene.labels) {
      const label = `P${pointNumbers.get(point.id) ?? index + 1}`;
      ctx.font = '10px "Segoe UI", sans-serif';
      const box = { x: pos.u + 9, y: pos.v - 8, width: ctx.measureText(label).width + 6 };
      if (
        selected ||
        !occupiedLabels.some(
          (b) => Math.abs(b.y - box.y) < 12 && b.x < box.x + box.width && box.x < b.x + b.width,
        )
      ) {
        ctx.fillStyle = selected ? '#b5eedb' : '#8b979f';
        ctx.fillText(label, box.x, box.y);
        occupiedLabels.push(box);
      }
    }
  }
  ctx.globalAlpha = 1;
  const pending = scene.pending;
  if (pending && !exporting) {
    const firstAxes = VIEW_AXES[pending.view];
    ctx.setLineDash([5, 5]);
    VIEW_AXES[view].forEach((axis, index) => {
      const shared = firstAxes.indexOf(axis);
      if (shared < 0) return;
      const canonical =
        shared === 0 ? pending.position.u * VIEW_HORIZONTAL_SIGN[pending.view] : pending.position.v;
      const value = canonical * (index === 0 ? VIEW_HORIZONTAL_SIGN[view] : 1);
      const p = screen(index === 0 ? { u: value, v: 0 } : { u: 0, v: value });
      line(
        index === 0 ? { u: p.u, v: 0 } : { u: 0, v: p.v },
        index === 0 ? { u: p.u, v: height } : { u: width, v: p.v },
        '#cdbb7d',
        1,
      );
    });
    ctx.setLineDash([]);
    if (pending.view === view) marker(ctx, screen(pending.position), '#e7cf88');
    else if (scene.cursor)
      marker(ctx, screen(constrainProjection(pending, view, scene.cursor).position), '#e7cf88');
  }
  if (scene.preview && !exporting)
    marker(ctx, screen(projectPoint(scene.preview, view)), '#e7cf88');
  if (!exporting && scene.rectangle) {
    const a = screen(scene.rectangle.a),
      b = screen(scene.rectangle.b);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#e7cf88';
    ctx.lineWidth = 1;
    ctx.strokeRect(a.u, a.v, b.u - a.u, b.v - a.v);
    ctx.setLineDash([]);
  }
  if (!exporting && scene.chainId && scene.cursor) {
    const first = byId.get(scene.chainId);
    if (first) {
      ctx.setLineDash([4, 4]);
      line(screen(projectPoint(first, view)), screen(scene.cursor), '#e7cf88');
      ctx.setLineDash([]);
    }
  }
  if (scene.measurement) {
    const a = screen(scene.measurement.a),
      b = screen(scene.measurement.b);
    ctx.setLineDash([4, 3]);
    line(a, b, '#e7cf88');
    ctx.setLineDash([]);
    marker(ctx, a, '#e7cf88');
    marker(ctx, b, '#e7cf88');
    const distance = Math.hypot(
      scene.measurement.b.u - scene.measurement.a.u,
      scene.measurement.b.v - scene.measurement.a.v,
    );
    const text = `${format(distance)} ${scene.project.units}`;
    ctx.font = '11px monospace';
    const textWidth = ctx.measureText(text).width;
    ctx.fillStyle = '#30312c';
    ctx.fillRect((a.u + b.u - textWidth) / 2 - 6, (a.v + b.v) / 2 - 22, textWidth + 12, 20);
    ctx.fillStyle = '#e7cf88';
    ctx.fillText(text, (a.u + b.u - textWidth) / 2, (a.v + b.v) / 2 - 8);
  }
  if (!exporting && reference?.visible && scene.referenceEditing && scene.referenceImage) {
    const corners = referenceCorners(reference).map(screen);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.setLineDash([5, 4]);
    corners.forEach((p, i) => line(p, corners[(i + 1) % 4], '#8cd5ba'));
    ctx.setLineDash([]);
    ctx.fillStyle = '#1b1e22';
    for (const corner of corners) {
      ctx.fillRect(corner.u - 4, corner.v - 4, 8, 8);
      ctx.strokeRect(corner.u - 4, corner.v - 4, 8, 8);
    }
    ctx.restore();
  }
  // Axis compass stays the same size regardless of viewport scale.
  const origin = { u: width - 37, v: height - 35 };
  line(
    origin,
    { u: origin.u + 21 * VIEW_HORIZONTAL_SIGN[view], v: origin.v },
    AXIS_COLORS[uAxis],
    1.5,
  );
  line(origin, { u: origin.u, v: origin.v - 21 }, AXIS_COLORS[vAxis], 1.5);
  ctx.font = 'bold 10px "Segoe UI",sans-serif';
  ctx.fillStyle = AXIS_COLORS[uAxis];
  ctx.fillText(
    uAxis.toUpperCase(),
    origin.u + (VIEW_HORIZONTAL_SIGN[view] < 0 ? -28 : 24),
    origin.v + 3,
  );
  ctx.fillStyle = AXIS_COLORS[vAxis];
  ctx.fillText(vAxis.toUpperCase(), origin.u - 3, origin.v - 27);
}
function marker(ctx: CanvasRenderingContext2D, p: Position, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(p.u, p.v, 6, 0, Math.PI * 2);
  ctx.moveTo(p.u - 10, p.v);
  ctx.lineTo(p.u + 10, p.v);
  ctx.moveTo(p.u, p.v - 10);
  ctx.lineTo(p.u, p.v + 10);
  ctx.stroke();
}
export function format(value: number): string {
  return value !== 0 && Math.abs(value) < 0.001
    ? Number(value.toPrecision(3)).toString()
    : Number(value.toFixed(3)).toString();
}
