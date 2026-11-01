import { referenceCorners, readReferenceImage, resizeReference } from './reference-image';

describe('reference images', () => {
  it.each([0, 30, 90, -45])(
    'resizes all corners at %s degrees while preserving proportions and the opposite anchor',
    (rotation) => {
      const image = {
        name: 'reference',
        dataUrl: '',
        pixelWidth: 800,
        pixelHeight: 400,
        centerU: -3,
        centerV: 2,
        width: 10,
        rotation,
        opacity: 0.5,
        visible: true,
      };
      const original = referenceCorners(image);
      for (const corner of [0, 1, 2, 3]) {
        const anchor = original[(corner + 2) % 4];
        const delta = {
          u: (original[corner].u - anchor.u) / 2,
          v: (original[corner].v - anchor.v) / 2,
        };
        const patch = resizeReference(image, corner, delta);
        const resized = referenceCorners({ ...image, ...patch });
        expect(patch.width).toBeCloseTo(15);
        expect(resized[(corner + 2) % 4].u).toBeCloseTo(anchor.u);
        expect(resized[(corner + 2) % 4].v).toBeCloseTo(anchor.v);
        const w = Math.hypot(resized[1].u - resized[0].u, resized[1].v - resized[0].v);
        const h = Math.hypot(resized[2].u - resized[1].u, resized[2].v - resized[1].v);
        expect(w / h).toBeCloseTo(2);
      }
    },
  );
  it('prevents flipping and clamps supported sizes without moving the opposite anchor', () => {
    const image = {
      name: 'reference',
      dataUrl: '',
      pixelWidth: 800,
      pixelHeight: 400,
      centerU: 0,
      centerV: 0,
      width: 4,
      rotation: 0,
      opacity: 0.5,
      visible: true,
    };
    expect(resizeReference(image, 0, { u: 100, v: -100 }).width).toBe(0.000001);
    expect(resizeReference(image, 0, { u: -1e12, v: 1e12 }).width).toBe(1e9);
  });
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
      { u: 2, v: 4.5 },
      { u: 2, v: -0.5 },
      { u: -8, v: -0.5 },
    ]);
  });
  it.each([90, -90, 45, -37])(
    'rotates all corners clockwise around a fixed center at %s degrees',
    (rotation) => {
      const image = {
        name: 'reference',
        dataUrl: '',
        pixelWidth: 800,
        pixelHeight: 400,
        centerU: -3,
        centerV: 2,
        width: 10,
        rotation,
        opacity: 0.5,
        visible: true,
      };
      const corners = referenceCorners(image);
      expect(corners).toHaveLength(4);
      expect(corners.reduce((sum, p) => sum + p.u, 0) / 4).toBeCloseTo(-3);
      expect(corners.reduce((sum, p) => sum + p.v, 0) / 4).toBeCloseTo(2);
      expect(Math.hypot(corners[1].u - corners[0].u, corners[1].v - corners[0].v)).toBeCloseTo(10);
      expect(Math.hypot(corners[2].u - corners[1].u, corners[2].v - corners[1].v)).toBeCloseTo(5);
      if (rotation === 90) {
        expect(corners[0].u).toBeCloseTo(-0.5);
        expect(corners[0].v).toBeCloseTo(7);
      }
      if (rotation === 45) {
        expect(Math.max(...corners.map((p) => p.u))).toBeCloseTo(-3 + 7.5 / Math.SQRT2);
        expect(Math.min(...corners.map((p) => p.v))).toBeCloseTo(2 - 7.5 / Math.SQRT2);
      }
    },
  );
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
