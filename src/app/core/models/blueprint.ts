export type Axis = 'x' | 'y' | 'z';
export type ViewType = 'front' | 'back' | 'side' | 'top' | 'bottom';
export const VIEW_TYPES: ViewType[] = ['front', 'back', 'side', 'top', 'bottom'];
export interface Position {
  u: number;
  v: number;
}
export interface BlueprintPoint {
  id: string;
  x: number;
  y: number;
  z: number;
}
export interface BlueprintEdge {
  id: string;
  startPointId: string;
  endPointId: string;
}
export interface BlueprintObject {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  pointIds: string[];
  edgeIds: string[];
  layerId: string;
  /** Optional organizational group; independent of construction layers. */
  collectionId?: string;
}
export interface BlueprintCollection {
  id: string;
  name: string;
  /** Omitted in older projects; collections are visible unless explicitly hidden. */
  visible?: boolean;
}
export interface BlueprintLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** All points owned by this layer share this coordinate. Omit for a free 3D layer. */
  plane?: { axis: Axis; value: number };
}
/** A view-local underlay, positioned in world units and embedded in project files. */
export interface ReferenceImage {
  name: string;
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  centerU: number;
  centerV: number;
  width: number;
  /** Clockwise degrees around the image center. Older projects default to zero. */
  rotation?: number;
  opacity: number;
  visible: boolean;
}
export interface BlueprintProject {
  version: 1;
  name: string;
  units: 'm' | 'cm' | 'mm';
  points: BlueprintPoint[];
  edges: BlueprintEdge[];
  objects: BlueprintObject[];
  layers: BlueprintLayer[];
  /** Older version-1 projects have no collections and keep objects ungrouped. */
  collections?: BlueprintCollection[];
  referenceImages?: Partial<Record<ViewType, ReferenceImage>>;
}
export interface Projection {
  view: ViewType;
  position: Position;
}
/** Scale is CSS pixels per world unit; pan is the screen position of the world origin. */
export interface ViewportTransform {
  scale: number;
  panX: number;
  panY: number;
}
export type Tool =
  | 'select'
  | 'add'
  | 'move'
  | 'move-reference'
  | 'delete-point'
  | 'edge'
  | 'delete-edge'
  | 'rectangle'
  | 'polyline'
  | 'measure';
export const VIEW_AXES: Record<ViewType, readonly [Axis, Axis]> = {
  front: ['x', 'z'],
  back: ['x', 'z'],
  side: ['y', 'z'],
  top: ['x', 'y'],
  bottom: ['x', 'y'],
};
/** Opposite views preserve the upward axis, so positive X points left. */
export const VIEW_HORIZONTAL_SIGN: Record<ViewType, 1 | -1> = {
  front: 1,
  back: -1,
  side: 1,
  top: 1,
  bottom: -1,
};
export const AXIS_COLORS: Record<Axis, string> = { x: '#e67e83', y: '#a4c88a', z: '#82a9ed' };
