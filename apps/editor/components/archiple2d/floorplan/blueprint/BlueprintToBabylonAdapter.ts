// @ts-nocheck
import type { Floorplan } from './floorplan';
import type { Corner } from './corner';

/**
 * Adapter to convert blueprint Floorplan data to Babylon3DCanvas format
 * 2D coordinates are already in mm (new system)
 * No conversion needed - pass through directly
 * Babylon3DCanvas will convert mm to meters with * 0.001
 */

export interface BabylonPoint {
  id: string;
  x: number; // mm (already in mm)
  y: number; // mm (already in mm)
}

export interface BabylonWall {
  id: string;
  startPointId: string; // point id
  endPointId: string; // point id
  thickness: number; // mm
  height: number; // mm
}

export interface BabylonRoom {
  id: string;
  name: string;
  points: string[]; // point ids (CCW order)
  area: number; // m² (square meters)
}

export interface BabylonDoor {
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number; // mm
  height: number; // mm
  swing: 'left' | 'right' | 'double';
}

export interface BabylonWindow {
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number; // mm
  height: number; // mm
  sillHeight: number; // mm from floor
  type: 'sliding' | 'casement' | 'fixed';
}

export interface BabylonFloorplanData {
  points: BabylonPoint[];
  walls: BabylonWall[];
  rooms: BabylonRoom[];
  doors: BabylonDoor[];
  windows: BabylonWindow[];
  floorplan: Floorplan; // Blueprint floorplan object for HalfEdge geometry
}

/**
 * Convert blueprint Floorplan to Babylon3DCanvas data format
 * All coordinates are already in mm - pass through directly
 */
export function convertFloorplanToBabylon(floorplan: Floorplan, doors: any[] = [], windows: any[] = [], detectedRooms?: any[]): BabylonFloorplanData {
  const corners = floorplan.getCorners();
  const walls = floorplan.getWalls();
  // Use detected rooms if provided (from RoomDetectionService), otherwise fallback to blueprint rooms
  const blueprintRooms = floorplan.getRooms();
  const rooms = detectedRooms && detectedRooms.length > 0 ? detectedRooms : blueprintRooms;

  console.log('[BlueprintToBabylonAdapter] detectedRooms:', detectedRooms?.length || 0, 'blueprintRooms:', blueprintRooms.length, 'using:', rooms.length, 'rooms');

  // Pass through corners (already in mm)
  const points: BabylonPoint[] = corners.map(corner => ({
    id: corner.id,
    x: corner.x, // Already in mm
    y: corner.y, // Already in mm
  }));

  // Pass through walls (already in mm)
  const babylonWalls: BabylonWall[] = walls.map(wall => ({
    id: wall.id,
    startPointId: wall.getStart().id,
    endPointId: wall.getEnd().id,
    thickness: wall.thickness, // Already in mm (100mm = 10cm)
    height: wall.height, // Already in mm (2400mm = 2.4m)
  }));

  // Convert rooms (handle both Blueprint rooms and detected rooms)
  const babylonRooms: BabylonRoom[] = rooms.map((room: any, index) => {
    // Detected rooms from RoomDetectionService have 'points' and 'area' directly
    // Blueprint rooms have 'corners' that need to be converted
    const roomPoints = room.points || room.corners.map((c: any) => c.id);
    const area = room.area || calculateRoomArea(room.corners);
    const roomId = room.id || `room-${index}`;
    const roomName = room.name || `Room ${index + 1}`;

    return {
      id: roomId,
      name: roomName,
      points: roomPoints,
      area,
    };
  });

  // Pass through doors (already in correct format)
  const babylonDoors: BabylonDoor[] = doors.map(door => ({
    id: door.id,
    wallId: door.wallId,
    position: door.position,
    width: door.width,
    height: door.height,
    swing: door.swing,
  }));

  // Pass through windows (already in correct format)
  const babylonWindows: BabylonWindow[] = windows.map(window => ({
    id: window.id,
    wallId: window.wallId,
    position: window.position,
    width: window.width,
    height: window.height,
    sillHeight: window.sillHeight,
    type: window.type,
  }));

  console.log('[BlueprintToBabylonAdapter] Converting to Babylon:', {
    points: points.length,
    walls: babylonWalls.length,
    rooms: babylonRooms.length,
    doors: babylonDoors.length,
    windows: babylonWindows.length,
    doorData: babylonDoors,
    windowData: babylonWindows
  });

  return {
    points,
    walls: babylonWalls,
    rooms: babylonRooms,
    doors: babylonDoors,
    windows: babylonWindows,
    floorplan, // Pass blueprint floorplan for HalfEdge geometry
  };
}

/**
 * Calculate room area using Shoelace formula
 * @param corners Room corners in CCW order (coordinates in mm)
 * @returns Area in m² (square meters)
 */
function calculateRoomArea(corners: Corner[]): number {
  if (corners.length < 3) return 0;

  let sum = 0;
  for (let i = 0; i < corners.length; i++) {
    const current = corners[i];
    const next = corners[(i + 1) % corners.length];
    if (!(current && next)) continue;
    sum += current.x * next.y - next.x * current.y;
  }

  // Convert from mm² to m²
  const MM_PER_METER = 1000;
  return Math.abs(sum / 2) / (MM_PER_METER * MM_PER_METER);
}

/**
 * Create a simple test floorplan for verification
 * Creates a 2800mm x 2800mm room with 100mm thick walls and 2400mm height
 */
export function createTestRoom(): BabylonFloorplanData {
  return {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 2800, y: 0 },
      { id: 'p3', x: 2800, y: 2800 },
      { id: 'p4', x: 0, y: 2800 },
    ],
    walls: [
      { id: 'w1', startPointId: 'p1', endPointId: 'p2', thickness: 100, height: 2400 },
      { id: 'w2', startPointId: 'p2', endPointId: 'p3', thickness: 100, height: 2400 },
      { id: 'w3', startPointId: 'p3', endPointId: 'p4', thickness: 100, height: 2400 },
      { id: 'w4', startPointId: 'p4', endPointId: 'p1', thickness: 100, height: 2400 },
    ],
    rooms: [
      {
        id: 'room-1',
        name: 'Test Room',
        points: ['p1', 'p2', 'p3', 'p4'],
        area: 7.84, // m² (2.8m x 2.8m)
      },
    ],
    doors: [],
    windows: [],
    floorplan: null as any, // Test room doesn't have a real floorplan object
  };
}
