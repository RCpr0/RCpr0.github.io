/**
 * Simulation constants — verbatim values from the Unity config assets.
 *
 * SAND_CFG  ← SandSimulationConfig.asset   (cellular-automaton physics)
 * BELT_CFG  ← ConveyorBeltAnimationConfig.asset + headless runner belt wiring
 *
 * Do NOT round or alter these values.  They must be bit-identical to the C# side.
 */

// from SandSimulationConfig.asset
export const SAND_CFG = {
  textureWidth: 128,
  textureHeight: 128,
  alphaThreshold: 10,
  colorVariance: 15,
  simulateSteps: 7,
  suctionWidthSpeed: 2,
  suctionHeightSpeed: 1,
  bucketGridWidth: 5,           // fallback suction width when a level omits it
  bucketGridHeight: 6,          // fallback suction height
  lastPositionSuctionEnabled: true,
  frameRateForSandRemoval: 2,
  anchorWidth: 0.65,            // re-synced 2026-06-10 to SandSimulationConfig.asset (was 0.5)
  centerFlowChance: 0.1,        // was 0.45
  edgeFlowChance: 0.9,
  cohesionStrength: 0.3,        // was 0.2
  peakSpillFactor: 0,           // was 0.9
  wallSlipperFactor: 0,         // was 15
  diamondTaper: 4,              // was 5
  flatTopHeightRatio: 0.9,
  peakInstabilityFactor: 0.1,   // was 0.9
  peakSpillSpeedMultiplier: 4,
  anchorTiltStrength: 1,
  bleedModifier: 0.1,           // C# field is [NonSerialized]; code default 0.1 is authoritative
}

// from ConveyorBeltAnimationConfig.asset + the headless runner's belt wiring
export const BELT_CFG = {
  maxSpots: 5,                  // the headless runner uses MaxSpots = 5
  spotSpeed: 0.1,               // asset SpotSpeed
  levelFailTimeout: 7.5,        // asset LevelFailTimeOut
  sandTextureWidth: 256,        // belt maps GridXPosition = round(PathT * 256)
}
