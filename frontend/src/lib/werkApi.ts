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
  id: number;
  name: string;
  isHuman: boolean;
  color: string;
  coinValue: number;
  eligible: boolean;
  rank: number;
  prizeMinor?: number;
  participantId?: string;
  userId?: string;
}

/** Public config the client reads to render the lobby + build a game. */
export interface WerkConfig {
  enabled: boolean;
  entryStakeMinor: number;
  minStakeMinor: number;
  maxStakeMinor: number;
  totalPlayers: number;
  botCount: number;
  botMaxRealPlayers: number;
  lobbyCountdownSec: number;
  gameDurationSec: number;
  winningMode: WerkMode;
  finalSprintWarningSec: number;
  coinDensityX100: number;
  powerupsEnabled: boolean;
  mazeTheme: WerkMazeTheme;
  payoutMultsX100: number[];
}

/** One real player in the shared round (lobby/spectator listing). */
export interface WerkRoundPlayer {
  participantId: string;
  userId: string;
  seat: number;
  name: string;
  color: string;
}

/** The current shared round — everything needed to build the maze + know your seat. */
export interface WerkRoundView {
  id: string;
  status: 'lobby' | 'running' | 'settling' | 'completed' | 'cancelled' | 'none';
  seed: number;
  mode: WerkMode;
  durationSec: number;
  coinDensityX100: number;
  finalSprintWarningSec: number;
  powerupsEnabled: boolean;
  maxPlayers: number;
  botCount: number;
  botsEnabled: boolean;
  bots: WerkBot[];
  timeLeft: number;
  countdown: number | null;
  playerCount: number;
  players: WerkRoundPlayer[];
  yourParticipantId: string | null;
  yourSeat: number | null;
  standings: WerkStanding[];
  mazeTheme?: WerkMazeTheme;
}

/** One participant in a high-frequency authoritative snapshot. */
export interface WerkSnapshotPlayer {
  id: number;
  seat?: number;
  name: string;
  color: string;
  isBot: boolean;
  x: number;
  y: number;
  coinValue: number;
  stamina?: number;
  boost?: boolean;
  magnet?: boolean;
}

export interface WerkSnapshot {
  t: number;
  status: string;
  timeLeft: number;
  players: WerkSnapshotPlayer[];
  taken: number[];
  powerupsTaken: number[];
}

/** Per-tick player input sent up over the socket. */
export interface WerkInputMsg {
  moveX: number;
  moveY: number;
  sprint: boolean;
  usePower?: boolean;
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
  botMaxRealPlayers: number;
  lobbyCountdownSec: number;
  resultDisplaySec: number;
  payoutRank1MultX100: number;
  payoutRank2MultX100: number;
  payoutRank3MultX100: number;
  payoutRank4MultX100: number;
  payoutRank5MultX100: number;
  winControlEnabled: boolean;
  houseGuaranteedBelowPlayers: number;
  botForcedWinEveryNRounds: number;
  winControlCounter: number;
  onboardingWinControlEnabled: boolean;
  onboardingBotWinGames: number;
  onboardingUserWinGames: number;
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
  'botCount', 'botMaxRealPlayers', 'lobbyCountdownSec', 'resultDisplaySec',
  'botSeedMode', 'botSpeedPct', 'botSkillPct', 'botPersonalities',
  'gameDurationSec', 'winningMode', 'finalSprintWarningSec', 'coinDensityX100',
  'powerupsEnabled', 'mazeTheme', 'payoutRank1MultX100', 'payoutRank2MultX100',
  'payoutRank3MultX100', 'payoutRank4MultX100', 'payoutRank5MultX100',
  'winControlEnabled', 'houseGuaranteedBelowPlayers', 'botForcedWinEveryNRounds',
  'onboardingWinControlEnabled', 'onboardingBotWinGames', 'onboardingUserWinGames',
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
  /** The round to show right now (lobby / running to spectate / results). */
  getCurrent: () => api.get<WerkRoundView>('/werk/current').then((r) => r.data),
  /** Join the open lobby round; debits the entry stake. */
  join: (stakeMinor?: number) =>
    api.post<WerkRoundView>('/werk/join', stakeMinor != null ? { stakeMinor } : {}).then((r) => r.data),
  /** Leave the current round (refunds only while still in the lobby). */
  leave: () => api.post<{ left: true }>('/werk/leave', {}).then((r) => r.data),
};
