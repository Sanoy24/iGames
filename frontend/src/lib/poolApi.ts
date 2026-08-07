import api from './api';
import type { Ball, ShotInput } from '@pool-engine';
import type { PoolPhysicsSnapshot } from '@pool-physics';

export type Seat = 'A' | 'B';
export type PoolMode = 'single' | 'two_player' | 'tournament';
export type PoolPhase = 'break' | 'play' | 'gameover';
export type PoolGroup = 'solids' | 'stripes';

/** Client-facing match projection  mirrors PoolMatchService.buildView. */
export interface PoolMatchView {
    id: string;
    mode: PoolMode;
    status: 'active' | 'completed' | 'aborted';
    seatAUserId: string | null;
    seatBUserId: string | null;
    /** Display (Telegram) names captured at creation; null for a bot/legacy seat. */
    seatAName: string | null;
    seatBName: string | null;
    stakeMinor: number;
    turn: Seat;
    groups: { A: PoolGroup | null; B: PoolGroup | null };
    tableOpen: boolean;
    ballInHand: boolean;
    phase: PoolPhase;
    winnerSeat: Seat | null;
    board: Ball[];
    shotCount: number;
    turnDeadline: string | null;
    tournamentId: string | null;
    physics: PoolPhysicsSnapshot | null;
}

export interface PoolShotOutcome {
    pocketed: number[];
    fouls: string[];
    turnPassed: boolean;
    assignedGroups: boolean;
    gameOver: boolean;
    winner: Seat | null;
    reason: string;
    state: {
        balls: Ball[];
        turn: Seat;
        groups: { A: PoolGroup | null; B: PoolGroup | null };
        tableOpen: boolean;
        ballInHand: boolean;
        phase: PoolPhase;
        winner: Seat | null;
    };
}

export type JoinResult =
    | { matched: true; match: PoolMatchView }
    | { matched: false; queued: true; stakeMinor: number };

export interface PoolConfig {
    singlePlayerEnabled: boolean;
    singlePlayerStakeMinor: number;
    botDifficulty: 'easy' | 'medium' | 'hard';
    twoPlayerEnabled: boolean;
    minStakeMinor: number;
    maxStakeMinor: number;
    rakePct: number;
    shotClockSeconds: number;
    tournamentEnabled: boolean;
    tournamentEntryFeeMinor: number;
    tournamentSize: number;
    tournamentRakePct: number;
    strictCallShot: boolean;
}

export interface PoolTournament {
    id: string;
    name: string;
    status: 'registering' | 'active' | 'completed' | 'cancelled';
    size: number;
    rounds: number;
    entryFeeMinor: number;
    rakePct: number;
    prizePoolMinor: number;
    winnerUserId: string | null;
}

/**
 * Predefined quick-chat emotes. Only the ID travels over the socket  each client
 * localizes it via `t('pool.chat.<id>')`, so every player reads the message in
 * their OWN chosen language. Grouped for the picker; the flat list is the
 * server-side whitelist (keep the backend gateway's set in sync with these ids).
 */
export const POOL_EMOTES = {
    taunts: [
        'tooEasy',
        'bestShot',
        'watchLearn',
        'warmingUp',
        'luckNextTime',
        'feelingLucky',
    ],
    friendly: [
        'niceShot',
        'wellPlayed',
        'gg',
        'respect',
        'rematch',
        'goodLuck',
    ],
} as const;
export const POOL_EMOTE_IDS: string[] = [
    ...POOL_EMOTES.taunts,
    ...POOL_EMOTES.friendly,
];

export const poolApi = {
    getConfig: () => api.get<PoolConfig>('/pool/config').then((r) => r.data),
    startSingle: () =>
        api.post<PoolMatchView>('/pool/single').then((r) => r.data),
    joinQueue: (stakeMinor: number) =>
        api.post<JoinResult>('/pool/queue', { stakeMinor }).then((r) => r.data),
    leaveQueue: () =>
        api.delete<{ removed: boolean }>('/pool/queue').then((r) => r.data),
    queueStatus: () =>
        api
            .get<{ queued: boolean; stakeMinor: number | null }>('/pool/queue')
            .then((r) => r.data),
    getMatch: (id: string) =>
        api.get<PoolMatchView>(`/pool/matches/${id}`).then((r) => r.data),
    submitShot: (id: string, input: ShotInput) =>
        api
            .post<PoolShotOutcome>(`/pool/matches/${id}/shots`, input)
            .then((r) => r.data),
    getTournament: (id: string) =>
        api.get<PoolTournament>(`/pool/tournaments/${id}`).then((r) => r.data),
    getTournamentMatches: (id: string) =>
        api
            .get<PoolMatchView[]>(`/pool/tournaments/${id}/matches`)
            .then((r) => r.data),
    registerTournament: (id: string) =>
        api
            .post<PoolTournament>(`/pool/tournaments/${id}/register`)
            .then((r) => r.data),
};
