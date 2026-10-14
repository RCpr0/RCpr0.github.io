/**
 * belt.js — faithful JS port of Unity C# SimConveyorBelt.
 *
 * FAITHFULNESS RULES:
 *  1. Two passes per tick: pass 1 advances ALL pathT+gridXPosition; pass 2 suctions.
 *  2. Result precedence: SandRemoved overrides BucketFilled; LevelFailed and
 *     LevelComplete are early returns (in that order) after the override.
 *  3. Timer resets to 0 on tryAddBucket and whenever any sand is removed;
 *     accumulates otherwise. Fail only when isAtCapacity && timer >= levelFailTimeout.
 *  4. Full buckets collected into toRemove during suction pass; removed after.
 *  5. gridXPosition = roundHalfToEven(pathT * sandTextureWidth) — banker's rounding.
 *
 * NOTE: BucketFilled-as-return is faithfully-ported dead code. Any tick that fills
 * a bucket also removed sand (collectSand is only called when removed > 0), so
 * SandRemoved always overrides BucketFilled. The code branch is preserved for
 * faithfulness; the return value will always be SandRemoved in practice.
 */
import { roundHalfToEven } from './sandSim.js'

// ---------------------------------------------------------------------------
// Result enum (string values for debuggability)
// ---------------------------------------------------------------------------
export const SimConveyorResult = {
  None: 'None',
  BucketFilled: 'BucketFilled',
  LevelFailed: 'LevelFailed',
  LevelComplete: 'LevelComplete',
  SandRemoved: 'SandRemoved',
}

// ---------------------------------------------------------------------------
// Bucket factory
// ---------------------------------------------------------------------------
/**
 * makeBucket — equivalent to the C# SimBucket ctor.
 * @param {object} gridIndex  — { x, y } grid position
 * @param {number} colorType  — ColorType int
 * @param {number} totalCapacity — max sand this bucket holds
 * @returns a mutable bucket object
 */
export function makeBucket(gridIndex, colorType, totalCapacity) {
  return {
    gridIndex,
    colorType,
    totalCapacity,
    capacity: 0,      // sand collected so far
    pathT: 0,         // normalised position on belt [0, 1)
    gridXPosition: 0, // mapped to sand texture X
    get isFull() {
      return this.capacity >= this.totalCapacity
    },
    collectSand(amount = 1) {
      if (this.isFull) return
      this.capacity += amount
    },
  }
}

// ---------------------------------------------------------------------------
// ConveyorBelt
// ---------------------------------------------------------------------------
export class ConveyorBelt {
  /**
   * @param {object} cfg  — BELT_CFG-shaped: { maxSpots, spotSpeed, levelFailTimeout, sandTextureWidth }
   * @param {object} sand — SandSim or stub with removeSandForBucket(x,ct,remaining)->int and isAllSandRemoved getter
   */
  constructor(cfg, sand) {
    this._cfg = cfg
    this._sand = sand

    this._spots = []                  // List<SimBucket>
    this._timeSinceLastSandRemoved = 0
    this._isFailed = false
    this._isComplete = false

    // Optional callback hooks (settable by caller; invoked like C# Action?.Invoke())
    this.onBucketFilled = null
    this.onLevelFailed = null
    this.onLevelComplete = null
  }

  // ---- getters (mirror C# properties) ----

  get freeSpots() {
    return this._cfg.maxSpots - this._spots.length
  }

  get hasFreeSpot() {
    return this.freeSpots > 0
  }

  get occupiedSpots() {
    return this._spots.length
  }

  get isAtCapacity() {
    return this._spots.length >= this._cfg.maxSpots
  }

  /** Equivalent to IReadOnlyList<SimBucket> ActiveBuckets */
  get activeBuckets() {
    return this._spots
  }

  // ---- tryAddBucket ----

  /**
   * Exact port of C# TryAddBucket.
   * pathT = spots.length > 0 ? (max(s.pathT) + 1/maxSpots) % 1 : 0
   * Resets the fail timer.
   * @param {object} bucket — makeBucket() result
   * @returns {boolean}
   */
  tryAddBucket(bucket) {
    if (!this.hasFreeSpot) return false

    if (this._spots.length > 0) {
      let maxPathT = -Infinity
      for (const s of this._spots) {
        if (s.pathT > maxPathT) maxPathT = s.pathT
      }
      bucket.pathT = (maxPathT + 1 / this._cfg.maxSpots) % 1
    } else {
      bucket.pathT = 0
    }

    this._spots.push(bucket)
    this._timeSinceLastSandRemoved = 0
    return true
  }

  // ---- tick ----

  /**
   * Exact port of C# Tick(deltaTime).
   * @param {number} deltaTime — seconds elapsed
   * @returns {string} SimConveyorResult value
   */
  tick(deltaTime) {
    if (this._isFailed || this._isComplete) return SimConveyorResult.None

    const { spotSpeed, sandTextureWidth, levelFailTimeout } = this._cfg
    let result = SimConveyorResult.None

    // ---- PASS 1: advance all pathT and gridXPosition ----
    for (const bucket of this._spots) {
      bucket.pathT = (bucket.pathT + spotSpeed * deltaTime) % 1
      bucket.gridXPosition = roundHalfToEven(bucket.pathT * sandTextureWidth)
    }

    // ---- PASS 2: suction ----
    let anySandRemoved = false
    const toRemove = []

    for (const bucket of this._spots) {
      if (bucket.isFull) continue

      const remaining = bucket.totalCapacity - bucket.capacity
      const removed = this._sand.removeSandForBucket(
        bucket.gridXPosition,
        bucket.colorType,
        remaining,
      )

      if (removed > 0) {
        anySandRemoved = true
        bucket.collectSand(removed)
      }

      if (bucket.isFull) {
        toRemove.push(bucket)
      }
    }

    // Remove filled buckets and fire callbacks
    for (const bucket of toRemove) {
      const idx = this._spots.indexOf(bucket)
      if (idx !== -1) this._spots.splice(idx, 1)
      if (this.onBucketFilled) this.onBucketFilled(bucket)
      result = SimConveyorResult.BucketFilled
    }

    // ---- Result precedence ----
    if (anySandRemoved) {
      // SandRemoved OVERRIDES BucketFilled
      this._timeSinceLastSandRemoved = 0
      result = SimConveyorResult.SandRemoved
    } else {
      this._timeSinceLastSandRemoved += deltaTime
    }

    // ---- Early return: LevelFailed ----
    if (this.isAtCapacity && this._timeSinceLastSandRemoved >= levelFailTimeout) {
      this._isFailed = true
      if (this.onLevelFailed) this.onLevelFailed()
      return SimConveyorResult.LevelFailed
    }

    // ---- Early return: LevelComplete ----
    if (this._sand.isAllSandRemoved && this.occupiedSpots === 0) {
      this._isComplete = true
      if (this.onLevelComplete) this.onLevelComplete()
      return SimConveyorResult.LevelComplete
    }

    return result
  }
}
