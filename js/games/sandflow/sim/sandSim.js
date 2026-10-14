/**
 * SandSim — faithful JS port of the Unity C# cellular-automaton (SimSandSimulation.cs).
 *
 * FAITHFULNESS RULE: NextRand() (this._next()) MUST be called the exact same number of
 * times, in the exact same order, under the exact same branch conditions as C#. The RNG
 * is deterministic, so call-order IS the physics. Conditions are written in the same order
 * as C# so JS &&/|| short-circuit consumes RNG identically. NextRand() is NEVER hoisted out
 * of a boolean expression.
 *
 * Float math is translated directly (JS float64 vs C# float32 — divergence accepted).
 */
import { makeRng } from './rng.js'
import { SAND_CFG } from './config.js'

const NONE = 0
const COLOR_TYPE_COUNT = 28

/** Unity Mathf.RoundToInt: round-half-to-even (banker's rounding). */
export function roundHalfToEven(f) {
  const floor = Math.floor(f)
  const diff = f - floor
  if (diff < 0.5) return floor
  if (diff > 0.5) return floor + 1
  // exactly .5 → round to even
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * Standalone nearest-color mapper — reproduces the C# ColorAnalyzer.
 * pixels: Uint8Array RGBA in C# GetPixels32 order (offset (x + y*srcW)*4, no row flip).
 * Returns Int16Array(W*H), layout x + y*W, 0 = None.
 */
export function mapPixelsToColorTypes(pixels, srcW, srcH, palette, cfg = SAND_CFG) {
  const W = cfg.textureWidth
  const H = cfg.textureHeight
  const out = new Int16Array(W * H) // init 0 (None)
  const gw = Math.min(W, srcW)
  const gh = Math.min(H, srcH)
  const alpha = cfg.alphaThreshold
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const p = (x + y * srcW) * 4
      if (pixels[p + 3] < alpha) continue // transparent → stays None
      const r = pixels[p]
      const g = pixels[p + 1]
      const b = pixels[p + 2]
      let bestDist = Infinity
      let bestCt = NONE
      for (let i = 0; i < palette.length; i++) {
        const e = palette[i]
        const dr = r - e.r
        const dg = g - e.g
        const db = b - e.b
        const dist = dr * dr + dg * dg + db * db
        // strict < so the FIRST minimum wins (matches C#)
        if (dist < bestDist) {
          bestDist = dist
          bestCt = e.ct
        }
      }
      out[x + y * W] = bestCt
    }
  }
  return out
}

export class SandSim {
  constructor(cfg = SAND_CFG) {
    this._config = cfg
    this._colorTypeCount = COLOR_TYPE_COUNT
    this._next = makeRng(1) // default; overwritten by setSeed

    // grids / counts (allocated in init)
    this._grid = null
    this._colorTypes = null
    this._colorCounts = new Int32Array(COLOR_TYPE_COUNT)
    this._tempColorCounts = new Int32Array(COLOR_TYPE_COUNT)

    this._maxSandHeight = 0
    this._initialMaxSandHeight = 0
    this._initialSandCount = 0
    this._totalSandRemoved = 0
    this._sandRemovedPercentage = 0 // FLOAT fraction 0..1

    this._width = 0
    this._height = 0
    this._suctionWidth = 0
    this._suctionHeight = 0
    this._alphaThreshold = cfg.alphaThreshold

    this._centerX = 0
    this._invHeight = 0
    this._activeBucketX = 0

    // per-step precomputed
    this._simSandRemovedMult = 0
    this._simDiamondHeight = 0
    this._simTaperExp = 0
    this._simAnchorWidth = 0
    this._simBucketSide = 0
    this._simAnchorTiltStr = 0
    this._simFlatTopRatio = 0
    this._simInvFlatTopRange = 0
    this._simPeakInstability = 0
    this._simPeakSpillFactor = 0
    this._simCenterFlow = 0
    this._simEdgeFlowDelta = 0
    this._simCohesionMult = 0
    this._simWallSlipper = 0

    this._rowHeightRatio = null
    this._rowSandHeightRatio = null
    this._rowEffectiveAnchorWidth = null
  }

