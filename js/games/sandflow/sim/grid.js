/**
 * SimGridBasic — faithful port of Unity SimGrid.
 *
 * Implements: Empty / Bucket / Wall / Mechanic cell types with all mechanic
 * fields (ice, mystery, key/lock, pin control/wall, sticky, switch, chest),
 * stack construction (SimStackData), pin/sticky/switch pairing, HasPathToTop
 * availability, and BucketCapacities assignment (grid buckets then stack
 * buckets, x-outer / y-inner order).
 *
 * `pick(cell, isDFS=false)` + `RefreshAvailability` port the full mechanic
 * resolution path: stack advance, pin clearing, key→lock, switch swap/dissolve,
 * mystery solve, and chest spawning (SpawnChestBuckets). The headless sim picks
 * with isDFS=false, so the sticky co-pick (C# `if (isDFS)` branch) is preserved
 * but does NOT fire — picking one sticky bucket leaves its partner in place.
 */

// ---------------------------------------------------------------------------
// Cell type constants (mirrors C# CellType enum)
// ---------------------------------------------------------------------------
export const SimCellType = Object.freeze({
  Empty: 0,
  Bucket: 1,
  Wall: 2,
  Mechanic: 3,
})

// ---------------------------------------------------------------------------
// Direction enum (mirrors C# Catalog.Direction)
// ---------------------------------------------------------------------------
export const Direction = Object.freeze({
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
})

// DirectionToStep — C# DirectionToStep (Up→(-1,0), Down→(1,0), Right→(0,1), Left→(0,-1))
function directionToStep(direction) {
  switch (direction) {
    case Direction.Up:    return { x: -1, y: 0 }
    case Direction.Down:  return { x: 1, y: 0 }
    case Direction.Right: return { x: 0, y: 1 }
    case Direction.Left:  return { x: 0, y: -1 }
    default:              return { x: 0, y: 0 }
  }
}

// GetSpawnIndex — C# GetSpawnIndex (Up→x-1, Down→x+1, Right→y+1, Left→y-1)
function getSpawnIndex(stackIndex, direction) {
  switch (direction) {
    case Direction.Up:    return { x: stackIndex.x - 1, y: stackIndex.y }
    case Direction.Down:  return { x: stackIndex.x + 1, y: stackIndex.y }
    case Direction.Right: return { x: stackIndex.x, y: stackIndex.y + 1 }
    case Direction.Left:  return { x: stackIndex.x, y: stackIndex.y - 1 }
    default:              return { x: stackIndex.x, y: stackIndex.y }
  }
}

// GetPinControlIndex — C# GetPinControlIndex (Up→x+1, Down→x-1, Right→y-1, Left→y+1)
// NOTE: this is the OPPOSITE of directionToStep — read off the C# source, not intuited.
function getPinControlIndex(index, direction) {
  switch (direction) {
    case Direction.Up:    return { x: index.x + 1, y: index.y }
    case Direction.Down:  return { x: index.x - 1, y: index.y }
    case Direction.Right: return { x: index.x, y: index.y - 1 }
    case Direction.Left:  return { x: index.x, y: index.y + 1 }
    default:              return { x: index.x, y: index.y }
  }
}

// GetDirectionStep — C# GetDirectionStep (sign of the component-wise diff to→from)
function getDirectionStep(from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return {
    x: dx === 0 ? 0 : (dx > 0 ? 1 : -1),
    y: dy === 0 ? 0 : (dy > 0 ? 1 : -1),
  }
}

// ---------------------------------------------------------------------------
// SimStackData (mirrors C# SimStackData)
// ---------------------------------------------------------------------------
class SimStackData {
  constructor() {
    this.stackIndex = { x: 0, y: 0 }  // where the physical stack sits
    this.spawnIndex = { x: 0, y: 0 }  // where buckets appear
    this.buckets = []                 // all buckets in order, first to last
    this.currentIndex = 0
    this.moveIndex = 0
  }

