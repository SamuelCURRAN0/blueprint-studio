import { parseProject, ProjectStorageService } from './project-storage.service';
import { demoProject } from '../geometry/demo-project';
import { emptyProject } from './blueprint.service';
import { HistoryService } from './history.service';
import { exportSvg, exportTransform } from '../geometry/export';
import { projectPoint, worldToScreen } from '../geometry/geometry';
import { VIEW_TYPES } from '../models/blueprint';

describe('project persistence and export', () => {
  it('round trips collections and their memberships, strips unknown fields, and keeps legacy projects unchanged', () => {
    const legacy = emptyProject();
    expect(parseProject(JSON.stringify(legacy))).toEqual(legacy);
    const project = { ...legacy, collections: [{ id: 'collection-1', name: 'Frame' }] };
    project.objects[0].collectionId = 'collection-1';
    const imported = JSON.parse(JSON.stringify(project));
    imported.collections[0].extra = 'untrusted';
    expect(parseProject(JSON.stringify(imported))).toEqual(project);
    const storage = new ProjectStorageService();
    storage.save(project, true);
    expect(storage.load(true)).toEqual(project);
  });
  it.each([
    null,
    {},
    [{ id: 'a', name: '' }],
    [
      { id: 'a', name: 'A' },
      { id: 'a', name: 'B' },
    ],
  ])('rejects invalid collections: %j', (collections) => {
    expect(() => parseProject(JSON.stringify({ ...emptyProject(), collections }))).toThrow();
  });
  it('rejects object memberships that reference missing collections', () => {
    const project = emptyProject();
    project.objects[0].collectionId = 'missing';
    expect(() => parseProject(JSON.stringify(project))).toThrow(/collection/);
  });
  it('round trips a fixed layer, strips extra plane properties, and supports old free layers', () => {
    const project = emptyProject();
    project.layers[0].plane = { axis: 'z', value: -3 };
    project.points = [{ id: 'a', x: 1, y: 2, z: -3 }];
    project.objects[0].pointIds = ['a'];
    expect(parseProject(JSON.stringify(project))).toEqual(project);
    const storage = new ProjectStorageService();
    storage.save(project, true);
    expect(storage.load(true)).toEqual(project);
    const imported = JSON.parse(JSON.stringify(project));
    imported.layers[0].plane.extra = 'untrusted';
    expect(parseProject(JSON.stringify(imported))).toEqual(project);
    delete project.layers[0].plane;
    expect(parseProject(JSON.stringify(project))).toEqual(project);
  });
  it.each([
    null,
    [],
    {},
    { axis: 'w', value: 1 },
    { axis: 'z', value: '1' },
    { axis: 'z', value: 1e10 },
  ])('rejects an invalid layer plane: %j', (plane) => {
    const project = emptyProject();
    const imported = { ...project, layers: [{ ...project.layers[0], plane }] };
    expect(() => parseProject(JSON.stringify(imported))).toThrow(/layer coordinate/);
  });
  it('rejects geometry inconsistent with its fixed layer', () => {
    const project = demoProject();
    project.layers[0].plane = { axis: 'z', value: 99 };
    expect(() => parseProject(JSON.stringify(project))).toThrow(/fixed coordinate/);
  });
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
        rotation: -37.5,
        opacity: 0.4,
        visible: false,
      },
    };
    expect(parseProject(JSON.stringify(project))).toEqual(project);
    const storage = new ProjectStorageService();
    storage.save(project);
    expect(storage.load()).toEqual(project);
    project.referenceImages.back = {
      ...project.referenceImages.front!,
      name: 'back.png',
      width: 12,
      centerU: -4,
      rotation: 90,
      visible: true,
    };
    storage.save(project);
    expect(storage.load()).toEqual(project);
    expect(parseProject(JSON.stringify(project)).referenceImages?.back).toEqual(
      project.referenceImages.back,
    );
    expect(project.referenceImages.front!.width).toBe(10);
    project.referenceImages.top = { ...project.referenceImages.front!, name: 'top.png', width: 8 };
    project.referenceImages.bottom = {
      ...project.referenceImages.front!,
      name: 'bottom.png',
      width: 13,
      rotation: 90,
      centerV: -2,
    };
    storage.save(project);
    expect(storage.load()).toEqual(project);
    expect(parseProject(JSON.stringify(project)).referenceImages?.bottom).toEqual(
      project.referenceImages.bottom,
    );
    expect(project.referenceImages.top.width).toBe(8);
    delete project.referenceImages.front!.rotation;
    expect(parseProject(JSON.stringify(project))).toEqual(project);
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
      { rotation: 360.1 },
      { rotation: null },
      { rotation: '90' },
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
    for (const view of VIEW_TYPES) {
      const svg = exportSvg(project, view, project.points);
      expect(svg).toContain('viewBox="0 0 1200 1200"');
      expect(svg).toContain(`Shared scale ${transform.scale}`);
      expect(svg.match(/<circle /g)).toHaveLength(project.points.length);
    }
  });
  it('keeps mirrored Back geometry inside the common export sheet for positive X models', () => {
    const project = emptyProject();
    project.points = [
      { id: 'a', x: 2, y: 1, z: 8 },
      { id: 'b', x: 10, y: 4, z: 2 },
    ];
    const transform = exportTransform(project);
    for (const view of VIEW_TYPES) {
      for (const point of project.points) {
        const screen = worldToScreen(projectPoint(point, view), transform);
        expect(screen.u).toBeGreaterThanOrEqual(0);
        expect(screen.u).toBeLessThanOrEqual(1200);
        expect(screen.v).toBeGreaterThanOrEqual(0);
        expect(screen.v).toBeLessThanOrEqual(1200);
      }
    }
    const p = project.points[0];
    const front = worldToScreen(projectPoint(p, 'front'), transform);
    const back = worldToScreen(projectPoint(p, 'back'), transform);
    expect(front.u + back.u).toBeCloseTo(2 * transform.panX);
    expect(front.v).toBe(back.v);
  });
});