  // ---- init ----
  init(colorTypesGrid, width, height, suctionWidth, suctionHeight) {
    this._width = width
    this._height = height
    this._suctionWidth = suctionWidth
    this._suctionHeight = suctionHeight
    this._alphaThreshold = this._config.alphaThreshold

    this._centerX = width * 0.5
    this._invHeight = 1 / height
    this._activeBucketX = this._centerX

    this._colorTypeCount = COLOR_TYPE_COUNT
    this._colorCounts = new Int32Array(COLOR_TYPE_COUNT)
    this._tempColorCounts = new Int32Array(COLOR_TYPE_COUNT)

    this._rowHeightRatio = new Float64Array(height)
    this._rowSandHeightRatio = new Float64Array(height)
    this._rowEffectiveAnchorWidth = new Float64Array(height)

    const n = width * height
    this._grid = new Uint8Array(n)
    this._colorTypes = new Int16Array(n)

    this._maxSandHeight = 0
    // InitializeGrid: grid=1 where colorType != None; count colorCounts; track maxSandHeight.
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width
      for (let x = 0; x < width; x++) {
        const idx = rowOffset + x
        const ct = colorTypesGrid[idx] | 0
        this._colorTypes[idx] = ct
        if (ct !== NONE) {
          this._grid[idx] = 1
          this._colorCounts[ct]++
          if (y > this._maxSandHeight) this._maxSandHeight = y
        } else {
          this._grid[idx] = 0
        }
      }
    }

    let total = 0
    for (let i = 0; i < this._colorCounts.length; i++) total += this._colorCounts[i]
    this._initialSandCount = total
    this._initialMaxSandHeight = this._maxSandHeight

