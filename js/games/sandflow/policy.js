// The dashboard's eager player choice (port of the oracle's ChooseBucket): the colour with the most sand in reach first,
// then the cart nearest the belt. Drives attract mode and the tests.
export function chooseEager(avail, sand) {
  const priority = sand.getSortedColorPriorityList(), rank = new Map(priority.map((ct, i) => [ct, i]));
  const r = c => rank.has(c.colorType) ? rank.get(c.colorType) : Infinity;
  let best = null;
  for (const c of avail) if (!best || r(c) < r(best) || (r(c) === r(best) && (c.index.x < best.index.x || (c.index.x === best.index.x && c.index.y < best.index.y)))) best = c;
  return best;
}
