import {
  BlueprintEdge,
  BlueprintObject,
  BlueprintPoint,
  BlueprintProject,
} from '../models/blueprint';

/** A small dimensionally consistent study, in metres, built from the same graph as user geometry. */
export function demoProject(): BlueprintProject {
  const project: BlueprintProject = {
    version: 1,
    name: 'Kart chassis · study',
    units: 'm',
    points: [],
    edges: [],
    objects: [],
    layers: [
      { id: 'structure', name: 'Structure', visible: true, locked: false },
      { id: 'details', name: 'Running gear', visible: true, locked: false },
    ],
  };
  function object(id: string, name: string, color: string, layerId = 'structure'): BlueprintObject {
    const o = {
      id,
      name,
      color,
      visible: true,
      locked: false,
      pointIds: [] as string[],
      edgeIds: [] as string[],
      layerId,
    };
    project.objects.push(o);
    return o;
  }
  function shape(o: BlueprintObject, coordinates: number[][], closed = true): BlueprintPoint[] {
    const points = coordinates.map(([x, y, z]) => ({
      id: `p${project.points.length + o.pointIds.length}-${o.id}`,
      x,
      y,
      z,
    }));
    // IDs are stable and unique across every shape in an object.
    points.forEach((p, i) => {
      p.id = `${o.id}-p${o.pointIds.length + i}`;
    });
    project.points.push(...points);
    o.pointIds.push(...points.map((p) => p.id));
    for (let i = 0; i < points.length - (closed ? 0 : 1); i++)
      edge(o, points[i], points[(i + 1) % points.length]);
    return points;
  }
  function edge(o: BlueprintObject, a: BlueprintPoint, b: BlueprintPoint): void {
    const e: BlueprintEdge = {
      id: `${o.id}-e${o.edgeIds.length}`,
      startPointId: a.id,
      endPointId: b.id,
    };
    project.edges.push(e);
    o.edgeIds.push(e.id);
  }
  const chassis = object('chassis', 'Chassis frame', '#8cd5ba');
  const lower = shape(chassis, [
    [-0.44, -0.88, 0.16],
    [0.44, -0.88, 0.16],
    [0.5, 0.28, 0.16],
    [0.34, 0.9, 0.16],
    [-0.34, 0.9, 0.16],
    [-0.5, 0.28, 0.16],
  ]);
  const upper = shape(chassis, [
    [-0.34, -0.6, 0.37],
    [0.34, -0.6, 0.37],
    [0.34, 0.3, 0.28],
    [-0.34, 0.3, 0.28],
  ]);
  [0, 1, 2, 5].forEach((j, i) => edge(chassis, lower[j], upper[i]));
  edge(chassis, lower[2], lower[5]);
  const seat = object('seat', 'Seat & steering', '#9aaee2');
  const base = shape(seat, [
    [-0.23, -0.45, 0.2],
    [0.23, -0.45, 0.2],
    [0.23, 0.1, 0.2],
    [-0.23, 0.1, 0.2],
  ]);
  const back = shape(
    seat,
    [
      [-0.23, -0.45, 0.2],
      [-0.25, -0.6, 0.66],
      [0.25, -0.6, 0.66],
      [0.23, -0.45, 0.2],
    ],
    false,
  );
  edge(seat, base[0], back[1]);
  edge(seat, base[1], back[2]);
  shape(
    seat,
    [
      [0, 0.22, 0.2],
      [0, 0.44, 0.63],
    ],
    false,
  );
  shape(
    seat,
    Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return [0.15 * Math.cos(a), 0.44 + 0.08 * Math.sin(a), 0.63 + 0.08 * Math.sin(a)];
    }),
  );
  for (const [id, name, y, radius] of [
    ['rear', 'Rear wheels', -0.64, 0.16],
    ['front', 'Front wheels', 0.65, 0.14],
  ] as const) {
    const wheels = object(id, name, '#d4b37b', 'details');
    for (const side of [-1, 1]) {
      const rings = [side * 0.48, side * 0.66].map((x) =>
        shape(
          wheels,
          Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return [x, y + radius * Math.cos(a), radius + radius * Math.sin(a)];
          }),
        ),
      );
      for (let i = 0; i < 12; i += 3) edge(wheels, rings[0][i], rings[1][i]);
    }
    shape(
      wheels,
      [
        [-0.6, y, radius],
        [0.6, y, radius],
      ],
      false,
    );
  }
  return project;
}
