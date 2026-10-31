import { BlueprintProject, ViewportTransform, ViewType } from '../models/blueprint';
import { projectPoint, worldToScreen } from './geometry';

/** Every view uses the same square, world origin and pixels per unit, independent of editor zoom. */
export function exportTransform(project: BlueprintProject, size = 1200): ViewportTransform {
  let min = project.points.length ? 0 : -5,
    max = project.points.length ? 0 : 5;
  for (const p of project.points) {
    min = Math.min(min, p.x, p.y, p.z);
    max = Math.max(max, p.x, p.y, p.z);
  }
  const span = Math.max(max - min, 1),
    scale = (size - 120) / span;
  return { scale, panX: 60 - min * scale, panY: size - 60 + min * scale };
}
export function exportSvg(
  project: BlueprintProject,
  view: ViewType,
  points: BlueprintProject['points'],
): string {
  const transform = exportTransform(project),
    byId = new Map(points.map((p) => [p.id, p]));
  const lines: string[] = [];
  for (const object of project.objects) {
    if (!object.visible) continue;
    for (const edge of project.edges) {
      if (!object.edgeIds.includes(edge.id)) continue;
      const a = byId.get(edge.startPointId),
        b = byId.get(edge.endPointId);
      if (!a || !b) continue;
      const start = worldToScreen(projectPoint(a, view), transform),
        end = worldToScreen(projectPoint(b, view), transform);
      lines.push(
        `<line x1="${start.u}" y1="${start.v}" x2="${end.u}" y2="${end.v}" stroke="${object.color}" stroke-width="1.5"/>`,
      );
    }
  }
  for (const point of points) {
    const p = worldToScreen(projectPoint(point, view), transform);
    const color = project.objects.find((o) => o.pointIds.includes(point.id))?.color ?? '#8cd5ba';
    lines.push(`<circle cx="${p.u}" cy="${p.v}" r="2.5" fill="${color}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><title>Blueprint Studio — ${view} projection</title><desc>Shared scale ${transform.scale} pixels per ${project.units}; world origin ${transform.panX}, ${transform.panY}. Positive horizontal axis points right; positive vertical axis points up.</desc><rect width="1200" height="1200" fill="#1b1e22"/>${lines.join('')}</svg>`;
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
