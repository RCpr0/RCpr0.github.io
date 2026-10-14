/**
 * Xorshift32 RNG — bit-exact port of SimSandSimulation.cs
 *
 * C# original:
 *   SetSeed(uint seed)  => _rngState = seed | 1u
 *   NextRand()          => three xor-shift steps, return (state & 0xFFFFFF) / 16777216f
 *
 * All arithmetic is kept in uint32 range via >>> 0.
 */
export function makeRng(seed) {
  let s = (seed | 1) >>> 0          // SetSeed: seed | 1, kept uint32

  return function next() {
    s = (s ^ (s << 13)) >>> 0
    s = (s ^ (s >>> 17)) >>> 0      // >>> = logical (unsigned) shift, matches C# uint >>
    s = (s ^ (s << 5)) >>> 0
    return (s & 0xFFFFFF) * (1 / 16777216)
  }
}
