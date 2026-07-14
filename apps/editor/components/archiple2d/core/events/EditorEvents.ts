// @ts-nocheck
/**
 * EditorEvents - Event type definitions for editor actions
 */

export const EditorEvents = {
  // Tool events
  TOOL_CHANGED: 'editor:tool:changed',
  TOOL_ACTIVATED: 'editor:tool:activated',
  TOOL_DEACTIVATED: 'editor:tool:deactivated',

  // Selection events
  OBJECT_SELECTED: 'editor:object:selected',
  OBJECT_DESELECTED: 'editor:object:deselected',
  SELECTION_CHANGED: 'editor:selection:changed',

  // State events
  STATE_CHANGED: 'editor:state:changed',
  UNDO: 'editor:undo',
  REDO: 'editor:redo',

  // Canvas events
  CANVAS_RESIZED: 'editor:canvas:resized',
  VIEWPORT_CHANGED: 'editor:viewport:changed',

  // Camera events
  CAMERA_RESET: 'editor:camera:reset',
  CAMERA_FOV_CHANGED: 'editor:camera:fov:changed',
  CAMERA_PROJECTION_CHANGED: 'editor:camera:projection:changed',
  CAMERA_HEIGHT_CHANGED: 'editor:camera:height:changed',

  // Grid & snap events
  GRID_TOGGLED: 'editor:grid:toggled',
  SNAP_TOGGLED: 'editor:snap:toggled',
} as const;

export type EditorEventType = typeof EditorEvents[keyof typeof EditorEvents];
