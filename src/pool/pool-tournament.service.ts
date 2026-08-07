import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { RngService } from '../rng/rng.service';
import { PoolService } from './pool.service';
import { PoolMatchService } from './pool-match.service';
import { PoolTournament } from './entities/pool-tournament.entity';
import { PoolTournamentPlayer } from './entities/pool-tournament-player.entity';
import { PoolMatch } from './entities/pool-match.entity';
import { mulberry32 } from './engine/rack';

const log2 = (n: number) => Math.round(Math.log2(n));
const winnerUserIdOf = (m: PoolMatch): string | null =>
    m.winnerSeat === 'A'
        ? m.seatAUserId
        : m.winnerSeat === 'B'
          ? m.seatBUserId
          : null;

@Injectable()
export class PoolTournamentService {
    private readonly logger = new Logger(PoolTournamentService.name);

    constructor(
        @InjectRepository(PoolTournament)
        private readonly tournamentRepo: Repository<PoolTournament>,
        @InjectRepository(PoolTournamentPlayer)
        private readonly playerRepo: Repository<PoolTournamentPlayer>,
        @InjectRepository(PoolMatch)
        private readonly matchRepo: Repository<PoolMatch>,
        private readonly dataSource: DataSource,
        private readonly poolService: PoolService,
        private readonly walletService: WalletService,
        private readonly rngService: RngService,
        @Inject(forwardRef(() => PoolMatchService))
        private readonly matchService: PoolMatchService,
    ) {}

    // ── Setup ──────────────────────────────────────────────────────────────────

    async create(name: string): Promise<PoolTournament> {
        await this.poolService.assertModePlayable('tournament');
        const cfg = await this.poolService.getConfig();
        if (
            (cfg.tournamentSize & (cfg.tournamentSize - 1)) !== 0 ||
            cfg.tournamentSize < 2
        ) {
            throw new BadRequestException(
                'Configured tournamentSize must be a power of two ≥ 2',
            );
        }
        const t = this.tournamentRepo.create({
            name: name?.trim() || 'Pool Tournament',
            status: 'registering',
            size: cfg.tournamentSize,
            rounds: log2(cfg.tournamentSize),
            entryFeeMinor: cfg.tournamentEntryFeeMinor,
            rakePct: cfg.tournamentRakePct,
            prizePoolMinor: 0,
        });
        return this.tournamentRepo.save(t);
    }

    async get(id: string): Promise<PoolTournament> {
        const t = await this.tournamentRepo.findOneBy({ id });
        if (!t) throw new NotFoundException('Tournament not found');
        return t;
    }

    async listPlayers(tournamentId: string): Promise<PoolTournamentPlayer[]> {
        return this.playerRepo.find({
            where: { tournamentId },
            order: { createdAt: 'ASC' },
        });
    }

    async listMatches(tournamentId: string): Promise<PoolMatch[]> {
        return this.matchRepo.find({
            where: { tournamentId },
            order: { tournamentRound: 'ASC', tournamentSlot: 'ASC' },
        });
    }

    // ── Registration ───────────────────────────────────────────────────────────

    /** Register a player, escrowing the entry fee into the prize pool. */
    async register(
        tournamentId: string,
        userId: string,
    ): Promise<PoolTournament> {
        await this.poolService.assertModePlayable('tournament');
        const started = await this.dataSource.transaction(async (manager) => {
            const tRepo = manager.getRepository(PoolTournament);
            const pRepo = manager.getRepository(PoolTournamentPlayer);
            const t = await tRepo.findOne({
                where: { id: tournamentId },
                lock: { mode: 'pessimistic_write' },
            });
            if (!t) throw new NotFoundException('Tournament not found');
            if (t.status !== 'registering')
                throw new ConflictException('Registration is closed');

            const count = await pRepo.count({ where: { tournamentId } });
            if (count >= t.size)
                throw new ConflictException('Tournament is full');
            if (await pRepo.findOneBy({ tournamentId, userId })) {
                throw new ConflictException('Already registered');
            }

            if (t.entryFeeMinor > 0) {
                await this.walletService.ensureDefaultWallet(userId, manager);
                await this.walletService.debitInSession(
                    {
                        userId,
                        amountMinor: t.entryFeeMinor,
                        entryType: 'stake',
                        sourceType: 'pool_tournament',
                        sourceId: t.id,
                        idempotencyKey: `pool-tourney-entry:${t.id}:${userId}`,
                        metadata: { tournamentId: t.id },
                    },
                    manager,
                );
            }
            await pRepo.insert({ tournamentId, userId, eliminated: false });
            await tRepo.update(
                { id: t.id },
                { prizePoolMinor: t.prizePoolMinor + t.entryFeeMinor },
            );
            return count + 1 >= t.size;
        });

        if (started)
            await this.start(tournamentId).catch((e) =>
                this.logger.error(`Auto-start failed: ${e?.message ?? e}`),
            );
        return this.get(tournamentId);
    }

