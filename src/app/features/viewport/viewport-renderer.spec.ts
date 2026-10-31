import { emptyProject } from '../../core/services/blueprint.service';
import { renderViewport, RenderScene } from './viewport-renderer';

describe('reference underlay rendering', () => {
  it('uses the geometry transform for image position and scale, and omits hidden references and exports', () => {
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
      'drawImage',
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
    expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(image, 40, 210, 200, 100);
    vi.mocked(ctx.drawImage).mockClear();
    renderViewport(ctx, scene, true);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    project.referenceImages.front!.visible = false;
    renderViewport(ctx, scene);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
