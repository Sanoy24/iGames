import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A registered entrant in a tournament bracket. */
@Entity({ name: 'pool_tournament_players', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['tournamentId', 'userId'], { unique: true })
export class PoolTournamentPlayer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  tournamentId: string;

  @Column({ type: 'varchar', length: 36 })
  userId: string;

  /** Position in the seeded bracket (0-based); set at start. Null while registering. */
  @Column({ type: 'int', nullable: true })
  seedIndex: number | null;

  @Column({ type: 'boolean', default: false })
  eliminated: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
