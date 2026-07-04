import { MigrationInterface, QueryRunner } from "typeorm";
import {
  OPERATOR_ZERO_ID,
  OPERATOR_ZERO_CONFIG_ID,
  OPERATOR_ZERO_SLUG,
} from "../operator/operator.constants";

/**
 * Seeds the default tenant ("operator zero") and backfills every tenant-owned
 * table's operatorId to it. On a fresh DB the backfill touches no rows; it
 * exists so the same migration is correct if run against data (the standard
 * add-nullable → backfill → tighten-to-NOT-NULL sequence).
 */
export class SeedOperatorZero1783159602842 implements MigrationInterface {
  private readonly tenantTables = [
    "users",
    "auth_identities",
    "wallets",
    "ledger_entries",
    "idempotency_records",
    "withdrawals",
    "wager_limits",
    "keno_configs",
    "keno_draws",
    "keno_tickets",
    "bingo_cards",
    "bingo_patterns",
    "bingo_tickets",
    "bingo_rooms",
    "crash_rounds",
    "crash_bets",
    "rng_audit_logs",
    "telebirr_deposits",
    "agent_shifts",
    "agent_action_logs",
    "admin_audit_logs",
    "broadcast_messages",
    "refresh_sessions",
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "INSERT INTO `operators` (id, slug, displayName, plan, status) VALUES (?, ?, 'Default Operator', 'enterprise', 'active')",
      [OPERATOR_ZERO_ID, OPERATOR_ZERO_SLUG],
    );
    await queryRunner.query(
      "INSERT INTO `operator_configs` (id, operatorId) VALUES (?, ?)",
      [OPERATOR_ZERO_CONFIG_ID, OPERATOR_ZERO_ID],
    );

    for (const table of this.tenantTables) {
      await queryRunner.query(
        `UPDATE \`${table}\` SET operatorId = ? WHERE operatorId IS NULL`,
        [OPERATOR_ZERO_ID],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tenantTables) {
      await queryRunner.query(
        `UPDATE \`${table}\` SET operatorId = NULL WHERE operatorId = ?`,
        [OPERATOR_ZERO_ID],
      );
    }
    await queryRunner.query("DELETE FROM `operator_configs` WHERE id = ?", [
      OPERATOR_ZERO_CONFIG_ID,
    ]);
    await queryRunner.query("DELETE FROM `operators` WHERE id = ?", [
      OPERATOR_ZERO_ID,
    ]);
  }
}