    this._totalSandRemoved = 0
    this._sandRemovedPercentage = 0
  }

  setSeed(seed) {
    this._next = makeRng(seed)
  }

  // ---- getters ----
  get colorCounts() {
    return this._colorCounts
  }
  get width() {
    return this._width
  }
  get height() {
    return this._height
  }
  get initialSandCount() {
    return this._initialSandCount
  }
  get initialMaxSandHeight() {
    return this._initialMaxSandHeight
  }
  get maxSandHeight() {
    return this._maxSandHeight
  }
  /** float fraction 0..1 used by physics (C# field _sandRemovedPercentage). */
  get sandRemovedFraction() {
    return this._sandRemovedPercentage
  }
  /** C# property: all colorCounts === 0. */
  get isAllSandRemoved() {
    for (let i = 0; i < this._colorCounts.length; i++) {
      if (this._colorCounts[i] !== 0) return false
    }
    return true
  }
  /** C# property SandRemovedPercentage: int, round-half-to-even (Mathf.RoundToInt). */
  get sandRemovedPercentage() {
    if (this._initialSandCount === 0) return 0
    let sum = 0
    for (let i = 0; i < this._colorCounts.length; i++) sum += this._colorCounts[i]
    return roundHalfToEven((1 - sum / this._initialSandCount) * 100)
  }

  // ---- low-level grid helpers ----
  _inBounds(x, y) {
    return (x >>> 0) < this._width && (y >>> 0) < this._height
  }
  _isEmpty(x, y) {
    // OOB counts as empty
    return (
      (x >>> 0) >= this._width ||
      (y >>> 0) >= this._height ||
      this._grid[x + y * this._width] === 0
    )
  }
  _getColorTypeAtPos(x, y) {
    return this._inBounds(x, y) ? this._colorTypes[x + y * this._width] : NONE
  }

  _tryMove(x1, y1, x2, y2) {
    if (!this._inBounds(x2, y2)) return false
    const i1 = x1 + y1 * this._width
    const i2 = x2 + y2 * this._width
    if (this._grid[i2] !== 0) return false
    this._grid[i2] = this._grid[i1]
    this._grid[i1] = 0
    this._colorTypes[i2] = this._colorTypes[i1]
    this._colorTypes[i1] = NONE
    if (y2 > this._maxSandHeight) this._maxSandHeight = y2
    return true
  }

  _removeSandAtPos(x, y) {
    const index = x + y * this._width
    const ct = this._colorTypes[index]
    if (ct === NONE) return
    this._grid[index] = 0
    this._colorTypes[index] = NONE
    this._colorCounts[ct]--
  }

  // ---- suction ----
  removeSandForBucket(bucketGridX, bucketColor, remainingCapacity) {
    if (bucketGridX < 0 || bucketGridX >= this._width) return 0
    this._activeBucketX = bucketGridX
    const half = Math.trunc(this._suctionWidth / 2) // integer division
    let startX = bucketGridX - half
    if (startX < 0) startX = 0
    else if (startX > this._width - 1) startX = this._width - 1
    let endX = bucketGridX + half
    if (endX < 0) endX = 0
    else if (endX > this._width - 1) endX = this._width - 1
    const endY = Math.min(this._suctionHeight - 1, this._height - 1)

    let sandRemoved = 0
    for (let y = 0; y <= endY && sandRemoved < remainingCapacity; y++) {
      const rowOffset = y * this._width
      for (let x = startX; x <= endX && sandRemoved < remainingCapacity; x++) {
        const idx = rowOffset + x
        if (this._grid[idx] === 0 || this._colorTypes[idx] !== bucketColor) continue
        this._removeSandAtPos(x, y)
        sandRemoved++
      }
    }
    this._totalSandRemoved += sandRemoved
    this._sandRemovedPercentage =
      this._initialSandCount > 0 ? this._totalSandRemoved / this._initialSandCount : 0
    return sandRemoved
  }

  getSortedColorPriorityList() {
    this._tempColorCounts.fill(0)
    // NOTE: y <= _suctionHeight (inclusive)
    for (let y = 0; y <= this._suctionHeight && y < this._height; y++) {
      const rowOffset = y * this._width
      for (let x = 0; x < this._width; x++) {
        const t = this._colorTypes[rowOffset + x]
        if (t !== NONE) this._tempColorCounts[t]++
      }
    }
    const result = []
    for (let ct = 0; ct < this._tempColorCounts.length; ct++) {
      if (this._tempColorCounts[ct] > 0) result.push(ct)
    }
    // count DESC (C# List.Sort comparer: _tempColorCounts[b] - _tempColorCounts[a])
    result.sort((a, b) => this._tempColorCounts[b] - this._tempColorCounts[a])
    return result
  }

  // ---- per-step precompute ----
  _preComputeSimStep() {
    const c = this._config
    this._simSandRemovedMult = 1 - this._sandRemovedPercentage // FLOAT fraction
    this._simAnchorWidth = c.anchorWidth
    this._simDiamondHeight = this._initialMaxSandHeight * this._simSandRemovedMult
    this._simTaperExp = c.diamondTaper
    this._simFlatTopRatio = c.flatTopHeightRatio
    const flatTopRange = 1 - this._simFlatTopRatio
    this._simInvFlatTopRange = flatTopRange > 0 ? 1 / flatTopRange : 0
    this._simPeakInstability = c.peakInstabilityFactor
    this._simPeakSpillFactor = c.peakSpillFactor
    this._simCenterFlow = c.centerFlowChance
    this._simEdgeFlowDelta = c.edgeFlowChance - this._simCenterFlow
    this._simCohesionMult = 1 - c.cohesionStrength
    this._simWallSlipper = c.wallSlipperFactor
    this._simBucketSide = (this._activeBucketX - this._centerX) / this._centerX
    this._simAnchorTiltStr = c.anchorTiltStrength

    const invDiamondH = this._simDiamondHeight > 0 ? 1 / this._simDiamondHeight : 0
    for (let y = 0; y < this._height; y++) {
      const hr = y * this._invHeight
      let shr
      if (this._simDiamondHeight > 0) {
        const v = y * invDiamondH
        shr = v > 1 ? 1 : v
      } else {
        shr = hr
      }
      const aw =
        this._simTaperExp > 0
          ? this._simAnchorWidth * (1 - Math.pow(shr, this._simTaperExp))
          : this._simAnchorWidth
      this._rowHeightRatio[y] = hr
      this._rowSandHeightRatio[y] = shr
      this._rowEffectiveAnchorWidth[y] = aw
    }
  }

  // ---- simulate ----
  simulate() {
    this._preComputeSimStep()
    for (let y = 1; y <= this._maxSandHeight + 1 && y < this._height; y++) {
      const leftToRight = (y & 1) === 0
      if (leftToRight) {
        for (let x = 0; x < this._width; x++) this._simulateCell(x, y)
      } else {
        for (let x = this._width - 1; x >= 0; x--) this._simulateCell(x, y)
      }
    }
    for (let i = Math.trunc(this._maxSandHeight / 2); i < this._maxSandHeight; i++) {
      const rowOffset = i * this._width
      for (let x = 0; x < this._width; x++) {
        if (this._grid[rowOffset + x] !== 0 && this._isEmpty(x, i - 1)) {
          this._tryMove(x, i, x, i - 1)
        }
      }
    }
    this._stabilizePeak()
  }

  _simulateCell(x, y) {
    const index = x + y * this._width
    if (this._grid[index] === 0) return
    const myColor = this._colorTypes[index]
    const dx = x - this._centerX
    const nd = (dx < 0 ? -dx : dx) / this._centerX
    const heightRatio = this._rowHeightRatio[y]
    const sandHeightRatio = this._rowSandHeightRatio[y]
    const effectiveAnchorWidth = this._rowEffectiveAnchorWidth[y]

    let currentStability = 1 - heightRatio
    if (currentStability < 0.92) currentStability = 0.92
    if (sandHeightRatio > 0.85) currentStability *= 1 - this._simPeakSpillFactor
    if (sandHeightRatio > this._simFlatTopRatio) {
      const spillMult = (sandHeightRatio - this._simFlatTopRatio) * this._simInvFlatTopRange
      currentStability *= 1 - this._simPeakInstability * spillMult
    }
    if (nd > effectiveAnchorWidth * 0.75 && nd < effectiveAnchorWidth) {
      currentStability *= 0.85
    }
    if (nd < effectiveAnchorWidth) {
      let stability = currentStability
      if (this._simAnchorTiltStr > 0) {
        const ndSigned = (x - this._centerX) / this._centerX
        const sideBias = ndSigned * this._simBucketSide
        if (sideBias > 0) stability *= 1 - sideBias * this._simAnchorTiltStr
      }
      if (this._next() < stability) {
        if (this._tryMove(x, y, x, y - 1)) return
      }
    }
    if (x < this._simWallSlipper || x > this._width - this._simWallSlipper) {
      if (this._canMoveToRegion(x, y - 1, myColor)) {
        if (this._tryMove(x, y, x, y - 1)) return
      }
    }
    const leftEmpty = this._isEmpty(x - 1, y - 1)
    const rightEmpty = this._isEmpty(x + 1, y - 1)
    const baseChance = this._simCenterFlow + this._simEdgeFlowDelta * (nd * heightRatio)
    const attached =
      this._getColorTypeAtPos(x - 1, y) === myColor ||
      this._getColorTypeAtPos(x + 1, y) === myColor ||
      this._getColorTypeAtPos(x, y + 1) === myColor ||
      this._getColorTypeAtPos(x, y - 1) === myColor
    const diagonalChance = attached ? baseChance * this._simCohesionMult : baseChance
    if (leftEmpty && rightEmpty) {
      const preferredDir = x < this._centerX ? 1 : -1
      const secondaryDir = -preferredDir
      if (
        this._canMoveToRegion(x + preferredDir, y - 1, myColor) &&
        this._next() < diagonalChance
      ) {
        if (this._tryMove(x, y, x + preferredDir, y - 1)) return
      }
      if (this._canMoveToRegion(x + secondaryDir, y - 1, myColor) && this._next() < 0.3) {
        if (this._tryMove(x, y, x + secondaryDir, y - 1)) return
      }
    } else if (leftEmpty && this._canMoveToRegion(x - 1, y - 1, myColor)) {
      if (x > this._centerX || this._next() < diagonalChance) {
        if (this._tryMove(x, y, x - 1, y - 1)) return
      }
    } else if (rightEmpty && this._canMoveToRegion(x + 1, y - 1, myColor)) {
      if (x < this._centerX || this._next() < diagonalChance) {
        if (this._tryMove(x, y, x + 1, y - 1)) return
      }
    }
    this._tryMove(x, y, x, y - 1)
  }

  _canMoveToRegion(targetX, targetY, myColor) {
    const colorBelow = this._getColorTypeAtPos(targetX, targetY)
    if (colorBelow === NONE || colorBelow === myColor) return true
    // NextRand ONLY when target is a different non-None color
    return this._next() < this._config.bleedModifier
  }

  _stabilizePeak() {
    const startY = Math.floor(this._height * this._simFlatTopRatio)
    const endY =
      this._maxSandHeight < this._height - 1 ? this._maxSandHeight : this._height - 1
    const instability =
      this._config.peakInstabilityFactor * this._config.peakSpillSpeedMultiplier
    for (let y = startY; y <= endY; y++) {
      const rowBase = y * this._width
      for (let x = 0; x < this._width; x++) {
        const index = rowBase + x
        // NextRand called for EVERY non-empty cell here
        if (this._grid[index] === 0 || this._next() >= instability) continue
        if (this._isEmpty(x - 1, y - 1) && this._tryMove(x, y, x - 1, y - 1)) continue
        if (this._isEmpty(x + 1, y - 1) && this._tryMove(x, y, x + 1, y - 1)) continue
        this._tryMove(x, y, x, y - 1)
      }
    }
  }
}
