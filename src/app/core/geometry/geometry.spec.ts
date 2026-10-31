import {
  combineProjections,
  fitViewport,
  constrainProjection,
  movePointInView,
  projectPoint,
  screenToWorld,
  snapToGrid,
  worldToScreen,
} from './geometry';
import { Projection, ViewType } from '../models/blueprint';

describe('orthographic geometry', () => {
  it('fits millimetre-scale vehicle geometry without changing proportions', () => {
    const points = [
      { u: -1500, v: -2500 },
      { u: 1500, v: 2500 },
    ];
    const transform = fitViewport(points, 600, 400);
    for (const p of points) {
      const screen = worldToScreen(p, transform);
      expect(screen.u).toBeGreaterThanOrEqual(0);
      expect(screen.u).toBeLessThanOrEqual(600);
      expect(screen.v).toBeGreaterThanOrEqual(0);
      expect(screen.v).toBeLessThanOrEqual(400);
    }
    expect(transform.scale).toBeLessThan(1);
  });
  const point = { id: 'p1', x: -2, y: 5, z: -3 };
  const projections: Projection[] = [
    { view: 'front', position: { u: -2, v: -3 } },
    { view: 'side', position: { u: 5, v: -3 } },
    { view: 'top', position: { u: -2, v: 5 } },
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (i !== j) {
        it(`combines ${projections[i].view} then ${projections[j].view}, including negative coordinates`, () => {
          expect(combineProjections(projections[i], projections[j], 'p1')).toEqual(point);
        });
        it(`constrains ${projections[j].view} to ${projections[i].view}`, () => {
          const constrained = constrainProjection(projections[i], projections[j].view, {
            u: 19,
            v: 21,
          });
          expect(() => combineProjections(projections[i], constrained)).not.toThrow();
        });
      }
  for (const view of ['front', 'side', 'top'] as ViewType[]) {
    it(`projects and moves in ${view}, preserving the hidden axis`, () => {
      const moved = movePointInView(point, view, { u: 10, v: 20 });
      expect(projectPoint(moved, view)).toEqual({ u: 10, v: 20 });
      const hidden = view === 'front' ? 'y' : view === 'side' ? 'x' : 'z';
      expect(moved[hidden]).toBe(point[hidden]);
    });
  }
  it('rejects shared coordinate conflicts in all combinations and orders', () => {
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (i !== j) {
          expect(() =>
            combineProjections(projections[i], {
              view: projections[j].view,
              position: { u: 100, v: 100 },
            }),
          ).toThrow(/Conflicting/);
        }
  });
  it('rejects repeated views and non-finite values', () => {
    expect(() => combineProjections(projections[0], projections[0])).toThrow(/distinct/);
    expect(() =>
      combineProjections(projections[0], { view: 'side', position: { u: NaN, v: -3 } }),
    ).toThrow(/finite/);
  });
  it('round trips world positions through zoom, pan, negative positions and inverted vertical axes', () => {
    for (const scale of [0.1, 1, 32, 1000]) {
      const t = { scale, panX: -153, panY: 298 };
      const world = { u: -12.25, v: 83.5 };
      const roundtrip = screenToWorld(worldToScreen(world, t), t);
      expect(roundtrip.u).toBeCloseTo(world.u, 9);
      expect(roundtrip.v).toBeCloseTo(world.v, 9);
    }
  });
  it('preserves the cursor world position during zoom', () => {
    const cursor = { u: 135, v: 92 };
    const world = screenToWorld(cursor, { scale: 20, panX: 100, panY: 180 });
    const scale = 63;
    expect(
      worldToScreen(world, {
        scale,
        panX: cursor.u - world.u * scale,
        panY: cursor.v + world.v * scale,
      }),
    ).toEqual(cursor);
  });
  it('snaps decimal and negative coordinates accurately', () => {
    expect(snapToGrid({ u: 0.31, v: -0.38 }, 0.1)).toEqual({ u: 0.3, v: -0.4 });
    expect(() => snapToGrid({ u: 0, v: 0 }, 0)).toThrow();
  });
});
