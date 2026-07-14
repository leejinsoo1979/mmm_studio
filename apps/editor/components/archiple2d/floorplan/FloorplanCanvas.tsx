// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import styles from './FloorplanCanvas.module.css';

// Core
import { SceneManager } from '../core/engine/SceneManager';
import type { EditorConfig } from '../core/types/EditorState';
import { ToolType } from '../core/types/EditorState';
import { eventBus } from '../core/events/EventBus';
import { FloorEvents } from '../core/events/FloorEvents';
import { EditorEvents } from '../core/events/EditorEvents';
import { convertFloorplanToBabylon } from './blueprint/BlueprintToBabylonAdapter';

// Rendering
import { Canvas2DRenderer } from './renderer/canvas2d/Canvas2DRenderer';
import { GridLayer } from './renderer/layers/GridLayer';
import { RoomLayer } from './renderer/layers/RoomLayer';
import { WallLayer } from './renderer/layers/WallLayer';
import { PointLayer } from './renderer/layers/PointLayer';
import { GuideLayer } from './renderer/layers/GuideLayer';
import { SelectionLayer } from './renderer/layers/SelectionLayer';
import { DoorLayer } from './renderer/layers/DoorLayer';
import { WindowLayer } from './renderer/layers/WindowLayer';
import { BackgroundImageLayer } from './renderer/layers/BackgroundImageLayer';
import { CeilingLayer } from './renderer/layers/CeilingLayer';

// Tools
import { ToolManager } from './tools/ToolManager';
import { WallTool } from './tools/WallTool';
import { RectangleTool } from './tools/RectangleTool';
import { SelectTool } from './tools/SelectTool';
import { DoorTool } from './tools/DoorTool';
import { WindowTool } from './tools/WindowTool';
import { FloatingOptionBar } from './ui/FloatingOptionBar';

// Services
import { SnapService } from './services/SnapService';
import { RoomDetectionService } from './services/RoomDetectionService';
import { WallSplitService } from './services/WallSplitService';

// Controllers
import { MouseController } from './controllers/MouseController';
import { KeyboardController } from './controllers/KeyboardController';

interface FloorplanCanvasProps {
  activeTool: ToolType;
  onDataChange?: (data: { points: any[]; walls: any[]; rooms: any[] }) => void;
  backgroundImage?: HTMLImageElement | null;
  imageScale?: number;
  imageOpacity?: number;
  renderStyle?: 'wireframe' | 'hidden-line' | 'solid' | 'realistic';
  showGrid?: boolean;
  /** @deprecated Use inline dimension editing with double-click instead */
  onDimensionClick?: (data: string | { roomId: string; wallIndex: number; p1: any; p2: any; isCW: boolean }) => void;
  wallHeight?: number;
  wallThickness?: number;
  rulerVisible?: boolean;
  rulerStart?: { x: number; y: number } | null;
  rulerEnd?: { x: number; y: number } | null;
  onRulerDragStart?: (isStartPoint: boolean) => void;
  onRulerDrag?: (worldX: number, worldY: number) => void;
  onRulerDragEnd?: () => void;
  onRulerLabelClick?: (screenX: number, screenY: number, currentDistanceMm: number) => void;
  draggingRulerPoint?: 'start' | 'end' | null;
  scannedWalls?: { points: any[]; walls: any[] } | null;
  onRoomSelect?: (roomInfo: { id: string; name: string; area: number } | null) => void;
  selectedRoomId?: string | null;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  view2DType?: 'floor' | 'ceiling' | 'elevation';
  onCeilingSelect?: (ceilingInfo: { id: string; name: string; area: number; screenPosition: { x: number; y: number } } | null) => void;
}

