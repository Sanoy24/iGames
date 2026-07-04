import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

// Standalone DataSource used only by the TypeORM CLI (migration:generate / run /
// revert). The running app configures its connection in app.module.ts; this file
// exists so the CLI can introspect entities and manage migrations outside Nest.
loadEnv();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'igames',
  // Glob the TS sources; the CLI runs through ts-node so .ts is correct here.
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  timezone: 'Z',
  charset: 'utf8mb4_unicode_ci',
  synchronize: false,
  migrationsTableName: 'typeorm_migrations',
});

export default AppDataSource;
