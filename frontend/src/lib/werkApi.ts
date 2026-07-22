import api from './api';

export type WerkMode = 'A' | 'B';
export type WerkMazeTheme = 'adwa' | 'highland' | 'desert';
export type WerkBotSeedMode = 'auto' | 'zero' | 'custom';
export type WerkBotPersonality = 'gatherer' | 'sniper' | 'strategist' | 'explorer' | 'chaotic';

/** A server-generated bot the client renders + animates verbatim. */
export interface WerkBot {
  name: string;
  nameEn: string;
  color: string;
  personality: WerkBotPersonality;
  speedPct: number;
  skill: number;
}

/** One row of the authoritative final standings returned on settle. */
export interface WerkStanding {
  id: number; // 0 = human
  name: string;
  isHuman: boolean;
  color: string;
  coinValue: number;
  eligible: boolean;
  rank: number;
}

/** Public config the client reads to render the lobby + build a game. */
export interface WerkConfig {
  enabled: boolean;
  entryStakeMinor: number;
  minStakeMinor: number;
  maxStakeMinor: number;
  totalPlayers: number;
  botCount: number;
  gameDurationSec: number;
  winningMode: WerkMode;
  finalSprintWarningSec: number;
  coinDensityX100: number;
  powerupsEnabled: boolean;
  mazeTheme: WerkMazeTheme;
  payoutMultsX100: number[];
}

/** A started game — everything needed to deterministically build the maze. */
export interface WerkSessionView {
  id: string;
  status: 'active' | 'settled' | 'aborted';
  seed: number;
  stakeMinor: number;
  mode: WerkMode;
  durationSec: number;
  totalPlayers: number;
  botCount: number;
  coinDensityX100: number;
  finalSprintWarningSec: number;
  powerupsEnabled: boolean;
  mazeTheme: WerkMazeTheme;
  payoutMultsX100: number[];
  bots: WerkBot[];
  humanRank: number | null;
  prizeMinor: number;
  standings: WerkStanding[];
}

export interface WerkSettleInput {
  collectedCoinIndices: number[];
  reachedCenter?: boolean;
}

/** Full admin config row (all editable fields). */
export interface AdminWerkConfig {
  key: string;
  enabled: boolean;
  entryStakeMinor: number;
  minStakeMinor: number;
  maxStakeMinor: number;
  totalPlayers: number;
  botCount: number;
  botSeedMode: WerkBotSeedMode;
  botSpeedPct: number;
  botSkillPct: number;
  botPersonalities: WerkBotPersonality[] | null;
  gameDurationSec: number;
  winningMode: WerkMode;
  finalSprintWarningSec: number;
  coinDensityX100: number;
  powerupsEnabled: boolean;
  mazeTheme: WerkMazeTheme;
  payoutRank1MultX100: number;
  payoutRank2MultX100: number;
  payoutRank3MultX100: number;
  payoutRank4MultX100: number;
  payoutRank5MultX100: number;
  winControlEnabled: boolean;
  houseGuaranteedBelowPlayers: number;
  botForcedWinEveryNRounds: number;
  winControlCounter: number;
}

/** An admin-managed house bot row (the DB pool rosters are drawn from). */
export interface AdminWerkBot {
  id: number;
  name: string;
  nameEn: string;
  color: string;
  personality: WerkBotPersonality;
  speedPct: number | null;
  skillPct: number | null;
  enabled: boolean;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateWerkBotInput = {
  name: string;
  nameEn: string;
  color?: string;
  personality?: WerkBotPersonality;
  speedPct?: number | null;
  skillPct?: number | null;
  enabled?: boolean;
  sortOrder?: number;
};

// Fields the admin can actually edit (mirrors the backend UpdateWerkConfigDto).
// Everything else on a loaded row — `key`, `winControlCounter`, and the ORM's
// `createdAt`/`updatedAt`/`updatedBy` — is server-managed; the backend runs a
// whitelist pipe and rejects any unknown property, so we send ONLY these keys.
const WERK_CONFIG_EDITABLE_KEYS = [
  'enabled', 'entryStakeMinor', 'minStakeMinor', 'maxStakeMinor', 'totalPlayers',
  'botCount', 'botSeedMode', 'botSpeedPct', 'botSkillPct', 'botPersonalities',
  'gameDurationSec', 'winningMode', 'finalSprintWarningSec', 'coinDensityX100',
  'powerupsEnabled', 'mazeTheme', 'payoutRank1MultX100', 'payoutRank2MultX100',
  'payoutRank3MultX100', 'payoutRank4MultX100', 'payoutRank5MultX100',
  'winControlEnabled', 'houseGuaranteedBelowPlayers', 'botForcedWinEveryNRounds',
] as const satisfies readonly (keyof AdminWerkConfig)[];

/** Keep only editable, non-null fields so the whitelist pipe never rejects. */
function cleanWerkConfig(dto: Partial<AdminWerkConfig>): Partial<AdminWerkConfig> {
  const out: Partial<AdminWerkConfig> = {};
  for (const k of WERK_CONFIG_EDITABLE_KEYS) {
    if (dto[k] != null) (out as Record<string, unknown>)[k] = dto[k];
  }
  return out;
}

export const adminWerkApi = {
  getConfig: () => api.get<AdminWerkConfig>('/admin/werk/config').then((r) => r.data),
  updateConfig: (dto: Partial<AdminWerkConfig>) =>
    api.patch<AdminWerkConfig>('/admin/werk/config', cleanWerkConfig(dto)).then((r) => r.data),
  // Bot pool management.
  listBots: () => api.get<AdminWerkBot[]>('/admin/werk/bots').then((r) => r.data),
  createBot: (dto: CreateWerkBotInput) =>
    api.post<AdminWerkBot>('/admin/werk/bots', dto).then((r) => r.data),
  updateBot: (id: number, dto: Partial<CreateWerkBotInput>) =>
    api.patch<AdminWerkBot>(`/admin/werk/bots/${id}`, dto).then((r) => r.data),
  deleteBot: (id: number) => api.delete<{ deleted: true }>(`/admin/werk/bots/${id}`).then((r) => r.data),
};

export const werkApi = {
  getConfig: () => api.get<WerkConfig>('/werk/config').then((r) => r.data),
  start: (stakeMinor?: number) =>
    api.post<WerkSessionView>('/werk/start', stakeMinor != null ? { stakeMinor } : {}).then((r) => r.data),
  getSession: (id: string) => api.get<WerkSessionView>(`/werk/${id}`).then((r) => r.data),
  settle: (id: string, input: WerkSettleInput) =>
    api.post<WerkSessionView>(`/werk/${id}/settle`, input).then((r) => r.data),
  abort: (id: string) => api.post<WerkSessionView>(`/werk/${id}/abort`, {}).then((r) => r.data),
};
