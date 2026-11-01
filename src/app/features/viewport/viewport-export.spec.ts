import { emptyProject } from '../../core/services/blueprint.service';
import { VIEW_TYPES } from '../../core/models/blueprint';
import { exportTransform } from '../../core/geometry/export';
import { projectPoint, worldToScreen } from '../../core/geometry/geometry';
import { renderPng } from './viewport-export';

describe('PNG rendering', () => {
  function context(): CanvasRenderingContext2D {
    return Object.fromEntries(
      [
        'clearRect',
        'fillRect',
        'beginPath',
        'moveTo',
        'lineTo',
        'stroke',
        'fillText',
        'arc',
        'fill',
      ].map((name) => [name, vi.fn()]),
    ) as unknown as CanvasRenderingContext2D;
  }
  afterEach(() => vi.restoreAllMocks());
  it.each(VIEW_TYPES)(
    'renders %s to a 1200px PNG using the shared sheet transform',
    async (view) => {
      const ctx = context();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
      const blob = new Blob(['png'], { type: 'image/png' });
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        callback,
        type,
      ) {
        expect(this.width).toBe(1200);
        expect(this.height).toBe(1200);
        expect(type).toBe('image/png');
        callback(blob);
      });
      const project = emptyProject();
      project.points = [{ id: 'p1', x: 2, y: 3, z: 4 }];
      project.objects[0].pointIds = ['p1'];
      expect(await renderPng(project, project.points, view, 0.5)).toBe(blob);
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1200, 1200);
      const p = worldToScreen(projectPoint(project.points[0], view), exportTransform(project));
      expect(ctx.arc).toHaveBeenCalledWith(p.u, p.v, 3, 0, Math.PI * 2);
    },
  );
  it('reports unavailable canvases and failed encodes instead of downloading an empty file', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(renderPng(emptyProject(), [], 'front', 0.5)).rejects.toThrow(/unavailable/);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context());
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(null),
    );
    await expect(renderPng(emptyProject(), [], 'bottom', 0.5)).rejects.toThrow(/bottom/);
  });
});
