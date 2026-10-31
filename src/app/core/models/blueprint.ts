export type Axis = 'x' | 'y' | 'z';
export type ViewType = 'front' | 'side' | 'top';
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
}
export interface BlueprintLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
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
  | 'delete-point'
  | 'edge'
  | 'delete-edge'
  | 'rectangle'
  | 'polyline'
  | 'measure';
export const VIEW_AXES: Record<ViewType, readonly [Axis, Axis]> = {
  front: ['x', 'z'],
  side: ['y', 'z'],
  top: ['x', 'y'],
};
export const AXIS_COLORS: Record<Axis, string> = { x: '#e67e83', y: '#a4c88a', z: '#82a9ed' };
