import { referenceCorners, readReferenceImage } from './reference-image';

describe('reference images', () => {
  it('preserves image aspect ratio and positions its corners on the upward world axis', () => {
    expect(
      referenceCorners({
        name: 'reference',
        dataUrl: '',
        pixelWidth: 800,
        pixelHeight: 400,
        centerU: -3,
        centerV: 2,
        width: 10,
        opacity: 0.5,
        visible: true,
      }),
    ).toEqual([
      { u: -8, v: 4.5 },
      { u: 2, v: -0.5 },
    ]);
  });
  it('rejects unsupported and oversized uploads before decoding them', async () => {
    await expect(
      readReferenceImage(new File(['<svg/>'], 'reference.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow(/PNG/);
    await expect(
      readReferenceImage(
        new File([new Uint8Array(10_000_001)], 'large.png', { type: 'image/png' }),
      ),
    ).rejects.toThrow(/10 MB/);
  });
});