  get current() {
    return this.currentIndex < this.buckets.length ? this.buckets[this.currentIndex] : null
  }
  get isExhausted() { return this.currentIndex >= this.buckets.length - 1 }
  advance() { this.currentIndex++ }
}

// ---------------------------------------------------------------------------
// Internal cell class
// ---------------------------------------------------------------------------
class SimCell {
  constructor(x, y, cellType, colorType) {
    this.index = { x, y }
    this.cellType = cellType
    this.colorType = colorType
    this.isAvailable = false
    this.capacity = 0

    // Ice — from config, never changes
    this.iceCount = 0

    // Mystery — locked until a neighbour is picked
    this.isMystery = false
    this.isMysterySolved = false

    // Key / Lock — matched by colorIndex
    this.isKey = false
    this.isLock = false
    this.keyColorIndex = 0

    // Pin
    this.isPinControl = false
    this.isPinWall = false
    this.pinControlIndex = { x: 0, y: 0 }
    this.pinWalls = []

    // Sticky — paired bucket, both picked together
    this.isSticky = false
    this.stickyDirection = 0
    this.stickyPair = null

    // Switch — swaps color with pair on every pick until one is picked
    this.isSwitch = false
    this.switchId = null
    this.switchPair = null

    // Chest — auto-triggers when path opens, spawns buckets on nearby cells
    this.isChest = false
    this.chestColors = []
  }

  get isBucket()   { return this.cellType === SimCellType.Bucket }
  get isWall()     { return this.cellType === SimCellType.Wall }
  get isEmpty()    { return this.cellType === SimCellType.Empty }
  get isMechanic() { return this.cellType === SimCellType.Mechanic }
  // Walls, mechanics, AND other buckets block BFS traversal.
  get isBlocking() {
    return this.cellType === SimCellType.Wall ||
           this.cellType === SimCellType.Mechanic ||
           this.cellType === SimCellType.Bucket
  }
  // IsPickable(globalPickCount) — faithful port of C# SimCellData.IsPickable.
  // At least one of a sticky pair must have a path; ice gate is pickCount >= IceCount;
  // mystery must be solved.
  isPickable(globalPickCount) {
    return (this.isAvailable ||
            (this.isSticky && this.stickyPair !== null && this.stickyPair.isAvailable)) &&
           (this.iceCount <= 0 || globalPickCount >= this.iceCount) &&
           (!this.isMystery || this.isMysterySolved)
  }
}