    // ── Bracket ──────────────────────────────────────────────────────────────────

    /** Seed the bracket and create the first round of matches. */
    async start(tournamentId: string): Promise<PoolTournament> {
        const t = await this.get(tournamentId);
        if (t.status !== 'registering')
            throw new ConflictException('Tournament already started');
        const players = await this.listPlayers(tournamentId);
        if (players.length !== t.size) {
            throw new BadRequestException(
                `Need exactly ${t.size} players to start (have ${players.length})`,
            );
        }

        // Randomised seeding via the RNG service (auditable, no Math.random).
        const draw = await this.rngService.drawSeed({
            gameType: 'pool',
            gameReference: t.id,
            metadata: { purpose: 'bracket-seed', size: t.size },
        });
        const rng = mulberry32(draw.numbers[0]);
        const order = players.slice();
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        for (let i = 0; i < order.length; i++) {
            await this.playerRepo.update({ id: order[i].id }, { seedIndex: i });
        }

        await this.tournamentRepo.update(
            { id: t.id, status: 'registering' },
            { status: 'active', startedAt: new Date() },
        );

        for (let slot = 0; slot < t.size / 2; slot++) {
            await this.matchService.createMatch({
                mode: 'tournament',
                seatAUserId: order[slot * 2].userId,
                seatBUserId: order[slot * 2 + 1].userId,
                stakeMinor: 0,
                breaker: slot % 2 === 0 ? 'A' : 'B',
                tournamentId: t.id,
                tournamentRound: 0,
                tournamentSlot: slot,
            });
        }
        return this.get(tournamentId);
    }

    /**
     * Advance the bracket after a tournament match ends. Marks the loser
     * eliminated; when a slot's sibling is also finished, creates the next-round
     * match with both winners; the final match completes the tournament and pays
     * the prize. Duplicate next-round creation is blocked by the unique
     * (tournamentId, round, slot) index.
     */
    async onMatchCompleted(match: PoolMatch): Promise<void> {
        if (
            !match.tournamentId ||
            match.tournamentRound === null ||
            match.tournamentSlot === null
        )
            return;
        const t = await this.tournamentRepo.findOneBy({
            id: match.tournamentId,
        });
        if (!t || t.status !== 'active') return;

        const winnerId = winnerUserIdOf(match);
        const loserId =
            match.winnerSeat === 'A' ? match.seatBUserId : match.seatAUserId;
        if (loserId)
            await this.playerRepo.update(
                { tournamentId: t.id, userId: loserId },
                { eliminated: true },
            );

        // Final round → tournament is over.
        if (match.tournamentRound >= t.rounds - 1) {
            if (winnerId) await this.completeTournament(t, match);
            return;
        }

        const round = match.tournamentRound;
        const slot = match.tournamentSlot;
        const siblingSlot = slot ^ 1;
        const sibling = await this.matchRepo.findOne({
            where: {
                tournamentId: t.id,
                tournamentRound: round,
                tournamentSlot: siblingSlot,
                status: 'completed',
            },
        });
        if (!sibling) return; // wait for the other feeder match

        const nextRound = round + 1;
        const nextSlot = slot >> 1;
        const evenSlot = nextSlot * 2;
        const atEven = slot === evenSlot ? match : sibling;
        const atOdd = slot === evenSlot ? sibling : match;
        const seatA = winnerUserIdOf(atEven);
        const seatB = winnerUserIdOf(atOdd);
        if (!seatA || !seatB) return;

        try {
            await this.matchService.createMatch({
                mode: 'tournament',
                seatAUserId: seatA,
                seatBUserId: seatB,
                stakeMinor: 0,
                breaker: nextSlot % 2 === 0 ? 'A' : 'B',
                tournamentId: t.id,
                tournamentRound: nextRound,
                tournamentSlot: nextSlot,
            });
        } catch (err) {
            if (isDuplicateKey(err)) return; // sibling already created it
            throw err;
        }
    }

