import { emptyProject } from '../../core/services/blueprint.service';
import { renderViewport, RenderScene } from './viewport-renderer';

describe('reference underlay rendering', () => {
  it.each([false, true])(
    'omits hidden collection points and edges from canvas/export rendering (%s)',
    (exporting) => {
      const project = emptyProject();
      project.collections = [{ id: 'frame', name: 'Frame', visible: false }];
      project.points = [
        { id: 'a', x: 0, y: 0, z: 0 },
        { id: 'b', x: 1, y: 0, z: 1 },
      ];
      project.edges = [{ id: 'edge', startPointId: 'a', endPointId: 'b' }];
      project.objects[0] = {
        ...project.objects[0],
        collectionId: 'frame',
        pointIds: ['a', 'b'],
        edgeIds: ['edge'],
      };
      const methods = [
        'clearRect',
        'fillRect',
        'beginPath',
        'moveTo',
        'lineTo',
        'stroke',
        'fillText',
        'arc',
        'fill',
        'setLineDash',
      ];
      const ctx = Object.fromEntries(
        methods.map((name) => [name, vi.fn()]),
      ) as unknown as CanvasRenderingContext2D;
      const scene: RenderScene = {
        project,
        points: project.points,
        view: 'front',
        transform: { scale: 20, panX: 100, panY: 100 },
        width: 400,
        height: 300,
        grid: false,
        gridSize: 0.5,
        labels: false,
        selectedId: null,
        pending: null,
        preview: null,
      };
      renderViewport(ctx, scene, exporting);
      expect(ctx.arc).not.toHaveBeenCalled();
      const axisStrokes = vi.mocked(ctx.stroke).mock.calls.length;
      vi.mocked(ctx.stroke).mockClear();
      project.collections[0].visible = true;
      renderViewport(ctx, scene, exporting);
      expect(ctx.arc).toHaveBeenCalledTimes(2);
      expect(ctx.stroke).toHaveBeenCalledTimes(axisStrokes + 3);
    },
  );
  it.each([undefined, 90, -37])(
    'uses the geometry transform and image-center rotation (%s), and omits hidden references and exports',
    (rotation) => {
      const project = emptyProject();
      project.referenceImages = {
        front: {
          name: 'reference.png',
          dataUrl: 'data:image/png;base64,YQ==',
          pixelWidth: 800,
          pixelHeight: 400,
          centerU: 2,
          centerV: -3,
          width: 10,
          rotation,
          opacity: 0.4,
          visible: true,
        },
      };
      const methods = [
        'clearRect',
        'fillRect',
        'beginPath',
        'moveTo',
        'lineTo',
        'stroke',
        'fillText',
        'save',
        'restore',
        'translate',
        'rotate',
        'drawImage',
        'setLineDash',
        'strokeRect',
      ];
      const ctx = Object.fromEntries(
        methods.map((name) => [name, vi.fn()]),
      ) as unknown as CanvasRenderingContext2D;
      const image = {} as HTMLImageElement;
      const scene: RenderScene = {
        project,
        view: 'front',
        points: [],
        transform: { scale: 20, panX: 100, panY: 200 },
        width: 400,
        height: 300,
        grid: false,
        gridSize: 0.5,
        labels: false,
        selectedId: null,
        pending: null,
        preview: null,
        referenceImage: image,
      };
      renderViewport(ctx, scene);
      expect(ctx.translate).toHaveBeenCalledExactlyOnceWith(140, 260);
      expect(ctx.rotate).toHaveBeenCalledExactlyOnceWith(((rotation ?? 0) * Math.PI) / 180);
      expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(image, -100, -50, 200, 100);
      vi.mocked(ctx.drawImage).mockClear();
      renderViewport(ctx, scene, true);
      expect(ctx.drawImage).not.toHaveBeenCalled();
      project.referenceImages.front!.visible = true;
      scene.referenceEditing = true;
      for (const scale of [5, 80]) {
        scene.transform.scale = scale;
        vi.mocked(ctx.strokeRect).mockClear();
        renderViewport(ctx, scene);
        expect(ctx.strokeRect).toHaveBeenCalledTimes(4);
        for (const [, , width, height] of vi.mocked(ctx.strokeRect).mock.calls) {
          expect(width).toBe(8);
          expect(height).toBe(8);
        }
      }
      vi.mocked(ctx.strokeRect).mockClear();
      vi.mocked(ctx.drawImage).mockClear();
      renderViewport(ctx, scene, true);
      expect(ctx.strokeRect).not.toHaveBeenCalled();
      project.referenceImages.front!.visible = false;
      renderViewport(ctx, scene);
      expect(ctx.strokeRect).not.toHaveBeenCalled();
      expect(ctx.drawImage).not.toHaveBeenCalled();
    },
  );
});
