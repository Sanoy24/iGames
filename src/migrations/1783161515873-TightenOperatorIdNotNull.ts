import { MigrationInterface, QueryRunner } from "typeorm";
import { OPERATOR_ZERO_ID } from "../operator/operator.constants";

/**
 * Tightens operatorId to NOT NULL across every tenant-owned table, completing
 * the add-nullable → backfill → tighten sequence. TenantSubscriber guarantees
 * inserts are stamped, so NULLs cannot appear going forward; the defensive
 * backfill here covers any pre-existing NULL before the constraint is applied.
 *
 * Hand-written (not `migration:generate`) on purpose: the generated version was
 * full of phantom diffs that dropped and re-added JSON columns — data-destroying
 * on populated tables. This does only what is intended.
 */
export class TightenOperatorIdNotNull1783161515873 implements MigrationInterface {
  name = "TightenOperatorIdNotNull1783161515873";

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
    for (const table of this.tenantTables) {
      await queryRunner.query(
        `UPDATE \`${table}\` SET operatorId = ? WHERE operatorId IS NULL`,
        [OPERATOR_ZERO_ID],
      );
      await queryRunner.query(
        `ALTER TABLE \`${table}\` MODIFY \`operatorId\` varchar(36) NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tenantTables) {
      await queryRunner.query(
        `ALTER TABLE \`${table}\` MODIFY \`operatorId\` varchar(36) NULL`,
      );
    }
  }
}
