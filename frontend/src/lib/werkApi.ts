import api from './api';

export type WerkMode = 'A' | 'B';
export type WerkMazeTheme = 'adwa' | 'highland' | 'desert';

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
  humanRank: number | null;
  prizeMinor: number;
}

export interface WerkSettleInput {
  rank: number;
  tieCount: number;
  coinValue: number;
  eliminated?: boolean;
}

export const werkApi = {
  getConfig: () => api.get<WerkConfig>('/werk/config').then((r) => r.data),
  start: (stakeMinor?: number) =>
    api.post<WerkSessionView>('/werk/start', stakeMinor != null ? { stakeMinor } : {}).then((r) => r.data),
  getSession: (id: string) => api.get<WerkSessionView>(`/werk/${id}`).then((r) => r.data),
  settle: (id: string, input: WerkSettleInput) =>
    api.post<WerkSessionView>(`/werk/${id}/settle`, input).then((r) => r.data),
  abort: (id: string) => api.post<WerkSessionView>(`/werk/${id}/abort`, {}).then((r) => r.data),
};