// ---------------------------------------------------------------------------
// SimGridBasic
// ---------------------------------------------------------------------------
export class SimGridBasic {
  constructor() {
    this._width = 0
    this._height = 0
    this._cells = []   // _cells[x][y]
    this._stacks = []  // SimStackData[]
    this.globalPickCount = 0
    this._capacityQueues = new Map()  // ColorType -> int[] (FIFO), kept for chest spawns
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------
  get width()  { return this._width }
  get height() { return this._height }

  // GetStacks() — exposes the built SimStackData list.
  getStacks() { return this._stacks }

  // -------------------------------------------------------------------------
  // init(level) — build grid from parsed level JSON, compute availability,
  //               assign capacities.
  // -------------------------------------------------------------------------
  init(level) {
    this._width  = level.gridWidth
    this._height = level.gridHeight
    this._stacks = []
    this.globalPickCount = 0

    // Allocate full 2-D grid, defaulting every cell to Empty.
    this._cells = []
    for (let x = 0; x < this._width; x++) {
      this._cells[x] = []
      for (let y = 0; y < this._height; y++) {
        this._cells[x][y] = new SimCell(x, y, SimCellType.Empty, 0)
      }
    }

    // 1. Build all cells — carry ALL mechanic fields onto each SimCell.
    for (const c of level.cells) {
      if (!this._isInside(c.x, c.y)) continue
      const sim = new SimCell(c.x, c.y, c.simType, c.ct)

      sim.iceCount       = c.iceCount || 0
      sim.isMystery      = !!c.isMystery
      sim.isMysterySolved = false
      sim.isKey          = !!c.isKey
      sim.isLock         = !!c.isLock
      sim.keyColorIndex  = c.keyColorIndex || 0
      sim.isPinControl   = !!c.isPinControl
      sim.isPinWall      = !!c.isPinWall
      // Seed pinControlIndex from direction (C# SimCellData ctor lines 62-64).
      // ResolvePinControlIndexes refines this; BuildPinPairs re-derives its
      // step from the resolved value — so the seed MUST be set here.
      sim.pinControlIndex = c.isPinControl
        ? getPinControlIndex({ x: c.x, y: c.y }, c.direction || 0)
        : { x: 0, y: 0 }
      sim.isSticky        = !!c.isSticky
      sim.stickyDirection = c.isSticky ? (c.direction || 0) : 0
      sim.isSwitch        = !!c.isSwitch
      sim.switchId        = c.isSwitch ? (c.switchId ?? null) : null
      sim.isChest         = !!c.isChest
      sim.chestColors     = c.isChest && Array.isArray(c.chestColors)
        ? [...c.chestColors]
        : []

      this._cells[c.x][c.y] = sim
    }

    // 2. Build stacks (SimStackData + virtual bucket chain).
    for (const c of level.cells) {
      if (!this._isInside(c.x, c.y)) continue
      if (Array.isArray(c.stackColors) && c.stackColors.length > 0) {
        this._buildStack(this._cells[c.x][c.y], c)
      }
    }

    // 3. Link PinControl → PinWall pairs (resolve MUST precede build).
    this._resolvePinControlIndexes()
    this._buildPinPairs()

    // 4. Link Sticky pairs.
    this._buildStickyPairs()

    // 5. Link Switch pairs.
    this._buildSwitchPairs()

    // 6. Pre-compute availability.
    this._computeAvailability()

    // 7. Assign capacities (grid buckets then stack buckets, same queues).
    this._assignBucketCapacities(level.bucketCapacities || [])
  }

  // -------------------------------------------------------------------------
  // getCell({x, y}) — returns cell or null for out-of-bounds
  // -------------------------------------------------------------------------
  getCell({ x, y }) {
    if (!this._isInside(x, y)) return null
    return this._cells[x][y]
  }

  // -------------------------------------------------------------------------
  // getTotalBucketCount — C# GetTotalBucketCount. Counts bucket cells, chest
  // colors (each chest contributes ChestColors.length), and pending stack
  // buckets (indices [moveIndex, buckets.length)).
  // -------------------------------------------------------------------------
  getTotalBucketCount() {
    let count = 0
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (cell.isBucket) count++
        else if (cell.isChest) count += cell.chestColors.length
      }
    }
    for (const stack of this._stacks) {
      for (let i = stack.moveIndex; i < stack.buckets.length; i++) count++
    }
    return count
  }

  // -------------------------------------------------------------------------
  // getAvailableBuckets() — C# GetAvailableBuckets. x-outer / y-inner order.
  // Predicate: isBucket && isPickable(globalPickCount) && (!isSticky || isAvailable)
  // (the sticky clause returns only the partner with its own path).
  // -------------------------------------------------------------------------
  getAvailableBuckets() {
    const result = []
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (cell.isBucket && cell.isPickable(this.globalPickCount) &&
            (!cell.isSticky || cell.isAvailable)) {
          result.push(cell)
        }
      }
    }
    return result
  }

  // -------------------------------------------------------------------------
  // pick(cell, isDFS=false) — faithful port of SimGrid.Pick.
  // The headless sim picks with isDFS=false (default). Order:
  //   guard -> pickCount++ -> empty cell -> stack advance -> (DFS-only sticky
  //   co-pick) -> switch dissolve + SwapSwitchPairs -> mystery solve on
  //   neighbours -> RefreshAvailability.
  // -------------------------------------------------------------------------
  pick(cell, isDFS = false) {
    // Ice gate is checked against the pre-increment count (C# lines 150->152).
    if (!cell || !cell.isPickable(this.globalPickCount) || !cell.isBucket) return

    this.globalPickCount++

    cell.cellType = SimCellType.Empty
    cell.isAvailable = false

    // 1. Stack — activate next bucket or exhaust.
    const stack = this._stacks.find(
      s => s.spawnIndex.x === cell.index.x && s.spawnIndex.y === cell.index.y
    )
    if (stack) {
      if (!stack.isExhausted) {
        stack.moveIndex++
        if (stack.moveIndex > 1) stack.advance()

        const next = stack.current
        cell.cellType = SimCellType.Bucket
        cell.isAvailable = true
        cell.colorType = stack.current.colorType
        cell.capacity = stack.current.capacity
        // C# replaces the grid slot with a NEW cell at spawnIndex.
        const replacement = new SimCell(next.index.x, next.index.y, next.cellType, next.colorType)
        replacement.capacity = next.capacity
        replacement.isAvailable = next.isAvailable
        this._cells[stack.spawnIndex.x][stack.spawnIndex.y] = replacement
      }
    }

    // 2. Sticky — pick paired bucket together (DFS-only; not for isDFS=false).
    if (isDFS) {
      if (cell.isSticky && cell.stickyPair !== null && !cell.stickyPair.isEmpty) {
        cell.stickyPair.cellType = SimCellType.Empty
        cell.stickyPair.isAvailable = false
        this.globalPickCount++
      }
    }

    // 3. Switch — dissolve if the picked cell is a switch, then swap all pairs.
    if (cell.isSwitch && cell.switchPair !== null) {
      cell.switchPair.switchPair = null
      cell.switchPair.isSwitch = false
      cell.switchPair = null
      cell.isSwitch = false
    }
    this._swapSwitchPairs(isDFS)

    // 4. Mystery — solve any adjacent mystery buckets (by the original cell index).
    for (const neighbor of this._getImmediateNeighbors(cell.index)) {
      if (neighbor.isMystery && !neighbor.isMysterySolved) {
        neighbor.isMysterySolved = true
      }
    }

    // 5. Refresh availability — after all mechanics resolved.
    this._refreshAvailability(isDFS)
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  _isInside(x, y) {
    return x >= 0 && x < this._width && y >= 0 && y < this._height
  }

  /**
   * HasPathToTop — BFS over empty cells from the start bucket to x === 0.
   *
   * Faithful port of C# HasPathToTop:
   * - Start cell must be a bucket.
   * - Early return if start.x === 0.
   * - Enqueue start; then traverse only non-blocking (empty) neighbors.
   * - A neighbor at x === 0 that is empty → path found.
   * - Walls, mechanics, and OTHER buckets all block traversal.
   *
   * dirs = {(-1,0),(1,0),(0,1),(0,-1)} — Unity Vector2Int.left/right/up/down.
   */
  _hasPathToTop(sx, sy) {
    const startCell = this._cells[sx][sy]
    if (!startCell || !startCell.isBucket) return false
    if (sx === 0) return true

    const queue = [[sx, sy]]
    const visited = new Set()
    visited.add(`${sx},${sy}`)

    const dirs = [[-1, 0], [1, 0], [0, 1], [0, -1]]

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()
      for (const [dx, dy] of dirs) {
        const nx = cx + dx
        const ny = cy + dy
        if (!this._isInside(nx, ny)) continue
        const key = `${nx},${ny}`
        if (visited.has(key)) continue
        const nc = this._cells[nx][ny]
        if (nc.isBlocking) continue   // walls, mechanics, other buckets block
        visited.add(key)
        if (nx === 0) return true     // reached top via an empty cell
        queue.push([nx, ny])
      }
    }
    return false
  }

  /**
   * ComputeAvailability — sets isAvailable on every bucket.
   */
  _computeAvailability() {
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (cell.isBucket) {
          cell.isAvailable = this._hasPathToTop(x, y)
        }
      }
    }
  }

  /**
   * HasPathToTopMechanic — C# HasPathToTopMechanic. Identical BFS to
   * _hasPathToTop EXCEPT the start cell is NOT required to be a bucket (used
   * for chests + keys, which are Mechanic cells). Returns false for null start,
   * true if start.x === 0, else BFS over non-blocking cells to x === 0.
   */
  _hasPathToTopMechanic(sx, sy) {
    const startCell = this._cells[sx][sy]
    if (!startCell) return false
    if (sx === 0) return true

    const queue = [[sx, sy]]
    const visited = new Set()
    visited.add(`${sx},${sy}`)

    const dirs = [[-1, 0], [1, 0], [0, 1], [0, -1]]

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()
      for (const [dx, dy] of dirs) {
        const nx = cx + dx
        const ny = cy + dy
        if (!this._isInside(nx, ny)) continue
        const key = `${nx},${ny}`
        if (visited.has(key)) continue
        const nc = this._cells[nx][ny]
        if (nc.isBlocking) continue
        visited.add(key)
        if (nx === 0) return true
        queue.push([nx, ny])
      }
    }
    return false
  }

  /**
   * GetImmediateNeighbors — C# GetImmediateNeighbors. The 4-connected in-bounds
   * neighbours of `index` (left/right/up/down).
   */
  _getImmediateNeighbors(index) {
    const dirs = [[-1, 0], [1, 0], [0, 1], [0, -1]]
    const result = []
    for (const [dx, dy] of dirs) {
      const nx = index.x + dx
      const ny = index.y + dy
      if (this._isInside(nx, ny)) result.push(this._cells[nx][ny])
    }
    return result
  }

  /**
   * RefreshAvailability — C# RefreshAvailability. Order is load-bearing:
   *   0. chests (spawn when path-to-top clear, then empty the chest)
   *   1. pins (control + walls empty when watched cell is empty)
   *   2. keys (empty matching lock + key when path-to-top clear)
   *   3. stack spawn-on-empty
   *   4. recompute every bucket's isAvailable (LAST).
   */
  _refreshAvailability(isDFS = false) {
    // 0. Chests — auto-trigger when path to top is clear.
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (!cell || !cell.isChest) continue
        if (!this._hasPathToTopMechanic(x, y)) continue
        const spawned = this._spawnChestBuckets(cell)
        if (spawned) {
          cell.cellType = SimCellType.Empty
          cell.isChest = false
        }
      }
    }

    // 1. Pins — clear control + walls when the watched cell is empty.
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (!cell || !cell.isPinControl) continue
        const watched = this.getCell(cell.pinControlIndex)
        if (!watched || !watched.isEmpty) continue
        cell.cellType = SimCellType.Empty
        for (const wall of cell.pinWalls) wall.cellType = SimCellType.Empty
      }
    }

    // 2. Keys — clear matching lock + key when path to top is clear.
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (!cell || !cell.isKey) continue
        if (!this._hasPathToTopMechanic(x, y)) continue

        let matchingLock = null
        for (let lx = 0; lx < this._width && !matchingLock; lx++) {
          for (let ly = 0; ly < this._height; ly++) {
            const lc = this._cells[lx][ly]
            if (lc && lc.isLock && lc.keyColorIndex === cell.keyColorIndex) {
              matchingLock = lc
              break
            }
          }
        }
        if (matchingLock) matchingLock.cellType = SimCellType.Empty
        cell.cellType = SimCellType.Empty
      }
    }

    // 3. Stack spawn-on-empty — first bucket appears once the spawn cell empties.
    for (const stack of this._stacks) {
      if (!stack.isExhausted) {
        const spawnCell = this.getCell(stack.spawnIndex)
        if (spawnCell && spawnCell.cellType === SimCellType.Empty && stack.moveIndex === 0) {
          stack.moveIndex++
          if (stack.moveIndex > 1) stack.advance()
          const next = stack.current
          const replacement = new SimCell(next.index.x, next.index.y, next.cellType, next.colorType)
          replacement.capacity = next.capacity
          replacement.isAvailable = next.isAvailable
          this._cells[stack.spawnIndex.x][stack.spawnIndex.y] = replacement
        }
      }
    }

    // 4. Recompute bucket availability (LAST).
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (cell.isBucket) {
          cell.isAvailable = this._hasPathToTop(x, y)
        }
      }
    }
  }

  /**
   * SwapSwitchPairs — C# SwapSwitchPairs. For each unprocessed switch cell with
   * a switchPair, swap BOTH colorType and capacity with the partner.
   */
  _swapSwitchPairs(_isDFS = false) {
    const processed = new Set()
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (!cell || !cell.isSwitch || cell.switchPair === null) continue
        if (processed.has(cell)) continue

        const tmpColor = cell.colorType
        cell.colorType = cell.switchPair.colorType
        cell.switchPair.colorType = tmpColor

        const tmpCap = cell.capacity
        cell.capacity = cell.switchPair.capacity
        cell.switchPair.capacity = tmpCap

        processed.add(cell)
        processed.add(cell.switchPair)
      }
    }
  }

  /**
   * SpawnChestBuckets — C# SpawnChestBuckets. Ring scan radius 1..5,
   * x-outer/y-inner, skip interior of the ring. Place chestColors[spawned] on
   * empty cells; dequeue capacity from _capacityQueues (the `continue`-before-
   * increment quirk is preserved faithfully). Returns true if any spawned.
   */
  _spawnChestBuckets(chest) {
    if (!chest.chestColors || chest.chestColors.length === 0) return false

    const colors = chest.chestColors
    const center = chest.index
    let spawned = 0

    for (let radius = 1; radius <= 5; radius++) {
      for (let x = center.x - radius; x <= center.x + radius; x++) {
        for (let y = center.y - radius; y <= center.y + radius; y++) {
          if (Math.abs(x - center.x) < radius && Math.abs(y - center.y) < radius) continue
          if (!this._isInside(x, y)) continue

          const cell = this._cells[x][y]
          if (!cell || !cell.isEmpty) continue

          cell.cellType = SimCellType.Bucket
          cell.colorType = colors[spawned]
          cell.isAvailable = false
          const q = this._capacityQueues.get(cell.colorType)
          // Faithful C#: `if (!TryGetValue) continue;` then `if (Count != 0)` dequeue.
          if (!q) continue
          if (q.length !== 0) {
            cell.capacity = q.shift()
          }
          spawned++

          if (spawned >= colors.length) return true
        }
      }
    }
    return spawned > 0
  }

  /**
   * AssignBucketCapacities — per-color FIFO queues, consumed in x-outer/y-inner
   * order (mirrors C# 2D array enumeration [width,height] → x outer, y inner).
   *
   * @param {Array<{ct:number, cap:number}>} bucketCapacities
   */
  _assignBucketCapacities(bucketCapacities) {
    // Build per-color FIFO queues in BucketCapacities list order.
    // Kept as a member so SpawnChestBuckets can dequeue at refresh time
    // (C# _capacityQueues, lines 109-117 + 975-979).
    const queues = new Map()
    this._capacityQueues = queues
    for (const { ct, cap } of bucketCapacities) {
      if (!queues.has(ct)) queues.set(ct, [])
      queues.get(ct).push(cap)
    }

    // Assign to grid cells in x-outer / y-inner order (critical for correctness).
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (!cell.isBucket) continue
        const q = queues.get(cell.colorType)
        if (q && q.length > 0) {
          cell.capacity = q.shift()
        }
      }
    }

    // Then assign to stack buckets, consuming the SAME queues (C# lines 131-140).
    // Stack spawn cells are NOT in _cells at init, so the grid pass skipped them.
    for (const stack of this._stacks) {
      for (const bucket of stack.buckets) {
        const q = queues.get(bucket.colorType)
        if (q && q.length > 0) {
          bucket.capacity = q.shift()
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // BuildStack — C# BuildStack. Stack cell stays Mechanic; one SimCell bucket
  // per color, all at spawnIndex, stored in a SimStackData.
  // -------------------------------------------------------------------------
  _buildStack(stackCell, cellData) {
    stackCell.cellType = SimCellType.Mechanic

    const colors = cellData.stackColors
    if (!colors || colors.length === 0) return

    const spawnIndex = getSpawnIndex(stackCell.index, cellData.direction || 0)
    if (!this._isInside(spawnIndex.x, spawnIndex.y)) return

    const stack = new SimStackData()
    stack.stackIndex = { x: stackCell.index.x, y: stackCell.index.y }
    stack.spawnIndex = spawnIndex

    for (const color of colors) {
      const bucket = new SimCell(spawnIndex.x, spawnIndex.y, SimCellType.Bucket, color)
      bucket.isAvailable = false
      stack.buckets.push(bucket)
    }

    this._stacks.push(stack)
    // First bucket does NOT occupy spawnIndex in _cells (C# line 691 commented).
  }

  // -------------------------------------------------------------------------
  // ResolvePinControlIndexes — C# ResolvePinControlIndexes. Ray-cast from the
  // control along its seeded direction; the watched index becomes the first
  // bucket / pin_control hit.
  // -------------------------------------------------------------------------
  _resolvePinControlIndexes() {
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const control = this._cells[x][y]
        if (!control || !control.isPinControl) continue

        const step = getDirectionStep(control.index, control.pinControlIndex)
        let cur = { x: control.index.x + step.x, y: control.index.y + step.y }

        while (this._isInside(cur.x, cur.y)) {
          const cell = this._cells[cur.x][cur.y]
          if (cell && (cell.isBucket || cell.isPinControl)) {
            control.pinControlIndex = { x: cur.x, y: cur.y }
            break
          }
          cur = { x: cur.x + step.x, y: cur.y + step.y }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // BuildPinPairs — C# BuildPinPairs. Walk OPPOSITE the resolved control step,
  // collecting pin_walls; stop on a non-(pinWall|wall|stack) cell.
  // -------------------------------------------------------------------------
  _buildPinPairs() {
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const control = this._cells[x][y]
        if (!control || !control.isPinControl) continue

        const step = getDirectionStep(control.index, control.pinControlIndex)
        const wallStep = { x: -step.x, y: -step.y }
        let cur = { x: control.index.x + wallStep.x, y: control.index.y + wallStep.y }

        while (this._isInside(cur.x, cur.y)) {
          const cell = this._cells[cur.x][cur.y]
          const isStackIndex = this._stacks.some(
            s => s.stackIndex.x === cur.x && s.stackIndex.y === cur.y
          )
          if (!cell || (!cell.isPinWall && !cell.isWall && !isStackIndex)) break
          if (cell.isPinWall) control.pinWalls.push(cell)
          cur = { x: cur.x + wallStep.x, y: cur.y + wallStep.y }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // BuildStickyPairs — C# BuildStickyPairs. Link to neighbour in stickyDirection.
  // -------------------------------------------------------------------------
  _buildStickyPairs() {
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (!cell || !cell.isSticky || cell.stickyPair !== null) continue

        const step = directionToStep(cell.stickyDirection)
        const other = this.getCell({ x: cell.index.x + step.x, y: cell.index.y + step.y })

        if (other && other.isSticky) {
          cell.stickyPair = other
          other.stickyPair = cell
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // BuildSwitchPairs — C# BuildSwitchPairs. Group by switchId; link groups of 2.
  // -------------------------------------------------------------------------
  _buildSwitchPairs() {
    const groups = new Map()
    for (let x = 0; x < this._width; x++) {
      for (let y = 0; y < this._height; y++) {
        const cell = this._cells[x][y]
        if (!cell || !cell.isSwitch) continue
        const key = cell.switchId
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(cell)
      }
    }
    for (const list of groups.values()) {
      if (list.length !== 2) continue
      list[0].switchPair = list[1]
      list[1].switchPair = list[0]
    }
  }
}
