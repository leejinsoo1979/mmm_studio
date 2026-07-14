// @ts-nocheck
/**
 * FloorEvents - Event type definitions for floorplan operations
 */

export const FloorEvents = {
  // Point events
  POINT_ADDED: 'floor:point:added',
  POINT_MOVED: 'floor:point:moved',
  POINT_UPDATED: 'floor:point:updated',
  POINT_REMOVED: 'floor:point:removed',
  POINT_SNAPPED: 'floor:point:snapped',
  POINT_SELECTED: 'floor:point:selected',
  POINT_HOVERED: 'floor:point:hovered',
  POINT_SELECTION_CLEARED: 'floor:point:selection:cleared',
  POINT_HOVER_CLEARED: 'floor:point:hover:cleared',

  // Wall events
  WALL_ADDED: 'floor:wall:added',
  WALL_MODIFIED: 'floor:wall:modified',
  WALL_REMOVED: 'floor:wall:removed',
  WALL_SPLIT: 'floor:wall:split',
  WALL_SELECTED: 'floor:wall:selected',
  WALL_HOVERED: 'floor:wall:hovered',
  WALL_HOVER_CLEARED: 'floor:wall:hover:cleared',
  WALL_PREVIEW_UPDATED: 'floor:wall:preview:updated',
  WALL_PREVIEW_CLEARED: 'floor:wall:preview:cleared',
  MULTI_WALL_PREVIEW_UPDATED: 'floor:wall:multi:preview:updated',
  MULTI_WALL_PREVIEW_CLEARED: 'floor:wall:multi:preview:cleared',

  // Snap events
  SNAP_POINT_UPDATED: 'floor:snap:point:updated',
  ANGLE_GUIDE_UPDATED: 'floor:snap:angle:updated',
  GRID_SNAP_UPDATED: 'floor:snap:grid:updated',

  // Measurement events
  DISTANCE_MEASUREMENT_UPDATED: 'floor:measurement:distance:updated',
  DISTANCE_MEASUREMENT_CLEARED: 'floor:measurement:distance:cleared',
  ANGLE_MEASUREMENT_UPDATED: 'floor:measurement:angle:updated',
  ANGLE_MEASUREMENT_CLEARED: 'floor:measurement:angle:cleared',

  // Rectangle tool events
  RECTANGLE_PREVIEW_UPDATED: 'floor:rectangle:preview:updated',
  RECTANGLE_PREVIEW_CLEARED: 'floor:rectangle:preview:cleared',
  VERTICAL_GUIDE_UPDATED: 'floor:guide:vertical:updated',
  VERTICAL_GUIDE_CLEARED: 'floor:guide:vertical:cleared',
  HORIZONTAL_GUIDE_UPDATED: 'floor:guide:horizontal:updated',
  HORIZONTAL_GUIDE_CLEARED: 'floor:guide:horizontal:cleared',

  // Room events
  ROOM_DETECTED: 'floor:room:detected',
  ROOM_CREATED: 'floor:room:created',
  ROOM_MODIFIED: 'floor:room:modified',
  ROOM_REMOVED: 'floor:room:removed',
  POTENTIAL_ROOM_DETECTED: 'floor:room:potential',

  // Door events
  DOOR_ADDED: 'floor:door:added',
  DOOR_MODIFIED: 'floor:door:modified',
  DOOR_REMOVED: 'floor:door:removed',
  DOOR_PREVIEW_UPDATED: 'floor:door:preview:updated',
  DOOR_PREVIEW_CLEARED: 'floor:door:preview:cleared',

  // Window events
  WINDOW_ADDED: 'floor:window:added',
  WINDOW_MODIFIED: 'floor:window:modified',
  WINDOW_REMOVED: 'floor:window:removed',
  WINDOW_PREVIEW_UPDATED: 'floor:window:preview:updated',
  WINDOW_PREVIEW_CLEARED: 'floor:window:preview:cleared',

  // Intersection events
  INTERSECTION_DETECTED: 'floor:intersection:detected',
  INTERSECTION_RESOLVED: 'floor:intersection:resolved',

  // Data events
  FLOORPLAN_LOADED: 'floor:loaded',
  FLOORPLAN_CLEARED: 'floor:cleared',
  FLOORPLAN_EXPORTED: 'floor:exported',
} as const;

export type FloorEventType = typeof FloorEvents[keyof typeof FloorEvents];
