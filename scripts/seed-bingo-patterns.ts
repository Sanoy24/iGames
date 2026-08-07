/**
 * Seed built-in Bingo patterns directly into the database.
 *
 * These are the patterns the Derash "Winning Pattern" selector uses and that
 * pattern-mode rooms award. The backend also seeds them on startup, but this
 * script lets you (re)seed without booting the full app or hitting the API.
 *
 * Prerequisites:
 *   - .env configured with DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE
 *   - MySQL reachable
 *
 * Usage:
 *   npx ts-node scripts/seed-bingo-patterns.ts
 *   npm run seed:bingo-patterns
 */

import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { BingoPattern } from '../src/bingo/entities/bingo-pattern.entity';
import { BUILT_IN_PATTERNS } from '../src/bingo/bingo-rules.service';

async function main(): Promise<void> {
    const dataSource = new DataSource({
        type: 'mysql',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 3306),
        username: process.env.DB_USERNAME ?? 'root',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_DATABASE,
        charset: 'utf8mb4_unicode_ci',
        entities: [BingoPattern],
        // Create the bingo_patterns table if it does not exist yet.
        synchronize: true,
    });

    await dataSource.initialize();
    console.log(
        `Connected to ${process.env.DB_DATABASE}@${process.env.DB_HOST}`,
    );

    const repo = dataSource.getRepository(BingoPattern);

    const existing = await repo.findBy({ isBuiltIn: true });
    const existingNames = new Set(existing.map((p) => p.name));

    const toCreate = BUILT_IN_PATTERNS.filter(
        (p) => !existingNames.has(p.name),
    );
    if (toCreate.length === 0) {
        console.log('All built-in patterns are already seeded  nothing to do.');
    } else {
        await repo.save(
            toCreate.map((p) =>
                repo.create({ ...p, isBuiltIn: true, enabled: true }),
            ),
        );
        console.log(
            `Seeded ${toCreate.length} pattern(s): ${toCreate.map((p) => p.name).join(', ')}`,
        );
    }

    const all = await repo.find({
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    console.log(`\nPatterns now in database (${all.length}):`);
    for (const p of all) {
        console.log(
            `  • ${p.name}  ${p.patternType}${p.isBuiltIn ? ' [built-in]' : ''}${p.enabled ? '' : ' (disabled)'}`,
        );
    }

    await dataSource.destroy();
    console.log('\nDone.');
}

main().catch((err) => {
    console.error(
        '\nPattern seed failed:',
        err instanceof Error ? (err.stack ?? err.message) : err,
    );
    console.error(
        '\nCheck that MySQL is running and .env has DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE set.',
    );
    process.exit(1);
});
