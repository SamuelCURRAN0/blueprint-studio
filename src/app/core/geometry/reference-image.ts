import { Position, ReferenceImage } from '../models/blueprint';

export const MAX_REFERENCE_DATA_LENGTH = 300_000;

/** Hit-test the actual image rectangle, including its rotation. */
export function containsReference(image: ReferenceImage, position: Position): boolean {
  const angle = ((image.rotation ?? 0) * Math.PI) / 180;
  const du = position.u - image.centerU,
    dv = position.v - image.centerV;
  const u = du * Math.cos(angle) - dv * Math.sin(angle);
  const v = du * Math.sin(angle) + dv * Math.cos(angle);
  return (
    Math.abs(u) <= image.width / 2 &&
    Math.abs(v) <= (image.width * image.pixelHeight) / image.pixelWidth / 2
  );
}

/** All four rotated corners in world coordinates (vertical axis points up). */
export function referenceCorners(image: ReferenceImage): Position[] {
  const height = (image.width * image.pixelHeight) / image.pixelWidth;
  const angle = ((image.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return [
    { u: -image.width / 2, v: height / 2 },
    { u: image.width / 2, v: height / 2 },
    { u: image.width / 2, v: -height / 2 },
    { u: -image.width / 2, v: -height / 2 },
  ].map(({ u, v }) => ({
    u: image.centerU + u * cos + v * sin,
    v: image.centerV - u * sin + v * cos,
  }));
}

/** Uniform corner resize with the opposite corner fixed, preserving rotation and proportions. */
export function resizeReference(
  image: ReferenceImage,
  corner: number,
  delta: Position,
): Pick<ReferenceImage, 'width' | 'centerU' | 'centerV'> {
  const corners = referenceCorners(image);
  const anchor = corners[(corner + 2) % 4];
  const du = corners[corner].u - anchor.u,
    dv = corners[corner].v - anchor.v;
  const factor = 1 + (delta.u * du + delta.v * dv) / (du * du + dv * dv);
  const width = Math.max(0.000001, Math.min(1e9, image.width * factor));
  const scale = width / image.width;
  return { width, centerU: anchor.u + (du * scale) / 2, centerV: anchor.v + (dv * scale) / 2 };
}

export function validReferenceImage(image: ReferenceImage): boolean {
  return (
    !!image &&
    typeof image.name === 'string' &&
    image.name.trim().length > 0 &&
    image.name.length <= 120 &&
    typeof image.dataUrl === 'string' &&
    image.dataUrl.length <= MAX_REFERENCE_DATA_LENGTH &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl) &&
    [image.pixelWidth, image.pixelHeight].every((n) => Number.isInteger(n) && n > 0 && n <= 4096) &&
    [image.centerU, image.centerV].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9) &&
    Number.isFinite(image.width) &&
    image.width >= 0.000001 &&
    image.width <= 1e9 &&
    (image.rotation === undefined ||
      (Number.isFinite(image.rotation) && Math.abs(image.rotation) <= 360)) &&
    Number.isFinite(image.opacity) &&
    image.opacity >= 0 &&
    image.opacity <= 1 &&
    typeof image.visible === 'boolean'
  );
}

/** Resize large uploads so three embedded references remain practical for local storage. */
export async function readReferenceImage(
  file: File,
): Promise<Pick<ReferenceImage, 'name' | 'dataUrl' | 'pixelWidth' | 'pixelHeight'>> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Choose a PNG, JPG or WebP image.');
  if (file.size > 10_000_000) throw new Error('Reference images must be smaller than 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    let ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    for (;;) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image import is unavailable in this browser.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/webp', 0.9);
      if (dataUrl.length <= MAX_REFERENCE_DATA_LENGTH)
        return {
          name: file.name.trim().slice(0, 120) || 'Reference image',
          dataUrl,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
        };
      ratio *= 0.75;
    }
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes('unavailable')
        ? error.message
        : 'This image could not be read. Try another PNG, JPG or WebP file.',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
