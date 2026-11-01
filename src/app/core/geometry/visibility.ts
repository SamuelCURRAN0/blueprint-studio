import { BlueprintProject } from '../models/blueprint';

/** Visibility is inherited without overwriting each object's own eye setting. */
export function visibleObjectIds(project: BlueprintProject): Set<string> {
  const layers = new Set(project.layers.filter((l) => l.visible).map((l) => l.id));
  const hiddenCollections = new Set(
    (project.collections ?? []).filter((c) => c.visible === false).map((c) => c.id),
  );
  return new Set(
    project.objects
      .filter(
        (o) => o.visible && layers.has(o.layerId) && !hiddenCollections.has(o.collectionId ?? ''),
      )
      .map((o) => o.id),
  );
}
