import {
  ALL_WERK_PERSONALITIES,
  WerkBotPersonality,
  WerkBotSeedMode,
} from './entities/werk-config.entity';

/**
 * A single server-authoritative bot. The client renders + animates exactly this;
 * it no longer invents names, personalities, colours, or speeds. Reproducible
 * from the game seed, so a session's roster can be re-derived for audit.
 */
export interface WerkBotDescriptor {
  name: string; // Amharic display name
  nameEn: string;
  color: string;
  personality: WerkBotPersonality;
  /** Base speed as a percentage of the human's speed. */
  speedPct: number;
  /** 0..1 decision quality — think cadence, target optimality, noise. */
  skill: number;
}

/** Amharic name pool (name, latin transliteration). */
const NAMES: Array<[string, string]> = [
  ['አበበ', 'Abebe'], ['ከበደ', 'Kebede'], ['ጫላ', 'Chala'], ['ሳምሶን', 'Samson'],
  ['ብርሃኑ', 'Birhanu'], ['ተስፋዬ', 'Tesfaye'], ['ዳዊት', 'Dawit'], ['ሰለሞን', 'Solomon'],
  ['ፍቅሬ', 'Fikru'], ['ሙሉ', 'Mulu'], ['አልማዝ', 'Almaz'], ['ሰናይት', 'Senait'],
  ['ሄለን', 'Helen'], ['ሳራ', 'Sara'], ['ማርታ', 'Marta'], ['ሮዛ', 'Roza'],
  ['ዮሐንስ', 'Yohannes'], ['ግርማ', 'Girma'], ['ታደሰ', 'Tadesse'], ['በቀለ', 'Bekele'],
  ['ሀና', 'Hana'], ['ናርዶስ', 'Nardos'], ['ኤፍሬም', 'Efrem'], ['ሚካኤል', 'Mikael'],
  ['ዘነበ', 'Zenebe'], ['ጌታቸው', 'Getachew'], ['ወርቁ', 'Werku'], ['ደሳለኝ', 'Desalegn'],
];

const COLORS = [
  '#e6b422', '#4ade80', '#60a5fa', '#f87171', '#c084fc', '#fb923c', '#34d399',
  '#f472b6', '#a3e635', '#22d3ee', '#facc15', '#818cf8', '#fb7185', '#2dd4bf',
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deterministic PRNG (mulberry32) — identical algorithm to the client engine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the deterministic bot roster for a game. Uses a seed derived from the
 * game seed (so it doesn't perturb the client's maze/coin PRNG stream) plus the
 * admin-set mode, difficulty, and personality pool.
 */
export function buildBotRoster(
  seed: number,
  count: number,
  cfg: {
    botSeedMode: WerkBotSeedMode;
    botSpeedPct: number;
    botSkillPct: number;
    botPersonalities: WerkBotPersonality[] | null;
  },
): WerkBotDescriptor[] {
  if (cfg.botSeedMode === 'zero' || count <= 0) return [];

  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const pool = (cfg.botPersonalities && cfg.botPersonalities.length ? cfg.botPersonalities : ALL_WERK_PERSONALITIES);
  // Admin-set base speed/skill with a small deterministic per-bot jitter so a
  // roster feels varied without any hardcoded difficulty bands.
  const baseSpeed = clamp(cfg.botSpeedPct, 30, 100);
  const baseSkill = clamp(cfg.botSkillPct, 0, 100) / 100;

  // Deterministic shuffle of names + colours so rosters vary between games.
  const names = [...NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  const roster: WerkBotDescriptor[] = [];
  for (let i = 0; i < count; i++) {
    const [name, nameEn] = names[i % names.length];
    const personality: WerkBotPersonality =
      cfg.botSeedMode === 'custom' ? pool[i % pool.length] : pool[Math.floor(rng() * pool.length)];
    const speedPct = Math.round(clamp(baseSpeed + (rng() - 0.5) * 10, 30, 100));
    const skill = +clamp(baseSkill + (rng() - 0.5) * 0.2, 0, 1).toFixed(3);
    roster.push({
      name, nameEn,
      color: COLORS[(i + 1) % COLORS.length],
      personality, speedPct, skill,
    });
  }
  return roster;
}