    private async completeTournament(
        t: PoolTournament,
        finalMatch: PoolMatch,
    ): Promise<void> {
        const winnerId = winnerUserIdOf(finalMatch);
        if (!winnerId) return;
        const runnerUpId =
            finalMatch.winnerSeat === 'A'
                ? finalMatch.seatBUserId
                : finalMatch.seatAUserId;

        // Semi-final losers (places 3–4)  only exist for brackets of 4+.
        const semiLoserIds: string[] = [];
        if (t.rounds >= 2) {
            const semis = await this.matchRepo.find({
                where: {
                    tournamentId: t.id,
                    tournamentRound: t.rounds - 2,
                    status: 'completed',
                },
            });
            for (const s of semis) {
                const loser =
                    s.winnerSeat === 'A' ? s.seatBUserId : s.seatAUserId;
                if (loser) semiLoserIds.push(loser);
            }
        }

        const cfg = await this.poolService.getConfig();

        await this.dataSource.transaction(async (manager) => {
            const tRepo = manager.getRepository(PoolTournament);
            const fresh = await tRepo.findOne({
                where: { id: t.id },
                lock: { mode: 'pessimistic_write' },
            });
            if (!fresh || fresh.status !== 'active') return; // already settled

            const pool = Math.floor(
                (fresh.prizePoolMinor * (100 - fresh.rakePct)) / 100,
            );
            const tiers = [
                {
                    place: 1,
                    weight: cfg.tournamentPrize1Weight ?? 100,
                    players: [winnerId],
                },
                {
                    place: 2,
                    weight: cfg.tournamentPrize2Weight ?? 0,
                    players: runnerUpId ? [runnerUpId] : [],
                },
                {
                    place: 3,
                    weight: cfg.tournamentPrize34Weight ?? 0,
                    players: semiLoserIds,
                },
            ];
            const payouts = computeTournamentPayouts(pool, tiers);

            for (const { userId, amountMinor, place } of payouts) {
                if (amountMinor <= 0) continue;
                await this.walletService.ensureDefaultWallet(userId, manager);
                await this.walletService.creditInSession(
                    {
                        userId,
                        amountMinor,
                        entryType: 'win',
                        sourceType: 'pool_tournament',
                        sourceId: fresh.id,
                        idempotencyKey: `pool-tourney-prize:${fresh.id}:${userId}`,
                        metadata: {
                            prizePool: fresh.prizePoolMinor,
                            rakePct: fresh.rakePct,
                            place,
                        },
                    },
                    manager,
                );
            }
            await tRepo.update(
                { id: fresh.id, status: 'active' },
                {
                    status: 'completed',
                    winnerUserId: winnerId,
                    completedAt: new Date(),
                },
            );
        });
        this.logger.log(`Tournament ${t.id} won by ${winnerId}`);
    }
}

/**
 * Split an after-rake prize `pool` across finishing tiers by relative weight.
 * Only tiers with a positive weight AND at least one player count; the pool is
 * divided weight ÷ (sum of active weights), and a multi-player tier (e.g. the
 * two semi-final losers) splits its share equally. Integer minor units only
 * any rounding remainder is handed to the first player of the first tier (the
 * winner), so the payouts always sum to exactly `pool`.
 */
export function computeTournamentPayouts(
    pool: number,
    tiers: Array<{ place: number; weight: number; players: string[] }>,
): Array<{ userId: string; amountMinor: number; place: number }> {
    const active = tiers.filter(
        (tier) => tier.weight > 0 && tier.players.length > 0,
    );
    const totalWeight = active.reduce((sum, tier) => sum + tier.weight, 0);
    const out: Array<{ userId: string; amountMinor: number; place: number }> =
        [];
    if (pool <= 0 || totalWeight <= 0) {
        // Degenerate config  fall back to winner-take-all so the pool is never stuck.
        const winner = tiers[0]?.players[0];
        return winner && pool > 0
            ? [{ userId: winner, amountMinor: pool, place: 1 }]
            : [];
    }
    let distributed = 0;
    for (const tier of active) {
        const tierShare = Math.floor((pool * tier.weight) / totalWeight);
        const per = Math.floor(tierShare / tier.players.length);
        for (const userId of tier.players) {
            out.push({ userId, amountMinor: per, place: tier.place });
            distributed += per;
        }
    }
    // Winner absorbs the rounding dust so nothing is minted or lost.
    const remainder = pool - distributed;
    if (remainder > 0 && out.length > 0) out[0].amountMinor += remainder;
    return out;
}

function isDuplicateKey(err: unknown): boolean {
    const e = err as { code?: string; errno?: number };
    return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062;
}
