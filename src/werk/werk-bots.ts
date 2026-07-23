import {
  ALL_WERK_PERSONALITIES,
  WerkBotPersonality,
  WerkBotSeedMode,
} from './entities/werk-config.entity';

/**
 * A single server-authoritative bot handed to the client. The client renders +
 * animates exactly this; it no longer invents names, personalities, colours, or
 * speeds. Reproducible from the game seed + the DB pool, so a session's roster
 * can be re-derived for audit.
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

/** One candidate bot from the admin-managed DB pool (identity + optional overrides). */
export interface WerkBotPoolEntry {
  name: string;
  nameEn: string;
  color: string;
  personality: WerkBotPersonality;
  /** % of human speed; null → use config base + jitter. */
  speedPct: number | null;
  /** 0–100 skill; null → use config base + jitter. */
  skillPct: number | null;
}

/** Default Amharic name pool (name, latin transliteration) — used to SEED the DB. */
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

/**
 * The default bot roster used to seed an empty `werk_bot` table on first boot, so
 * the game works out of the box and the historical identities are preserved.
 * Personalities are spread round-robin over the 5 archetypes for variety; speed
 * and skill are left null so they follow the admin's global config.
 */
export const DEFAULT_WERK_BOTS: WerkBotPoolEntry[] = NAMES.map(([name, nameEn], i) => ({
  name,
  nameEn,
  color: COLORS[i % COLORS.length],
  personality: ALL_WERK_PERSONALITIES[i % ALL_WERK_PERSONALITIES.length],
  speedPct: null,
  skillPct: null,
}));

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
 * Build the deterministic bot roster for a game by drawing `count` bots from the
 * admin-managed DB `pool`. Uses a seed derived from the game seed (so it doesn't
 * perturb the client's maze/coin PRNG stream). Each bot keeps its intrinsic
 * identity + personality; speed/skill come from the bot's own override when set,
 * otherwise the admin's global base (`botSpeedPct`/`botSkillPct`) plus a small
 * deterministic jitter. If more bots are needed than the pool holds, the shuffled
 * pool is cycled.
 */
export function buildBotRoster(
  seed: number,
  count: number,
  cfg: {
    botSeedMode: WerkBotSeedMode;
    botSpeedPct: number;
    botSkillPct: number;
  },
  pool: WerkBotPoolEntry[],
): WerkBotDescriptor[] {
  if (cfg.botSeedMode === 'zero' || count <= 0 || pool.length === 0) return [];

  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const baseSpeed = clamp(cfg.botSpeedPct, 30, 100);
  const baseSkill = clamp(cfg.botSkillPct, 0, 100) / 100;

  // Deterministic shuffle of the DB pool so rosters vary between games.
  const bots = [...pool];
  for (let i = bots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bots[i], bots[j]] = [bots[j], bots[i]];
  }

  const roster: WerkBotDescriptor[] = [];
  for (let i = 0; i < count; i++) {
    const b = bots[i % bots.length];
    const speedPct =
      b.speedPct != null
        ? Math.round(clamp(b.speedPct, 30, 100))
        : Math.round(clamp(baseSpeed + (rng() - 0.5) * 10, 30, 100));
    const skill =
      b.skillPct != null
        ? +clamp(b.skillPct / 100, 0, 1).toFixed(3)
        : +clamp(baseSkill + (rng() - 0.5) * 0.2, 0, 1).toFixed(3);
    roster.push({
      name: b.name,
      nameEn: b.nameEn,
      color: b.color,
      personality: b.personality,
      speedPct,
      skill,
    });
  }
  return roster;
}
