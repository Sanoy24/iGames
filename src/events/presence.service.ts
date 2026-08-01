import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type BotPresenceCounts = {
  kenoBots: number;
  bingoBots: number;
  crashBots: number;
  totalBots: number;
};

/**
 * Counts house-controlled bots so the live online numbers can INCLUDE them. Bots
 * never open a WebSocket, so they are invisible to the gateway's socket-based
 * counts; here we count them from the database instead:
 *   • per game — bots actually participating in the current live instance
 *     (holding cartelas / tickets / bets), and
 *   • total    — every active bot (they are considered "online").
 * Results are cached briefly because connect/disconnect broadcasts fire often but
 * the bot figures barely move between them, so we avoid hammering the database.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private cache: BotPresenceCounts | null = null;
  private cacheAt = 0;
  private readonly ttlMs = 8_000;

  constructor(private readonly dataSource: DataSource) {}

  async getBotCounts(): Promise<BotPresenceCounts> {
    const now = Date.now();
    if (this.cache && now - this.cacheAt < this.ttlMs) return this.cache;
    const counts = await this.computeBotCounts();
    this.cache = counts;
    this.cacheAt = now;
    return counts;
  }

  private async computeBotCounts(): Promise<BotPresenceCounts> {
    const bot = "JSON_EXTRACT(u.productMetadata,'$.botPolicy') IS NOT NULL AND JSON_EXTRACT(u.productMetadata,'$.botPolicy.active') = true";
    const gameBot = (game: 'keno' | 'bingo' | 'crash') =>
      `${bot} AND (JSON_EXTRACT(u.productMetadata,'$.botPolicy.games.${game}.active') IS NULL OR JSON_EXTRACT(u.productMetadata,'$.botPolicy.games.${game}.active') = true)`;
    const scalar = async (sql: string): Promise<number> => {
      try {
        const rows: Array<{ c: number | string }> = await this.dataSource.query(sql);
        return Number(rows[0]?.c ?? 0);
      } catch (err) {
        this.logger.debug(`bot count query failed: ${err instanceof Error ? err.message : err}`);
        return 0;
      }
    };

    const [bingoBots, kenoBots, crashBots, totalBots] = await Promise.all([
      scalar(
        `SELECT COUNT(DISTINCT t.userId) c FROM bingo_tickets t
           JOIN bingo_rooms r ON r.id = t.roomId
           JOIN users u ON u.id = t.userId
          WHERE r.status IN ('open','running') AND t.status <> 'cancelled' AND ${gameBot('bingo')}`,
      ),
      scalar(
        `SELECT COUNT(DISTINCT tk.userId) c FROM keno_tickets tk
           JOIN keno_draws d ON d.id = tk.drawId
           JOIN users u ON u.id = tk.userId
          WHERE d.status IN ('open','locked') AND ${gameBot('keno')}`,
      ),
      scalar(
        `SELECT COUNT(DISTINCT b.userId) c FROM crash_bets b
           JOIN crash_rounds cr ON cr.id = b.roundId
           JOIN users u ON u.id = b.userId
          WHERE cr.status IN ('waiting','running') AND ${gameBot('crash')}`,
      ),
      scalar(`SELECT COUNT(*) c FROM users u WHERE ${bot}`),
    ]);

    return { kenoBots, bingoBots, crashBots, totalBots };
  }
}
