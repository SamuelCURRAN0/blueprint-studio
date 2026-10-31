import { parseProject, ProjectStorageService } from './project-storage.service';
import { demoProject } from '../geometry/demo-project';
import { emptyProject } from './blueprint.service';
import { HistoryService } from './history.service';
import { exportSvg, exportTransform } from '../geometry/export';
import { projectPoint, worldToScreen } from '../geometry/geometry';

describe('project persistence and export', () => {
  it('round trips the complete demo graph without duplicated point IDs', () => {
    const project = demoProject();
    expect(parseProject(JSON.stringify(project))).toEqual(project);
    expect(new Set(project.points.map((p) => p.id)).size).toBe(project.points.length);
  });
  it('rejects malformed JSON, unsupported versions and non-finite coordinates', () => {
    expect(() => parseProject('{')).toThrow(/JSON/);
    expect(() => parseProject(JSON.stringify({ ...emptyProject(), version: 2 }))).toThrow(
      /version/,
    );
    const project = demoProject();
    project.points[0].x = Infinity;
    expect(() => parseProject(JSON.stringify(project))).toThrow(/coordinates/);
  });
  it('rejects broken edges, repeated IDs and orphan points', () => {
    const badEdge = demoProject();
    badEdge.edges[0].endPointId = 'missing';
    expect(() => parseProject(JSON.stringify(badEdge))).toThrow(/endpoint/);
    const duplicate = demoProject();
    duplicate.points[1].id = duplicate.points[0].id;
    expect(() => parseProject(JSON.stringify(duplicate))).toThrow(/unique/);
    const orphan = demoProject();
    orphan.objects[0].pointIds.pop();
    expect(() => parseProject(JSON.stringify(orphan))).toThrow(/owning/);
  });
  it('keeps explicit saves independent from recovery copies', () => {
    const storage = new ProjectStorageService();
    const project = demoProject();
    storage.save(project);
    storage.save(emptyProject(), true);
    expect(storage.load()).toEqual(project);
    expect(storage.load(true)).toEqual(emptyProject());
  });
  it('round trips embedded references through JSON and local storage while keeping legacy files valid', () => {
    const project = emptyProject();
    project.referenceImages = {
      front: {
        name: 'reference.png',
        dataUrl: 'data:image/png;base64,YQ==',
        pixelWidth: 800,
        pixelHeight: 400,
        centerU: -2,
        centerV: 3,
        width: 10,
        opacity: 0.4,
        visible: false,
      },
    };
    expect(parseProject(JSON.stringify(project))).toEqual(project);
    const storage = new ProjectStorageService();
    storage.save(project);
    expect(storage.load()).toEqual(project);
    expect(parseProject(JSON.stringify(emptyProject()))).toEqual(emptyProject());
  });
  it('rejects external image URLs, invalid views, dimensions and opacity', () => {
    const reference = {
      name: 'reference.png',
      dataUrl: 'data:image/png;base64,YQ==',
      pixelWidth: 800,
      pixelHeight: 400,
      centerU: 0,
      centerV: 0,
      width: 10,
      opacity: 0.5,
      visible: true,
    };
    for (const patch of [
      { dataUrl: 'https://example.com/image.png' },
      { width: -1 },
      { pixelHeight: 0 },
      { opacity: 1.1 },
      { centerU: '0' },
      { dataUrl: 'data:image/svg+xml;base64,YQ==' },
    ]) {
      expect(() =>
        parseProject(
          JSON.stringify({
            ...emptyProject(),
            referenceImages: { front: { ...reference, ...patch } },
          }),
        ),
      ).toThrow(/reference image/);
    }
    expect(() =>
      parseProject(
        JSON.stringify({ ...emptyProject(), referenceImages: { perspective: reference } }),
      ),
    ).toThrow(/views/);
  });
  it('undoes and redoes snapshots without mutating older geometry', () => {
    const history = new HistoryService(),
      original = emptyProject(),
      modified = demoProject();
    history.record(original);
    original.name = 'changed after recording';
    expect(history.undo(modified)?.name).toBe('Untitled blueprint');
    expect(history.redo(emptyProject())).toEqual(modified);
  });
  it('aligns the shared axes and preserves scale in every exported view', () => {
    const project = demoProject(),
      transform = exportTransform(project);
    const p = { id: 'test', x: -2, y: 5, z: 3 };
    const front = worldToScreen(projectPoint(p, 'front'), transform),
      side = worldToScreen(projectPoint(p, 'side'), transform),
      top = worldToScreen(projectPoint(p, 'top'), transform);
    expect(front.u).toBe(top.u);
    expect(front.v).toBe(side.v);
    expect(side.u - transform.panX).toBeCloseTo(transform.panY - top.v);
    for (const view of ['front', 'side', 'top'] as const) {
      const svg = exportSvg(project, view, project.points);
      expect(svg).toContain('viewBox="0 0 1200 1200"');
      expect(svg).toContain(`Shared scale ${transform.scale}`);
      expect(svg.match(/<circle /g)).toHaveLength(project.points.length);
    }
  });
});
