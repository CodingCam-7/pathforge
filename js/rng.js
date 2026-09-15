// Seeded PRNG so every map is reproducible from a string seed.

/** FNV-1a hash: turns any string into a 32-bit seed. */
export function hashSeed(input) {
  let h = 2166136261;
  for (const ch of String(input)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 generator with a few convenience helpers. */
export function createRng(seed) {
  let a = hashSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Integer in [min, max], inclusive. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

const ADJECTIVES = ['amber', 'ashen', 'broken', 'cobalt', 'drowned', 'feral', 'gilded', 'hollow', 'iron', 'lunar',
  'molten', 'neon', 'obsidian', 'pale', 'rusted', 'silent', 'sunken', 'toxic', 'velvet', 'wired'];
const NOUNS = ['atrium', 'bastion', 'catacomb', 'cistern', 'citadel', 'crypt', 'depot', 'foundry', 'grotto', 'hive',
  'keep', 'labyrinth', 'maw', 'nexus', 'reactor', 'sanctum', 'spire', 'vault', 'warren', 'ziggurat'];

/** Human-friendly random seed, e.g. "rusted-foundry-42". Intentionally not deterministic. */
export function randomSeed() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Math.floor(Math.random() * 90 + 10)}`;
}
