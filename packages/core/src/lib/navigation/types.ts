/** Level-local plan point `[x, z]` in metres. */
export type NavPoint = [number, number]

/** Walkable floor: cells whose centre lies inside `polygon` and outside every hole. */
export type NavArea = {
  polygon: NavPoint[]
  holes: NavPoint[][]
  /** Level-local floor height (slab elevation). */
  height: number
  /** Site ground: fills only the cells no other area covers. */
  ground?: boolean
}

/** A door span on a wall: its centre measured along the wall from `a`, and half its width. */
export type NavOpening = { along: number; halfWidth: number }

/** A straight wall or fence piece, blocked `halfWidth` either side of `a → b`. */
export type NavWall = {
  a: NavPoint
  b: NavPoint
  halfWidth: number
  openings: NavOpening[]
}

/** A solid box (furniture, stair, elevator shaft). `yaw` is the node's `rotation[1]`. */
export type NavObstacle = {
  center: NavPoint
  halfExtents: NavPoint
  yaw: number
}

export type NavGridInput = {
  areas: NavArea[]
  walls: NavWall[]
  obstacles: NavObstacle[]
}

/** Cells are indexed `row * cols + col`, with columns along +X and rows along +Z. */
export type NavGrid = {
  /** Hash of the input the grid was built from. */
  version: string
  cellSize: number
  /** Plan position of the grid's min corner. */
  originX: number
  originZ: number
  cols: number
  rows: number
  /** 1 where an agent can stand, with its radius already kept clear of obstacles. */
  walkable: Uint8Array
  /** Level-local floor height per cell. */
  height: Float32Array
  /** 4-connected walkable region per cell, -1 where not walkable. */
  region: Int32Array
  regionCount: number
}
