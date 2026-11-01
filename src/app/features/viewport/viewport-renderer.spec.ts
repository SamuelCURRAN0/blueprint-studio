import { emptyProject } from '../../core/services/blueprint.service';
import { renderViewport, RenderScene } from './viewport-renderer';

describe('reference underlay rendering', () => {
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
