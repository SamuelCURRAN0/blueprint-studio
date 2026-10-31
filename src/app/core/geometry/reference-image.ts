import { Position, ReferenceImage } from '../models/blueprint';

export const MAX_REFERENCE_DATA_LENGTH = 300_000;

/** Top-left and bottom-right in world coordinates (vertical axis points up). */
export function referenceCorners(image: ReferenceImage): [Position, Position] {
  const height = (image.width * image.pixelHeight) / image.pixelWidth;
  return [
    { u: image.centerU - image.width / 2, v: image.centerV + height / 2 },
    { u: image.centerU + image.width / 2, v: image.centerV - height / 2 },
  ];
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
