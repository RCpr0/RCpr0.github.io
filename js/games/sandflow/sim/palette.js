// Master color palette — a keep-in-sync copy of the game's ColorConfig.asset (24 colors).
// Source of truth: SandFlow Assets/Features/Gameplay/Scripts/ColorConfig.asset.
// Captured in Phase 1; verified exact by the parity tests. Used for client-side image -> ColorType
// nearest-color mapping (mapPixelsToColorTypes) without a server round-trip.
export const PALETTE = [
  { ct: 1,  ctName: 'Lavender',    r: 217, g: 144, b: 255 },
  { ct: 2,  ctName: 'Red',         r: 255, g:  72, b:  72 },
  { ct: 3,  ctName: 'Yellow',      r: 255, g: 255, b:  81 },
  { ct: 4,  ctName: 'BrickRed',    r: 174, g:  42, b:  65 },
  { ct: 5,  ctName: 'Orange',      r: 244, g: 109, b:  49 },
  { ct: 7,  ctName: 'Aqua',        r: 109, g: 255, b: 255 },
  { ct: 8,  ctName: 'Blue',        r:  53, g: 130, b: 255 },
  { ct: 9,  ctName: 'Brown',       r: 195, g: 103, b:  20 },
  { ct: 10, ctName: 'White',       r: 255, g: 255, b: 255 },
  { ct: 11, ctName: 'Green',       r: 130, g: 255, b: 106 },
  { ct: 12, ctName: 'DarkGreen',   r:   4, g: 145, b:   6 },
  { ct: 13, ctName: 'Cream',       r: 255, g: 255, b: 178 },
  { ct: 16, ctName: 'Purple',      r: 144, g:  31, b: 248 },
  { ct: 17, ctName: 'Pink',        r: 255, g: 125, b: 215 },
  { ct: 18, ctName: 'DarkPurple',  r: 230, g:  86, b: 255 },
  { ct: 19, ctName: 'NeonPink',    r: 213, g:  59, b: 156 },
  { ct: 20, ctName: 'Teal',        r: 199, g: 255, b: 186 },
  { ct: 21, ctName: 'Emerald',     r:   0, g: 184, b: 141 },
  { ct: 22, ctName: 'DenimBlue',   r:  73, g: 143, b: 183 },
  { ct: 23, ctName: 'LightPurple', r: 169, g: 148, b: 245 },
  { ct: 24, ctName: 'LightYellow', r: 250, g: 212, b: 130 },
  { ct: 25, ctName: 'DarkBrown',   r: 115, g:  49, b:  14 },
  { ct: 26, ctName: 'BlueGray',    r:  57, g:  61, b:  98 },
  { ct: 27, ctName: 'Golden',      r: 255, g: 200, b:   3 },
]

export const NAME_BY_CT = Object.fromEntries(PALETTE.map((e) => [e.ct, e.ctName]))
export const CT_BY_NAME = Object.fromEntries(PALETTE.map((e) => [e.ctName, e.ct]))
