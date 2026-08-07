import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A player waiting to be matched into a two-player game at a given stake. One
 * row per user (unique)  joining again replaces the previous entry.
 */
@Entity({ name: 'pool_queue_entries', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class PoolQueueEntry {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 36, unique: true })
    userId: string;

    /** Stake bucket  players only match with an identical stake. */
    @Column({ type: 'int' })
    @Index()
    stakeMinor: number;

    @CreateDateColumn({ type: 'timestamp' })
    @Index()
    createdAt: Date;
}