const FloorplanCanvas = ({
  activeTool,
  onDataChange,
  backgroundImage,
  imageScale = 100,
  imageOpacity = 0.5,
  renderStyle = 'solid',
  showGrid = true,
  onDimensionClick: _onDimensionClick,
  wallHeight = 2400,
  wallThickness = 100,
  rulerVisible = false,
  rulerStart = null,
  rulerEnd = null,
  onRulerDragStart,
  onRulerDrag,
  onRulerDragEnd,
  onRulerLabelClick,
  draggingRulerPoint = null,
  scannedWalls = null,
  onRoomSelect,
  selectedRoomId = null,
  onCanvasReady,
  view2DType = 'floor',
  onCeilingSelect,
}: FloorplanCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [_mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [_stats, setStats] = useState({ points: 0, walls: 0, rooms: 0, fps: 0 });

  // Option Bar State
  const [optionBarState, setOptionBarState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    doorId: string | null;
  }>({ visible: false, x: 0, y: 0, doorId: null });

  // Inline dimension editing state
  const [editingDimension, setEditingDimension] = useState<{
    visible: boolean;
    screenX: number;
    screenY: number;
    currentValue: number;
    data: { roomId: string; wallIndex: number; p1: any; p2: any; isCW: boolean } | null;
    angle: number;
  } | null>(null);
  const dimensionInputRef = useRef<HTMLInputElement>(null);

  // Room name editing state
  const [editingRoomName, setEditingRoomName] = useState<{
    visible: boolean;
    roomId: string;
    screenX: number;
    screenY: number;
    currentName: string;
  } | null>(null);
  const roomNameInputRef = useRef<HTMLInputElement>(null);

  // Ruler label hitbox (in screen coordinates)
  const rulerLabelHitboxRef = useRef<{ x: number; y: number; width: number; height: number; distanceMm: number } | null>(null);

  // Pan state (middle mouse button only)
  const isPanningRef = useRef(false);
  const lastPanPosRef = useRef<{ x: number; y: number } | null>(null);

  // Refs for cleanup
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const rendererRef = useRef<Canvas2DRenderer | null>(null);
  const toolManagerRef = useRef<ToolManager | null>(null);
  const snapServiceRef = useRef<SnapService | null>(null);
  const roomDetectionServiceRef = useRef<RoomDetectionService | null>(null);
  const wallSplitServiceRef = useRef<WallSplitService | null>(null);
  const mouseControllerRef = useRef<MouseController | null>(null);
  const keyboardControllerRef = useRef<KeyboardController | null>(null);
  const isCleanedUpRef = useRef<boolean>(false); // Guard against double cleanup

  // Layers
  const backgroundLayerRef = useRef<BackgroundImageLayer | null>(null);
  const gridLayerRef = useRef<GridLayer | null>(null);
  const roomLayerRef = useRef<RoomLayer | null>(null);
  const ceilingLayerRef = useRef<CeilingLayer | null>(null);
  const wallLayerRef = useRef<WallLayer | null>(null);
  const pointLayerRef = useRef<PointLayer | null>(null);
  const guideLayerRef = useRef<GuideLayer | null>(null);
  const selectionLayerRef = useRef<SelectionLayer | null>(null);

  // Initialize all systems
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Notify parent that canvas is ready
    onCanvasReady?.(canvas);

    // 1. Initialize SceneManager
    // Units: mm (millimeters) - 모든 내부 좌표는 mm 단위
    // Scale: scalePxPerMm = 0.12 means 1mm = 0.12px (8333mm = 1000px)
    const config: EditorConfig = {
      gridSize: 100, // 100mm = 10cm grid display
      snapEnabled: true,
      snapThreshold: 15, // 15px snap threshold (screen space)
      wallThickness: 100, // 100mm = 10cm
      wallHeight: 2400, // 2400mm = 2.4m
      canvasWidth: container.clientWidth,
      canvasHeight: container.clientHeight,
    };

    const sceneManager = SceneManager.getInstance(config);
    sceneManagerRef.current = sceneManager;

    // Expose for debugging
    (window as unknown as { __sceneManager: typeof sceneManager }).__sceneManager = sceneManager;

    // 2. Resize canvas
    // Handle High DPI (Retina) displays
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = container.clientWidth;
    const logicalHeight = container.clientHeight;

    // 3. Initialize Renderer
    const renderer = new Canvas2DRenderer(canvas);
    rendererRef.current = renderer;

    // Resize renderer (handles physical size and DPI scaling)
    renderer.resize(logicalWidth, logicalHeight, dpr);

    // 4. Create Layers
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const backgroundLayer = new BackgroundImageLayer();
    backgroundLayerRef.current = backgroundLayer;

    const gridLayer = new GridLayer({
      gridSize: 100, // 100mm = 10cm minor grid
      majorGridSize: 1000, // 1000mm = 1m major grid (matches 3D 1m spacing visually)
      minorColor: '#555555', // Darker gray for minor lines
      majorColor: '#222222', // Almost black for major lines
      backgroundColor: '#ffffff', // Pure white background (high contrast)
    });
    // GridLayer needs physical dimensions because ctx.getTransform() returns physical pixel matrix
    gridLayer.setSize(logicalWidth * dpr, logicalHeight * dpr);
    gridLayerRef.current = gridLayer;

    const roomLayer = new RoomLayer({
      wallThickness: config.wallThickness,
    });
    roomLayerRef.current = roomLayer;

    const ceilingLayer = new CeilingLayer({
      wallThickness: config.wallThickness,
    });
    ceilingLayer.visible = false; // Initially hidden (floor view is default)
    ceilingLayerRef.current = ceilingLayer;

    const wallLayer = new WallLayer({
      wallThickness: config.wallThickness,
    });
    wallLayer.setCamera(renderer.getCamera());
    wallLayerRef.current = wallLayer;

    const pointLayer = new PointLayer();
    pointLayer.setCamera(renderer.getCamera());
    pointLayerRef.current = pointLayer;

    const guideLayer = new GuideLayer();
    guideLayer.setCamera(renderer.getCamera());
    guideLayer.setWallThickness(config.wallThickness);
    guideLayerRef.current = guideLayer;

    const selectionLayer = new SelectionLayer();
    selectionLayerRef.current = selectionLayer;

    const doorLayer = new DoorLayer();
    const windowLayer = new WindowLayer();

    // Add layers to renderer (z-index order: Background→Grid→Room/Ceiling→Wall→Door→Window→Point→Guide→Selection)
    renderer.addLayer(backgroundLayer);
    renderer.addLayer(gridLayer);
    renderer.addLayer(roomLayer);
    renderer.addLayer(ceilingLayer);
    renderer.addLayer(wallLayer);
    renderer.addLayer(doorLayer);
    renderer.addLayer(windowLayer);
    renderer.addLayer(pointLayer);
    renderer.addLayer(guideLayer);
    renderer.addLayer(selectionLayer);

    // 5. Initialize Services
    // Use fixed 150mm snap threshold for consistent point snapping
    // Independent of zoom level for better UX
    const snapService = new SnapService({
      gridSize: config.gridSize,
      pointSnapThreshold: 150, // 150mm = 15cm fixed snap range
    });
    snapServiceRef.current = snapService;

    const roomDetectionService = new RoomDetectionService();
    roomDetectionServiceRef.current = roomDetectionService;

    const wallSplitService = new WallSplitService();
    wallSplitServiceRef.current = wallSplitService;

    // 6. Initialize ToolManager
    const toolManager = new ToolManager();
    toolManagerRef.current = toolManager;

    // Register tools
    const selectTool = new SelectTool(sceneManager, snapService);
    toolManager.registerTool(ToolType.SELECT, selectTool);

    const wallTool = new WallTool(sceneManager, snapService);
    toolManager.registerTool(ToolType.WALL, wallTool);

    const rectangleTool = new RectangleTool(sceneManager, snapService);
    toolManager.registerTool(ToolType.RECTANGLE, rectangleTool);

    const doorTool = new DoorTool(sceneManager);
    toolManager.registerTool(ToolType.DOOR, doorTool);

    const windowTool = new WindowTool(sceneManager);
    toolManager.registerTool(ToolType.WINDOW, windowTool);

    // Set default tool to SELECT
    toolManager.setActiveTool(ToolType.SELECT);
    sceneManager.setTool(ToolType.SELECT);

    // 7. Initialize Controllers
    const mouseController = new MouseController(canvas, toolManager);
    const camera = renderer.getCamera();
    mouseController.setCamera(camera); // Set camera for coordinate transformation
    mouseControllerRef.current = mouseController;

    const keyboardController = new KeyboardController(toolManager, sceneManager);
    keyboardControllerRef.current = keyboardController;

    // 8. Setup Event Listeners
    const updateLayers = () => {
      const points = sceneManager.objectManager.getAllPoints();
      const walls = sceneManager.objectManager.getAllWalls();
      const rooms = sceneManager.objectManager.getAllRooms();
      const doors = sceneManager.objectManager.getAllDoors();
      const windows = sceneManager.objectManager.getAllWindows();


      // Update layer data
      wallLayer.setWalls(walls);
      wallLayer.setPoints(points);
      wallLayer.setRooms(rooms);
      wallLayer.setDoors(doors);

      pointLayer.setPoints(points);

      roomLayer.setRooms(rooms);
      roomLayer.setPoints(points);

      // Update ceiling layer with same room data
      if (ceilingLayerRef.current) {
        ceilingLayerRef.current.setRooms(rooms);
        ceilingLayerRef.current.setPoints(points);
      }

      doorLayer.setDoors(doors);
      doorLayer.setWalls(walls);
      doorLayer.setPoints(points);

      windowLayer.setWindows(windows);
      windowLayer.setWalls(walls);
      windowLayer.setPoints(points);

      // Mark renderer as dirty to trigger re-render
      renderer.markDirty();

      // Update stats
      setStats({
        points: points.length,
        walls: walls.length,
        rooms: rooms.length,
        fps: renderer.getFPS(),
      });

      // Notify parent component of data changes (for 3D sync)
      // Convert blueprint Floorplan to Babylon format
      if (onDataChange) {
        const floorplan = sceneManager.objectManager.getFloorplan();
        const doors = sceneManager.objectManager.getAllDoors();
        const windows = sceneManager.objectManager.getAllWindows();
        const detectedRooms = sceneManager.objectManager.getAllRooms(); // Get detected rooms from RoomDetectionService
        const babylonData = convertFloorplanToBabylon(floorplan, doors, windows, detectedRooms);
        onDataChange(babylonData);
      }
    };

    // Listen to floorplan events
    eventBus.on(FloorEvents.POINT_ADDED, () => {
      try {
        updateLayers();
      } catch (e) {
        console.error('[FloorplanCanvas] Error in updateLayers:', e);
      }
    });
    eventBus.on(FloorEvents.POINT_MOVED, () => {
      const points = sceneManager.objectManager.getAllPoints();
      const walls = sceneManager.objectManager.getAllWalls();

      // Re-detect rooms when points move (geometry changed)
      const rooms = roomDetectionService.detectRooms(walls, points);
      sceneManager.objectManager.setRooms(rooms);


      wallLayer.setWalls(walls);
      wallLayer.setPoints(points);
      wallLayer.setRooms(rooms);
      pointLayer.setPoints(points);
      roomLayer.setRooms(rooms);
      roomLayer.setPoints(points);

      // Update ceiling layer with same room data
      if (ceilingLayerRef.current) {
        ceilingLayerRef.current.setRooms(rooms);
        ceilingLayerRef.current.setPoints(points);
      }

      // Mark renderer as dirty to trigger re-render
      renderer.markDirty();

      // Notify parent for 3D sync
      if (onDataChange) {
        const floorplan = sceneManager.objectManager.getFloorplan();
        const doors = sceneManager.objectManager.getAllDoors();
        const windows = sceneManager.objectManager.getAllWindows();
        const detectedRooms = sceneManager.objectManager.getAllRooms();
        const babylonData = convertFloorplanToBabylon(floorplan, doors, windows, detectedRooms);
        onDataChange(babylonData);
      }
    });
    eventBus.on(FloorEvents.POINT_UPDATED, () => {
      try {
        updateLayers();
      } catch (e) {
        console.error('[FloorplanCanvas] Error in updateLayers:', e);
      }
    });
    eventBus.on(FloorEvents.DOOR_MODIFIED, () => {
      try {
        updateLayers();
      } catch (e) {
        console.error('[FloorplanCanvas] Error in updateLayers:', e);
      }
    });
    eventBus.on(FloorEvents.WALL_ADDED, () => {

      // Split walls at T-junctions and wall-wall intersections before updating layers
      const points = sceneManager.objectManager.getAllPoints();
      const walls = sceneManager.objectManager.getAllWalls();

      const splitResult = wallSplitService.splitWallsAtTJunctions(walls, points);

      if (splitResult.removedWallIds.length > 0 || splitResult.newPoints.length > 0) {

        // Add new intersection points
        for (const point of splitResult.newPoints) {
          sceneManager.objectManager.addPoint(point);
        }

        // Remove old walls
        for (const wallId of splitResult.removedWallIds) {
          sceneManager.objectManager.removeWall(wallId);
        }

        // Add new split walls
        const newWalls = splitResult.walls.filter(w => !walls.find(ow => ow.id === w.id));
        for (const wall of newWalls) {
          sceneManager.objectManager.addWall(wall);
        }

        // Update point connections
        const allPoints = sceneManager.objectManager.getAllPoints();
        for (const wall of splitResult.walls) {
          const startPoint = allPoints.find(p => p.id === wall.startPointId);
          const endPoint = allPoints.find(p => p.id === wall.endPointId);
          if (startPoint && !startPoint.connectedWalls?.includes(wall.id)) {
            if (!startPoint.connectedWalls) startPoint.connectedWalls = [];
            startPoint.connectedWalls.push(wall.id);
          }
          if (endPoint && !endPoint.connectedWalls?.includes(wall.id)) {
            if (!endPoint.connectedWalls) endPoint.connectedWalls = [];
            endPoint.connectedWalls.push(wall.id);
          }
        }

        // Clean up duplicate points and walls before room detection
        // Skip cleanup during wall dragging to prevent merging detached points
        if (!sceneManager.isWallDragging()) {
          const cleanup = sceneManager.objectManager.cleanupDuplicates();
          if (cleanup.points > 0 || cleanup.walls > 0) {
          }
        }

        // Re-detect rooms after wall split
        const updatedWalls = sceneManager.objectManager.getAllWalls();
        const updatedPoints = sceneManager.objectManager.getAllPoints();
        const newRooms = roomDetectionService.detectRooms(updatedWalls, updatedPoints);

        // Batch update rooms (prevents flickering)
        const oldRoomCount = sceneManager.objectManager.getAllRooms().length;
        sceneManager.objectManager.setRooms(newRooms);

      }

      updateLayers();
    });
    eventBus.on(FloorEvents.ROOM_DETECTED, updateLayers);

    // Camera reset event
    eventBus.on(EditorEvents.CAMERA_RESET, () => {
      const camera = renderer.getCamera();
      camera.reset();
    });

    // Point selection/hover events
    eventBus.on(FloorEvents.POINT_SELECTED, (data: any) => {
      pointLayer.setSelectedPoints([data.point.id]);
      wallLayer.setSelectedWall(null); // Clear wall selection when point selected
    });

    eventBus.on(FloorEvents.POINT_HOVERED, (data: any) => {
      pointLayer.setHoveredPoint(data.point.id);
    });

    eventBus.on(FloorEvents.POINT_SELECTION_CLEARED, () => {
      pointLayer.setSelectedPoints([]);
      wallLayer.setSelectedWall(null); // Also clear wall selection
    });

    // Wall selection events
    eventBus.on(FloorEvents.WALL_SELECTED, (data: any) => {
      wallLayer.setSelectedWall(data.wall.id);
      pointLayer.setSelectedPoints([]); // Clear point selection when wall selected
    });

    // Wall hover events
    eventBus.on(FloorEvents.WALL_HOVERED, (data: any) => {
      wallLayer.setHoveredWall(data.wall.id);
    });

    eventBus.on(FloorEvents.WALL_HOVER_CLEARED, () => {
      wallLayer.setHoveredWall(null);
    });

    eventBus.on(FloorEvents.POINT_HOVER_CLEARED, () => {
      pointLayer.setHoveredPoint(null);
    });

    // Wall preview
    eventBus.on(FloorEvents.WALL_PREVIEW_UPDATED, (data: any) => {
      wallLayer.setPreviewWall(data.start, data.end);
    });

    eventBus.on(FloorEvents.WALL_PREVIEW_CLEARED, () => {
      wallLayer.setPreviewWall(null, null);
    });

    // Multi-wall preview (for L/U shape wall dragging)
    eventBus.on(FloorEvents.MULTI_WALL_PREVIEW_UPDATED, (data: any) => {
      wallLayer.setMultiPreviewWalls(data.walls);
    });

    eventBus.on(FloorEvents.MULTI_WALL_PREVIEW_CLEARED, () => {
      wallLayer.setMultiPreviewWalls(null);
    });

    // Snap indicator
    eventBus.on(FloorEvents.SNAP_POINT_UPDATED, (data: any) => {
      pointLayer.setSnapPoint(data.point);
    });

    // Angle guide indicator
    eventBus.on(FloorEvents.ANGLE_GUIDE_UPDATED, (data: any) => {
      guideLayer.setAngleGuide(data.from, data.angle);
    });

    // Grid snap indicator
    eventBus.on(FloorEvents.GRID_SNAP_UPDATED, (data: any) => {
      guideLayer.setGridSnapPoint(data.point);
    });

    // Wall preview with guides
    eventBus.on(FloorEvents.WALL_PREVIEW_UPDATED, (data: any) => {
      // Show distance measurement
      guideLayer.setDistanceMeasurement(data.start, data.end);
    });

    eventBus.on(FloorEvents.WALL_PREVIEW_CLEARED, () => {
      guideLayer.setDistanceMeasurement(null, null);
      guideLayer.setAngleGuide(null, null);
      guideLayer.setGridSnapPoint(null);
      guideLayer.setAngleMeasurement(null, null);
    });

    // Distance measurement events
    eventBus.on(FloorEvents.DISTANCE_MEASUREMENT_UPDATED, (data: any) => {
      guideLayer.setDistanceMeasurement(data.from, data.to);
    });

    eventBus.on(FloorEvents.DISTANCE_MEASUREMENT_CLEARED, () => {
      guideLayer.setDistanceMeasurement(null, null);
    });

    // Angle measurement events
    eventBus.on(FloorEvents.ANGLE_MEASUREMENT_UPDATED, (data: any) => {
      guideLayer.setAngleMeasurement(data.point, data.angle);
    });

    eventBus.on(FloorEvents.ANGLE_MEASUREMENT_CLEARED, () => {
      guideLayer.setAngleMeasurement(null, null);
    });

    // Rectangle preview
    eventBus.on(FloorEvents.RECTANGLE_PREVIEW_UPDATED, (data: any) => {
      guideLayer.setRectanglePreview(data.corners);
    });

    eventBus.on(FloorEvents.RECTANGLE_PREVIEW_CLEARED, () => {
      guideLayer.setRectanglePreview(null);
    });

    // Vertical/Horizontal guide lines for rectangle alignment
    eventBus.on(FloorEvents.VERTICAL_GUIDE_UPDATED, (data: any) => {
      guideLayer.setVerticalGuide(data.x, data.fromY, data.toY);
    });

    eventBus.on(FloorEvents.VERTICAL_GUIDE_CLEARED, () => {
      guideLayer.clearVerticalGuide();
    });

    eventBus.on(FloorEvents.HORIZONTAL_GUIDE_UPDATED, (data: any) => {
      guideLayer.setHorizontalGuide(data.y, data.fromX, data.toX);
    });

    eventBus.on(FloorEvents.HORIZONTAL_GUIDE_CLEARED, () => {
      guideLayer.clearHorizontalGuide();
    });

    // Door preview events
    eventBus.on(FloorEvents.DOOR_PREVIEW_UPDATED, (data: any) => {
      doorLayer.setPreview(data);
    });

    eventBus.on(FloorEvents.DOOR_PREVIEW_CLEARED, () => {
      doorLayer.clearPreview();
    });

    // Door add/remove events
    eventBus.on(FloorEvents.DOOR_ADDED, () => {
      updateLayers();
    });

    eventBus.on(FloorEvents.DOOR_REMOVED, () => {
      updateLayers();
    });

    // Window preview events
    eventBus.on(FloorEvents.WINDOW_PREVIEW_UPDATED, (data: any) => {
      windowLayer.setPreview(data);
    });

    eventBus.on(FloorEvents.WINDOW_PREVIEW_CLEARED, () => {
      windowLayer.clearPreview();
    });

    // Window add/remove events
    eventBus.on(FloorEvents.WINDOW_ADDED, () => {
      updateLayers();
    });

    eventBus.on(FloorEvents.WINDOW_REMOVED, () => {
      updateLayers();
    });

    // Wall added event - just update layers, NO automatic room detection
    eventBus.on(FloorEvents.WALL_ADDED, () => {
      updateLayers();
    });

    // 9. Automatic Room Detection with Wall Splitting
    const detectRooms = () => {
      let walls = sceneManager.objectManager.getAllWalls();
      let points = sceneManager.objectManager.getAllPoints();


      // Step 1: Split walls at T-junctions and wall-wall intersections
      const splitResult = wallSplitService.splitWallsAtTJunctions(walls, points);

      // Apply wall splits to SceneManager if any walls were split
      if (splitResult.removedWallIds.length > 0 || splitResult.newPoints.length > 0) {

        // Add new intersection points
        splitResult.newPoints.forEach(point => {
          sceneManager.objectManager.addPoint(point);
        });

        // Remove old walls
        splitResult.removedWallIds.forEach(wallId => {
          sceneManager.objectManager.removeWall(wallId);
        });

        // Add new wall segments (only the new ones, not the unchanged ones)
        const existingWallIds = new Set(walls.map(w => w.id));
        splitResult.walls.forEach(wall => {
          if (!existingWallIds.has(wall.id)) {
            sceneManager.objectManager.addWall(wall);
          }
        });

        // Update walls and points arrays with split result
        walls = splitResult.walls;
        points = sceneManager.objectManager.getAllPoints(); // Get updated points including new intersection points
      }

      // Clean up any duplicate points and walls before room detection
      // Skip cleanup during wall dragging to prevent merging detached points
      if (!sceneManager.isWallDragging()) {
        const cleanup = sceneManager.objectManager.cleanupDuplicates();
        if (cleanup.points > 0 || cleanup.walls > 0) {
          // Refresh walls and points after cleanup
          walls = sceneManager.objectManager.getAllWalls();
          points = sceneManager.objectManager.getAllPoints();
        }
      }

      // Step 2: Detect rooms using split walls and all points (including intersection points)
      const rooms = roomDetectionService.detectRooms(walls, points);

      // Step 3: Update rooms in ObjectManager (batch update to prevent flickering)
      sceneManager.objectManager.setRooms(rooms);


      // Step 4: Update layers and sync to Babylon
      updateLayers();
    };

    // Listen to wall events for automatic detection
    // Room detection on wall changes
    eventBus.on(FloorEvents.WALL_ADDED, detectRooms);
    eventBus.on(FloorEvents.WALL_REMOVED, () => {
      detectRooms();
      updateLayers(); // Update 3D when walls are removed (e.g., during splitting)
    });
    eventBus.on(FloorEvents.WALL_MODIFIED, detectRooms);

    // Also detect on point moves (geometry changes)
    eventBus.on(FloorEvents.POINT_UPDATED, detectRooms);

    // Initial detection
    detectRooms();

    // 9. Ensure grid layer size is properly set before first render
    // Use requestAnimationFrame to ensure DOM is fully laid out
    requestAnimationFrame(() => {
      // Double-check canvas dimensions in case container wasn't fully sized initially
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        const dpr = window.devicePixelRatio || 1;
        renderer.resize(container.clientWidth, container.clientHeight, dpr);
        // GridLayer needs physical dimensions because ctx.getTransform() returns physical pixel matrix
        gridLayer.setSize(container.clientWidth * dpr, container.clientHeight * dpr);
        // WallLayer needs physical dimensions for offscreen canvas
        wallLayer.setSize(container.clientWidth * dpr, container.clientHeight * dpr);
      }

      // Force initial render to ensure camera transform is applied and grid is visible
      renderer.render();
    });

    // 10. Start rendering loop
    renderer.start();

    // 11. Handle window resize
    const handleResize = () => {
      if (!canvas || !container) return;

      const dpr = window.devicePixelRatio || 1;
      renderer.resize(container.clientWidth, container.clientHeight, dpr);
      // GridLayer needs physical dimensions
      gridLayer.setSize(container.clientWidth * dpr, container.clientHeight * dpr);
      // WallLayer needs physical dimensions
      wallLayer.setSize(container.clientWidth * dpr, container.clientHeight * dpr);
      sceneManager.resizeCanvas(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('resize', handleResize);

    // Initial update
    updateLayers();


    // Store toolManager in ref for tool switching
    toolManagerRef.current = toolManager;

    // 7. Event Listeners
    const handleSelectionChanged = () => {
      const selection = sceneManager.selectionManager.getSelection();

      // Check if a single door is selected
      if (selection.length === 1) {
        const id = selection[0];
        if (!id) {
          setOptionBarState(prev => ({ ...prev, visible: false, doorId: null }));
          return;
        }
        const door = sceneManager.objectManager.getDoor(id);

        if (door) {
          // Update door layer to show selection handles
          doorLayer.setSelectedDoor(door.id);

          // Calculate position
          // We need the wall to find the door's world position
          const wall = sceneManager.objectManager.getWall(door.wallId);
          if (wall) {
            const start = sceneManager.objectManager.getPoint(wall.startPointId);
            const end = sceneManager.objectManager.getPoint(wall.endPointId);

            if (start && end) {
              // Calculate world position of the door center
              const wx = start.x + (end.x - start.x) * door.position;
              const wy = start.y + (end.y - start.y) * door.position;

              // Convert to screen position
              const screenPos = renderer.getCamera().worldToScreen(wx, wy);

              setOptionBarState({
                visible: true,
                x: screenPos.x,
                y: screenPos.y,
                doorId: door.id
              });
              return;
            }
          }
        }
      }

      // Hide if not a single door
      doorLayer.setSelectedDoor(null);
      setOptionBarState(prev => ({ ...prev, visible: false, doorId: null }));
    };

    const handleViewportChanged = () => {
      // Update position if visible
      setOptionBarState(prev => {
        if (!prev.visible || !prev.doorId) return prev;

        const door = sceneManager.objectManager.getDoor(prev.doorId);
        if (!door) return { ...prev, visible: false };

        const wall = sceneManager.objectManager.getWall(door.wallId);
        if (!wall) return { ...prev, visible: false };

        const start = sceneManager.objectManager.getPoint(wall.startPointId);
        const end = sceneManager.objectManager.getPoint(wall.endPointId);

        if (start && end) {
          const wx = start.x + (end.x - start.x) * door.position;
          const wy = start.y + (end.y - start.y) * door.position;
          const screenPos = renderer.getCamera().worldToScreen(wx, wy);
          return { ...prev, x: screenPos.x, y: screenPos.y };
        }
        return prev;
      });
    };

    eventBus.on(EditorEvents.SELECTION_CHANGED, handleSelectionChanged);
    eventBus.on(EditorEvents.VIEWPORT_CHANGED, handleViewportChanged);
    // Also update on door modified (e.g. undo/redo or drag)
    eventBus.on(FloorEvents.DOOR_MODIFIED, handleViewportChanged);
    eventBus.on(FloorEvents.DOOR_ADDED, handleSelectionChanged); // In case tool selects it

    // Cleanup
    return () => {

      // Add cleanup guard to prevent double cleanup
      if (isCleanedUpRef.current) {
        return;
      }

      try {
        window.removeEventListener('resize', handleResize);

        // Stop renderer safely
        if (renderer) {
          try {
            renderer.stop();
            renderer.dispose();
          } catch (e) {
            console.warn('[FloorplanCanvas] Renderer cleanup warning:', e);
          }
        }

        // Remove event listeners safely
        try {
          eventBus.off(EditorEvents.SELECTION_CHANGED, handleSelectionChanged);
          eventBus.off(EditorEvents.VIEWPORT_CHANGED, handleViewportChanged);
          eventBus.off(FloorEvents.DOOR_MODIFIED, handleViewportChanged);
          eventBus.off(FloorEvents.DOOR_ADDED, handleSelectionChanged);
        } catch (e) {
          console.warn('[FloorplanCanvas] Event cleanup warning:', e);
        }

        // Dispose controllers safely
        try {
          if (mouseController) mouseController.dispose();
          if (keyboardController) keyboardController.dispose();
        } catch (e) {
          console.warn('[FloorplanCanvas] Controller cleanup warning:', e);
        }

        // Clear event listeners
        try {
          eventBus.off(FloorEvents.POINT_ADDED, updateLayers);
          eventBus.off(FloorEvents.WALL_ADDED, updateLayers);
          eventBus.off(FloorEvents.ROOM_DETECTED, updateLayers);
        } catch (e) {
          console.warn('[FloorplanCanvas] Event listener cleanup warning:', e);
        }

        isCleanedUpRef.current = true;
      } catch (error) {
        console.error('[FloorplanCanvas] Cleanup error:', error);
      }

      // DO NOT reset SceneManager singleton - it should persist across re-renders
      // Only clear on actual page navigation/unmount
      // SceneManager.resetInstance();
    };
  }, []);

  // Handle tool changes from parent
  useEffect(() => {
    const toolManager = toolManagerRef.current;
    const sceneManager = sceneManagerRef.current;

    if (toolManager && sceneManager) {
      toolManager.setActiveTool(activeTool);
      sceneManager.setTool(activeTool);
    }
  }, [activeTool]);

  // Update wall settings when they change
  useEffect(() => {
    const toolManager = toolManagerRef.current;
    if (toolManager) {
      const wallTool = toolManager.getTool(ToolType.WALL) as any;
      const rectangleTool = toolManager.getTool(ToolType.RECTANGLE) as any;

      if (wallTool && typeof wallTool.setWallThickness === 'function') {
        wallTool.setWallThickness(wallThickness);
        wallTool.setWallHeight(wallHeight);
      }

      if (rectangleTool && typeof rectangleTool.setWallThickness === 'function') {
        rectangleTool.setWallThickness(wallThickness);
        rectangleTool.setWallHeight(wallHeight);
      }
    }

    // Also update all existing walls in the 2D canvas
    const sceneManager = sceneManagerRef.current;
    const renderer = rendererRef.current;
    const wallLayer = wallLayerRef.current;

    if (sceneManager) {
      const walls = sceneManager.objectManager.getAllWalls();
      let updated = false;

      for (const wall of walls) {
        if (wall.thickness !== wallThickness || wall.height !== wallHeight) {
          sceneManager.objectManager.updateWall(wall.id, {
            thickness: wallThickness,
            height: wallHeight,
          });
          updated = true;
        }
      }

      // Update WallLayer's config for visual rendering
      if (wallLayer) {
        wallLayer.setWallThickness(wallThickness);
      }

      // Update GuideLayer's wallThickness for preview rendering
      const guideLayer = guideLayerRef.current;
      if (guideLayer) {
        guideLayer.setWallThickness(wallThickness);
      }

      // Trigger re-render
      if (renderer) {
        renderer.render();
      }
    }
  }, [wallHeight, wallThickness]);

  // Update render style for layers when it changes
  useEffect(() => {
    const wallLayer = wallLayerRef.current;
    const roomLayer = roomLayerRef.current;
    const ceilingLayer = ceilingLayerRef.current;
    if (wallLayer) {
      wallLayer.setRenderStyle(renderStyle);
    }
    if (roomLayer) {
      roomLayer.setRenderStyle(renderStyle);
    }
    if (ceilingLayer) {
      ceilingLayer.setRenderStyle(renderStyle);
    }
  }, [renderStyle]);

  // Update grid visibility when showGrid changes
  useEffect(() => {
    const gridLayer = gridLayerRef.current;
    if (gridLayer) {
      gridLayer.visible = showGrid;
      // Trigger re-render
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.render();
      }
    }
  }, [showGrid]);

  // Update selected room when selectedRoomId changes from parent
  useEffect(() => {
    const roomLayer = roomLayerRef.current;
    const ceilingLayer = ceilingLayerRef.current;
    if (roomLayer) {
      roomLayer.setSelectedRooms(selectedRoomId ? [selectedRoomId] : []);
    }
    if (ceilingLayer) {
      ceilingLayer.setSelectedRooms(selectedRoomId ? [selectedRoomId] : []);
    }
    // Trigger re-render
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.render();
    }
  }, [selectedRoomId]);

  // Update background image layer when props change
  useEffect(() => {
    const backgroundLayer = backgroundLayerRef.current;
    const gridLayer = gridLayerRef.current;

    if (backgroundLayer) {
      backgroundLayer.setImage(backgroundImage || null);
      backgroundLayer.setScale(imageScale);
      backgroundLayer.setImageOpacity(imageOpacity);

      // Hide grid background when image is present
      if (gridLayer) {
        if (backgroundImage) {
          gridLayer.updateConfig({ backgroundColor: 'transparent' });
        } else {
          gridLayer.updateConfig({ backgroundColor: '#ffffff' });
        }
      }

      // Force render
      const renderer = rendererRef.current;
      if (renderer && backgroundImage) {
        renderer.render();
      }
    }
  }, [backgroundImage, imageScale, imageOpacity]);

  // Update layer visibility based on view2DType (floor vs ceiling view)
  useEffect(() => {
    const roomLayer = roomLayerRef.current;
    const ceilingLayer = ceilingLayerRef.current;
    const renderer = rendererRef.current;

    if (roomLayer && ceilingLayer) {
      // Floor view: show roomLayer (floor), hide ceilingLayer
      // Ceiling view: hide roomLayer (floor), show ceilingLayer
      roomLayer.visible = view2DType === 'floor';
      ceilingLayer.visible = view2DType === 'ceiling';

      // Force re-render to apply visibility change
      if (renderer) {
        renderer.markDirty();
        renderer.render();
      }
    }
  }, [view2DType]);

  // Handle mouse wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      const camera = renderer.getCamera();
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Zoom delta: -1 for zoom in, +1 for zoom out
      const zoomDelta = event.deltaY > 0 ? -0.1 : 0.1;
      camera.zoomAt(mouseX, mouseY, zoomDelta);

    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Handle canvas panning (middle or right mouse button - don't interfere with left-click)
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const handleMouseDown = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;

      // Check for ruler label click (highest priority - before point dragging)
      if (event.button === 0 && rulerVisible && onRulerLabelClick) {
        const hitbox = rulerLabelHitboxRef.current;
        if (hitbox &&
          screenX >= hitbox.x &&
          screenX <= hitbox.x + hitbox.width &&
          screenY >= hitbox.y &&
          screenY <= hitbox.y + hitbox.height) {
          event.preventDefault();
          event.stopPropagation();
          onRulerLabelClick(screenX, screenY, hitbox.distanceMm);
          return;
        }
      }

      // Check for ruler point drag (left-click on ruler start or end point)
      if (event.button === 0 && rulerVisible && rulerStart && rulerEnd && onRulerDragStart) {
        const camera = renderer.getCamera();

        // Check start point first
        const startScreen = camera.worldToScreen(rulerStart.x, rulerStart.y);
        const startDistance = Math.sqrt(
          Math.pow(screenX - startScreen.x, 2) +
          Math.pow(screenY - startScreen.y, 2)
        );

        if (startDistance < 15) { // 15px hitbox radius
          event.preventDefault();
          event.stopPropagation();
          onRulerDragStart(true); // true = start point
          canvas.style.cursor = 'grabbing';
          return;
        }

        // Check end point
        const endScreen = camera.worldToScreen(rulerEnd.x, rulerEnd.y);
        const endDistance = Math.sqrt(
          Math.pow(screenX - endScreen.x, 2) +
          Math.pow(screenY - endScreen.y, 2)
        );

        if (endDistance < 15) { // 15px hitbox radius
          event.preventDefault();
          event.stopPropagation();
          onRulerDragStart(false); // false = end point
          canvas.style.cursor = 'grabbing';
          return;
        }
      }

      // Room label click handling moved to dblclick event

      // Dimension click handling moved to dblclick event

      // Pan with middle mouse (button 1) or right mouse (button 2)
      // DO NOT use left-click (button 0) to avoid interfering with MouseController
      if (event.button === 1 || event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
        isPanningRef.current = true;
        lastPanPosRef.current = { x: event.clientX, y: event.clientY };
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;

      // Handle ruler dragging
      if (draggingRulerPoint && onRulerDrag) {
        event.preventDefault();
        event.stopPropagation();
        const camera = renderer.getCamera();
        const worldPos = camera.screenToWorld(screenX, screenY);
        onRulerDrag(worldPos.x, worldPos.y);
        return;
      }

      // Handle panning
      if (isPanningRef.current && lastPanPosRef.current) {
        event.preventDefault();
        event.stopPropagation();

        const dx = event.clientX - lastPanPosRef.current.x;
        const dy = event.clientY - lastPanPosRef.current.y;

        const camera = renderer.getCamera();
        camera.pan(dx, dy);

        lastPanPosRef.current = { x: event.clientX, y: event.clientY };
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      // Handle ruler drag end
      if (event.button === 0 && draggingRulerPoint && onRulerDragEnd) {
        event.preventDefault();
        event.stopPropagation();
        onRulerDragEnd();
        canvas.style.cursor = 'default';
        return;
      }

      // Handle panning end
      if (event.button === 1 || event.button === 2) {
        isPanningRef.current = false;
        lastPanPosRef.current = null;
        canvas.style.cursor = 'default';
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      // Prevent context menu when right-click is used for panning
      event.preventDefault();
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;

      const camera = renderer.getCamera();
      const worldPos = camera.screenToWorld(screenX, screenY);

      const roomLayer = roomLayerRef.current;
      if (roomLayer) {
        // Check room label for double-click editing (higher priority)
        const labelHit = roomLayer.getLabelAtPoint(worldPos.x, worldPos.y);
        if (labelHit) {
          event.preventDefault();
          event.stopPropagation();

          // Open room name editor at the label position
          const screenPos = camera.worldToScreen(labelHit.x, labelHit.y);
          setEditingRoomName({
            visible: true,
            roomId: labelHit.roomId,
            screenX: screenPos.x + rect.left,
            screenY: screenPos.y + rect.top,
            currentName: labelHit.text
          });

          // Focus input on next render
          setTimeout(() => {
            if (roomNameInputRef.current) {
              roomNameInputRef.current.focus();
              roomNameInputRef.current.select();
            }
          }, 0);
          return;
        }

        // Check room dimensions (interior dimensions) for double-click editing
        const clickedRoomDimension = roomLayer.getDimensionAtPoint(worldPos.x, worldPos.y);
        if (clickedRoomDimension) {
          event.preventDefault();
          event.stopPropagation();

          // Calculate current wall length
          const dx = clickedRoomDimension.p2.x - clickedRoomDimension.p1.x;
          const dy = clickedRoomDimension.p2.y - clickedRoomDimension.p1.y;
          const currentLength = Math.round(Math.sqrt(dx * dx + dy * dy));

          // Calculate angle for input rotation
          let angle = Math.atan2(dy, dx);
          if (angle >= Math.PI / 2) angle -= Math.PI;
          else if (angle < -Math.PI / 2) angle += Math.PI;

          // Get midpoint in screen coordinates
          const midWorld = {
            x: (clickedRoomDimension.p1.x + clickedRoomDimension.p2.x) / 2,
            y: (clickedRoomDimension.p1.y + clickedRoomDimension.p2.y) / 2
          };
          const midScreen = camera.worldToScreen(midWorld.x, midWorld.y);

          setEditingDimension({
            visible: true,
            screenX: midScreen.x + rect.left,
            screenY: midScreen.y + rect.top,
            currentValue: currentLength,
            data: clickedRoomDimension,
            angle: angle * (180 / Math.PI)
          });

          // Focus input after render
          setTimeout(() => {
            dimensionInputRef.current?.focus();
            dimensionInputRef.current?.select();
          }, 10);

          return;
        }

        // Check if clicked inside a room (for selection)
        const roomHit = roomLayer.getRoomAtPoint(worldPos.x, worldPos.y);
        if (roomHit && onRoomSelect) {
          event.preventDefault();
          event.stopPropagation();

          // Select the room
          roomLayer.setSelectedRooms([roomHit.room.id]);
          onRoomSelect({
            id: roomHit.room.id,
            name: roomHit.room.name,
            area: roomHit.area
          });
          return;
        }
      }

      // Handle ceiling selection when in ceiling view mode
      const ceilingLayer = ceilingLayerRef.current;
      if (view2DType === 'ceiling' && ceilingLayer && onCeilingSelect) {
        const ceilingHit = ceilingLayer.getRoomAtPoint(worldPos.x, worldPos.y);
        if (ceilingHit) {
          event.preventDefault();
          event.stopPropagation();

          // Select the ceiling
          ceilingLayer.setSelectedRooms([ceilingHit.room.id]);
          onCeilingSelect({
            id: ceilingHit.room.id,
            name: ceilingHit.room.name,
            area: ceilingHit.area,
            screenPosition: { x: screenX + rect.left, y: screenY + rect.top }
          });
          return;
        }
      }

      // If clicked outside any room, deselect
      if (onRoomSelect) {
        const roomLayer = roomLayerRef.current;
        if (roomLayer) {
          roomLayer.setSelectedRooms([]);
        }
        onRoomSelect(null);
      }

      // Also deselect ceiling when clicking outside
      if (onCeilingSelect && view2DType === 'ceiling') {
        const ceilingLayer = ceilingLayerRef.current;
        if (ceilingLayer) {
          ceilingLayer.setSelectedRooms([]);
        }
        onCeilingSelect(null);
      }
    };

    // Single click to select/deselect room or ceiling
    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return; // Only left click

      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;

      const camera = renderer.getCamera();
      const worldPos = camera.screenToWorld(screenX, screenY);

      // Handle ceiling selection in ceiling view mode
      if (view2DType === 'ceiling' && onCeilingSelect) {
        const ceilingLayer = ceilingLayerRef.current;
        if (ceilingLayer) {
          const ceilingHit = ceilingLayer.getRoomAtPoint(worldPos.x, worldPos.y);
          if (ceilingHit) {
            // Select ceiling
            ceilingLayer.setSelectedRooms([ceilingHit.room.id]);
            onCeilingSelect({
              id: ceilingHit.room.id,
              name: ceilingHit.room.name,
              area: ceilingHit.area,
              screenPosition: { x: screenX + rect.left, y: screenY + rect.top }
            });
          } else {
            // Clicked on empty space - deselect ceiling
            ceilingLayer.setSelectedRooms([]);
            onCeilingSelect(null);
          }
        }
        return;
      }

      // Handle room selection in floor view mode
      const roomLayer = roomLayerRef.current;
      if (roomLayer && onRoomSelect) {
        // Check if clicked inside a room
        const roomHit = roomLayer.getRoomAtPoint(worldPos.x, worldPos.y);
        if (!roomHit) {
          // Clicked on empty space - deselect room
          roomLayer.setSelectedRooms([]);
          onRoomSelect(null);
        }
      }
    };

    // Use capture phase to intercept middle/right-click before MouseController
    canvas.addEventListener('mousedown', handleMouseDown, true);
    canvas.addEventListener('mousemove', handleMouseMove, true);
    canvas.addEventListener('mouseup', handleMouseUp, true);
    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('dblclick', handleDoubleClick, true);
    canvas.addEventListener('click', handleClick);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown, true);
      canvas.removeEventListener('mousemove', handleMouseMove, true);
      canvas.removeEventListener('mouseup', handleMouseUp, true);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('dblclick', handleDoubleClick, true);
      canvas.removeEventListener('click', handleClick);
    };
  }, [rulerVisible, rulerStart, rulerEnd, onRulerDragStart, onRulerDrag, onRulerDragEnd, onRulerLabelClick, draggingRulerPoint, onRoomSelect, view2DType, onCeilingSelect]);

  // Handle mouse move for coordinate display
  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    setMousePos({ x: Math.round(x), y: Math.round(y) });
  };

  // Draw ruler overlay continuously
  useEffect(() => {
    if (!rulerVisible || !rulerStart || !rulerEnd) return;

    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    let animationId: number;

    const drawRuler = () => {
      const ctx = canvas.getContext('2d');
      const camera = renderer.getCamera();
      if (!ctx || !camera) return;

      // Draw ruler in screen space (after renderer has drawn the scene)
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to screen space

      const startScreen = camera.worldToScreen(rulerStart.x, rulerStart.y);
      const endScreen = camera.worldToScreen(rulerEnd.x, rulerEnd.y);

      // Draw line
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      ctx.beginPath();
      ctx.moveTo(startScreen.x, startScreen.y);
      ctx.lineTo(endScreen.x, endScreen.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw start point (draggable, same style as end point)
      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.arc(startScreen.x, startScreen.y, 8, 0, Math.PI * 2);
      ctx.fill();

      // Draw outer ring on start point
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(startScreen.x, startScreen.y, 12, 0, Math.PI * 2);
      ctx.stroke();

      // Draw end point (draggable, same style as start point)
      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.arc(endScreen.x, endScreen.y, 8, 0, Math.PI * 2);
      ctx.fill();

      // Draw outer ring on end point
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(endScreen.x, endScreen.y, 12, 0, Math.PI * 2);
      ctx.stroke();

      // Draw distance label
      const dx = rulerEnd.x - rulerStart.x;
      const dy = rulerEnd.y - rulerStart.y;
      const distMm = Math.sqrt(dx * dx + dy * dy);
      const midX = (startScreen.x + endScreen.x) / 2;
      const midY = (startScreen.y + endScreen.y) / 2;

      const labelWidth = 120;
      const labelHeight = 30;
      const labelX = midX - labelWidth / 2;
      const labelY = midY - labelHeight / 2;

      // Store hitbox for click detection
      rulerLabelHitboxRef.current = {
        x: labelX,
        y: labelY,
        width: labelWidth,
        height: labelHeight,
        distanceMm: distMm,
      };

      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(labelX, labelY, labelWidth, labelHeight);

      // Draw border to indicate clickability
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${distMm.toFixed(0)}mm`, midX, midY);

      ctx.restore();

      // Continue drawing
      animationId = requestAnimationFrame(drawRuler);
    };

    // Start drawing loop
    animationId = requestAnimationFrame(drawRuler);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [rulerVisible, rulerStart, rulerEnd]);

  // Draw scanned walls overlay continuously
  useEffect(() => {
    if (!scannedWalls || !scannedWalls.walls.length) return;

    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    let animationId: number;

    const drawScannedWalls = () => {
      const ctx = canvas.getContext('2d');
      const camera = renderer.getCamera();
      if (!ctx || !camera) return;

      // Convert image pixel coordinates to world coordinates (mm)
      // Image coordinates: (0,0) at top-left, +X right, +Y down
      // World coordinates: (0,0) at center, +X right, +Y down
      const imageWidth = backgroundImage?.width || 1000;
      const imageHeight = backgroundImage?.height || 1000;

      const pixelToWorld = (pixelX: number, pixelY: number) => {
        // Convert pixel to mm
        const worldX = (pixelX * imageScale) - (imageWidth * imageScale / 2);
        const worldY = (pixelY * imageScale) - (imageHeight * imageScale / 2);
        return { x: worldX, y: worldY };
      };

      // Create point lookup map
      const pointMap = new Map();
      scannedWalls.points.forEach((p: any) => {
        pointMap.set(p.id, p);
      });

      // Draw walls in screen space
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to screen space

      scannedWalls.walls.forEach((wall: any) => {
        const startPoint = pointMap.get(wall.startPointId);
        const endPoint = pointMap.get(wall.endPointId);

        if (!startPoint || !endPoint) return;

        // Convert to world coordinates
        const startWorld = pixelToWorld(startPoint.x, startPoint.y);
        const endWorld = pixelToWorld(endPoint.x, endPoint.y);

        // Convert to screen coordinates
        const startScreen = camera.worldToScreen(startWorld.x, startWorld.y);
        const endScreen = camera.worldToScreen(endWorld.x, endWorld.y);

        // Draw wall line in green with dashed style
        ctx.strokeStyle = '#22c55e'; // Green color
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]); // Dashed pattern
        ctx.beginPath();
        ctx.moveTo(startScreen.x, startScreen.y);
        ctx.lineTo(endScreen.x, endScreen.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw endpoints as small circles
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(startScreen.x, startScreen.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(endScreen.x, endScreen.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      // Continue drawing
      animationId = requestAnimationFrame(drawScannedWalls);
    };

    // Start drawing loop
    animationId = requestAnimationFrame(drawScannedWalls);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [scannedWalls, imageScale, backgroundImage]);

  const handleFlipHorizontal = () => {
    if (!optionBarState.doorId || !sceneManagerRef.current) return;
    const door = sceneManagerRef.current.objectManager.getDoor(optionBarState.doorId);
    if (door) {
      const newSwing = door.swing === 'left' ? 'right' : 'left';
      sceneManagerRef.current.objectManager.updateDoor(door.id, { swing: newSwing });
    }
  };

  const handleFlipVertical = () => {
    if (!optionBarState.doorId || !sceneManagerRef.current) return;
    const door = sceneManagerRef.current.objectManager.getDoor(optionBarState.doorId);
    if (door) {
      const newSide = door.openSide === 'left' ? 'right' : 'left';
      sceneManagerRef.current.objectManager.updateDoor(door.id, { openSide: newSide });
    }
  };

  const handleDelete = () => {
    if (!optionBarState.doorId || !sceneManagerRef.current) return;
    sceneManagerRef.current.objectManager.removeDoor(optionBarState.doorId);
    sceneManagerRef.current.selectionManager.clearSelection();
    setOptionBarState(prev => ({ ...prev, visible: false, doorId: null }));
  };

  // Dimension editing handlers
  const handleDimensionInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      applyDimensionChange();
    } else if (e.key === 'Escape') {
      setEditingDimension(null);
    }
  };

  const handleDimensionInputBlur = () => {
    // Cancel editing on blur
    setEditingDimension(null);
  };

  const applyDimensionChange = () => {
    if (!editingDimension || !editingDimension.data || !sceneManagerRef.current) {
      setEditingDimension(null);
      return;
    }

    const inputValue = dimensionInputRef.current?.value;
    if (!inputValue) {
      setEditingDimension(null);
      return;
    }

    const newLengthMm = parseFloat(inputValue);
    if (isNaN(newLengthMm) || newLengthMm <= 0) {
      setEditingDimension(null);
      return;
    }

    const { p1, p2 } = editingDimension.data;
    const currentLength = editingDimension.currentValue;
    const delta = newLengthMm - currentLength;

    if (Math.abs(delta) < 1) {
      // No significant change
      setEditingDimension(null);
      return;
    }

    // Calculate direction from p1 to p2
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const dirX = dx / len;
    const dirY = dy / len;

    // Move p2 by delta in the direction
    const objectManager = sceneManagerRef.current.objectManager;
    const points = objectManager.getAllPoints();

    // Find the point that matches p2
    const targetPoint = points.find(p =>
      Math.abs(p.x - p2.x) < 1 && Math.abs(p.y - p2.y) < 1
    );

    if (targetPoint) {
      const newX = p2.x + dirX * delta;
      const newY = p2.y + dirY * delta;
      objectManager.updatePoint(targetPoint.id, { x: newX, y: newY });
    }

    setEditingDimension(null);
  };

  // Room name editing handlers
  const handleRoomNameInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      applyRoomNameChange();
    } else if (e.key === 'Escape') {
      setEditingRoomName(null);
    }
  };

  const handleRoomNameInputBlur = () => {
    // Apply change on blur instead of canceling
    applyRoomNameChange();
  };

  const applyRoomNameChange = () => {
    if (!editingRoomName || !sceneManagerRef.current) {
      setEditingRoomName(null);
      return;
    }

    const newName = roomNameInputRef.current?.value?.trim();
    if (!newName) {
      setEditingRoomName(null);
      return;
    }

    const room = sceneManagerRef.current.objectManager.getRoom(editingRoomName.roomId);
    if (room && newName !== room.name) {
      sceneManagerRef.current.objectManager.updateRoom(editingRoomName.roomId, { name: newName });
    }

    setEditingRoomName(null);
  };

  return (
    <div ref={containerRef} className={styles.canvasContainer}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onMouseMove={handleMouseMove}
        style={{ cursor: draggingRulerPoint ? 'grabbing' : 'default' }}
      />

      <FloatingOptionBar
        x={optionBarState.x}
        y={optionBarState.y}
        visible={optionBarState.visible}
        onFlipHorizontal={handleFlipHorizontal}
        onFlipVertical={handleFlipVertical}
        onDelete={handleDelete}
      />

      {/* Inline dimension editing input */}
      {editingDimension && editingDimension.visible && (
        <input
          ref={dimensionInputRef}
          type="text"
          defaultValue={editingDimension.currentValue.toString()}
          onKeyDown={handleDimensionInputKeyDown}
          onBlur={handleDimensionInputBlur}
          style={{
            position: 'fixed',
            left: editingDimension.screenX,
            top: editingDimension.screenY,
            transform: `translate(-50%, -50%) rotate(${editingDimension.angle}deg)`,
            width: '80px',
            height: '24px',
            padding: '2px 6px',
            fontSize: '14px',
            fontWeight: 'bold',
            textAlign: 'center',
            border: '2px solid #3b82f6',
            borderRadius: '4px',
            backgroundColor: 'white',
            color: '#1f2937',
            outline: 'none',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        />
      )}

      {/* Inline room name editing input */}
      {editingRoomName && editingRoomName.visible && (
        <input
          ref={roomNameInputRef}
          type="text"
          defaultValue={editingRoomName.currentName}
          onKeyDown={handleRoomNameInputKeyDown}
          onBlur={handleRoomNameInputBlur}
          style={{
            position: 'fixed',
            left: editingRoomName.screenX,
            top: editingRoomName.screenY,
            transform: 'translate(-50%, -50%)',
            width: '120px',
            height: '28px',
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: 'bold',
            textAlign: 'center',
            border: '2px solid #10b981',
            borderRadius: '4px',
            backgroundColor: 'white',
            color: '#1f2937',
            outline: 'none',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        />
      )}
    </div>
  );
};

export default FloorplanCanvas;
