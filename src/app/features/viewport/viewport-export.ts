import { BlueprintPoint, BlueprintProject, ViewType } from '../../core/models/blueprint';
import { exportTransform } from '../../core/geometry/export';
import { renderViewport } from './viewport-renderer';

export async function renderPng(
  project: BlueprintProject,
  points: BlueprintPoint[],
  view: ViewType,
  gridSize: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PNG export is unavailable in this browser.');
  renderViewport(
    ctx,
    {
      project,
      points,
      view,
      transform: exportTransform(project),
      width: 1200,
      height: 1200,
      grid: false,
      gridSize,
      labels: false,
      selectedId: null,
      pending: null,
      preview: null,
    },
    true,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`Could not render the ${view} view.`));
    }, 'image/png'),
  );
}
