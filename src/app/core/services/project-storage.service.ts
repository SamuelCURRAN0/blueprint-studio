import { Injectable } from '@angular/core';
import { BlueprintProject, VIEW_TYPES } from '../models/blueprint';
import { validReferenceImage } from '../geometry/reference-image';

const SAVED_KEY = 'blueprint-studio.project.v1';
const AUTOSAVE_KEY = 'blueprint-studio.autosave.v1';
/** Validate the complete graph before any imported data enters reactive application state. */
export function parseProject(json: string): BlueprintProject {
  if (json.length > 10_000_000) throw new Error('Project files must be smaller than 10 MB.');
  let project: BlueprintProject;
  try {
    project = JSON.parse(json) as BlueprintProject;
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const fail = (message: string): never => {
    throw new Error(message);
  };
  const name = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
  if (!project || project.version !== 1)
    fail('Unsupported project version. Expected Blueprint Studio version 1.');
  if (!name(project.name) || !['m', 'cm', 'mm'].includes(project.units))
    fail('Invalid project name or units.');
  if (
    !Array.isArray(project.points) ||
    !Array.isArray(project.edges) ||
    !Array.isArray(project.objects) ||
    !Array.isArray(project.layers)
  )
    fail('Project geometry, objects and layers are required.');
  if (project.collections !== undefined && !Array.isArray(project.collections))
    fail('Invalid collections.');
  if (
    project.points.length > 50_000 ||
    project.edges.length > 100_000 ||
    project.objects.length > 1000 ||
    project.layers.length > 1000 ||
    (project.collections?.length ?? 0) > 1000
  )
    fail('Project exceeds the supported geometry limit.');
  for (const collection of [
    project.points,
    project.edges,
    project.objects,
    project.layers,
    project.collections ?? [],
  ]) {
    const ids = new Set<string>();
    for (const item of collection) {
      if (!item || !name(item.id) || ids.has(item.id))
        fail('Every item must have a unique, non-empty ID.');
      ids.add(item.id);
    }
  }
  const pointIds = new Set(project.points.map((p) => p.id)),
    edgeIds = new Set(project.edges.map((e) => e.id)),
    layerIds = new Set(project.layers.map((l) => l.id));
  const pointsById = new Map(project.points.map((p) => [p.id, p]));
  const collectionIds = new Set((project.collections ?? []).map((c) => c.id));
  for (const collection of project.collections ?? [])
    if (
      !name(collection.name) ||
      (collection.visible !== undefined && typeof collection.visible !== 'boolean')
    )
      fail('Invalid collection name or visibility.');
  for (const point of project.points)
    if (
      ![point.x, point.y, point.z].every(
        (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9,
      )
    )
      fail('Point coordinates must be finite numbers within ±1 billion.');
  if (!project.layers.length) fail('A project must contain at least one layer.');
  for (const layer of project.layers)
    if (
      !name(layer.name) ||
      typeof layer.visible !== 'boolean' ||
      typeof layer.locked !== 'boolean'
    )
      fail('Invalid layer.');
  for (const layer of project.layers) {
    const plane = layer.plane;
    if (
      plane !== undefined &&
      (!plane ||
        typeof plane !== 'object' ||
        Array.isArray(plane) ||
        !['x', 'y', 'z'].includes(plane.axis) ||
        typeof plane.value !== 'number' ||
        !Number.isFinite(plane.value) ||
        Math.abs(plane.value) > 1e9)
    )
      fail('Invalid fixed layer coordinate.');
  }
  const ownedPoints = new Set<string>(),
    ownedEdges = new Set<string>();
  for (const object of project.objects) {
    if (
      !name(object.name) ||
      typeof object.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(object.color) ||
      typeof object.visible !== 'boolean' ||
      typeof object.locked !== 'boolean' ||
      !layerIds.has(object.layerId) ||
      !Array.isArray(object.pointIds) ||
      !Array.isArray(object.edgeIds)
    )
      fail('Invalid object properties.');
    if (object.collectionId !== undefined && !collectionIds.has(object.collectionId))
      fail('An object references an invalid collection.');
    const plane = project.layers.find((l) => l.id === object.layerId)?.plane;
    for (const id of object.pointIds) {
      if (!pointIds.has(id) || ownedPoints.has(id))
        fail('Points must belong to exactly one object.');
      ownedPoints.add(id);
      if (plane && pointsById.get(id)![plane.axis] !== plane.value)
        fail('Points must match their layer’s fixed coordinate.');
    }
    for (const id of object.edgeIds) {
      if (!edgeIds.has(id) || ownedEdges.has(id)) fail('Edges must belong to exactly one object.');
      ownedEdges.add(id);
    }
  }
  if (ownedPoints.size !== pointIds.size || ownedEdges.size !== edgeIds.size)
    fail('Geometry is missing its owning object.');
  for (const edge of project.edges) {
    const owner = project.objects.find((o) => o.edgeIds.includes(edge.id));
    if (
      !pointIds.has(edge.startPointId) ||
      !pointIds.has(edge.endPointId) ||
      edge.startPointId === edge.endPointId ||
      !owner?.pointIds.includes(edge.startPointId) ||
      !owner.pointIds.includes(edge.endPointId)
    )
      fail('An edge references an invalid endpoint or object.');
  }
  const references: NonNullable<BlueprintProject['referenceImages']> = {};
  if (project.referenceImages !== undefined) {
    if (
      !project.referenceImages ||
      typeof project.referenceImages !== 'object' ||
      Array.isArray(project.referenceImages) ||
      Object.keys(project.referenceImages).some((key) => !(VIEW_TYPES as string[]).includes(key))
    )
      fail('Invalid reference image views.');
    for (const view of VIEW_TYPES) {
      const image = project.referenceImages[view];
      if (image === undefined) continue;
      if (!validReferenceImage(image)) fail('Invalid reference image.');
      const {
        name,
        dataUrl,
        pixelWidth,
        pixelHeight,
        centerU,
        centerV,
        width,
        rotation,
        opacity,
        visible,
      } = image;
      references[view] = {
        name,
        dataUrl,
        pixelWidth,
        pixelHeight,
        centerU,
        centerV,
        width,
        ...(rotation !== undefined ? { rotation } : {}),
        opacity,
        visible,
      };
    }
  }
  // Whitelist serialized fields: imported UI or prototype properties never enter the editor.
  return {
    version: 1,
    name: project.name,
    units: project.units,
    points: project.points.map(({ id, x, y, z }) => ({ id, x, y, z })),
    edges: project.edges.map(({ id, startPointId, endPointId }) => ({
      id,
      startPointId,
      endPointId,
    })),
    objects: project.objects.map(
      ({ id, name, color, visible, locked, pointIds, edgeIds, layerId, collectionId }) => ({
        id,
        name,
        color,
        visible,
        locked,
        pointIds: [...pointIds],
        edgeIds: [...edgeIds],
        layerId,
        ...(collectionId !== undefined ? { collectionId } : {}),
      }),
    ),
    layers: project.layers.map(({ id, name, visible, locked, plane }) => ({
      id,
      name,
      visible,
      locked,
      ...(plane ? { plane: { axis: plane.axis, value: plane.value } } : {}),
    })),
    ...(project.collections !== undefined
      ? {
          collections: project.collections.map(({ id, name, visible }) => ({
            id,
            name,
            ...(visible !== undefined ? { visible } : {}),
          })),
        }
      : {}),
    ...(project.referenceImages !== undefined ? { referenceImages: references } : {}),
  };
}
@Injectable({ providedIn: 'root' })
export class ProjectStorageService {
  save(project: BlueprintProject, autosave = false): void {
    localStorage.setItem(autosave ? AUTOSAVE_KEY : SAVED_KEY, JSON.stringify(project));
  }
  load(autosave = false): BlueprintProject | null {
    const json = localStorage.getItem(autosave ? AUTOSAVE_KEY : SAVED_KEY);
    return json ? parseProject(json) : null;
  }
}
