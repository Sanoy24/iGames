import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
    OneToMany,
} from 'typeorm';
import { AgentLocation } from './agent-location.entity';

/**
 * MySQL returns DECIMAL as a string to avoid precision loss. Coordinates are
 * well inside double precision, so converting to a plain number on read keeps
 * the service side arithmetic-friendly.
 */
const decimalTransformer = {
    to: (value: number | null | undefined) => value ?? null,
    from: (value: string | null) =>
        value === null || value === undefined ? null : Number(value),
};

/**
 * A place a player can be attributed to  "Bole", "Megenagna", "Hawassa".
 * Locations are DB-backed config: admins create them and assign agents to them.
 * A location may have MANY agents; the location (not the agent) is the durable
 * attribution unit for a player. Agent-level attribution stays deposit-driven
 * via `User.referredByAgentId`.
 */
@Entity({ name: 'locations', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class Location {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** What the player sees in the registration dropdown. */
    @Column({ type: 'varchar', length: 120 })
    @Index({ unique: true })
    name: string;

    /** Optional grouping for admin reports, e.g. "Addis Ababa". */
    @Column({ type: 'varchar', length: 120, nullable: true })
    region?: string | null;

    /**
     * Centre point. Used only to map a shared Telegram pin onto this location.
     * Null on either axis = this location is pick-from-list only and is skipped
     * by geo matching.
     */
    @Column({
        type: 'decimal',
        precision: 10,
        scale: 7,
        nullable: true,
        transformer: decimalTransformer,
    })
    latitude?: number | null;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 7,
        nullable: true,
        transformer: decimalTransformer,
    })
    longitude?: number | null;

    /** How far from the centre a shared pin still counts as this location. */
    @Column({ type: 'int', default: 5000 })
    radiusMeters: number;

    /** Inactive locations disappear from the player dropdown but keep their history. */
    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    /** Lower sorts first in the dropdown; ties broken by name. */
    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @OneToMany(() => AgentLocation, (assignment) => assignment.location)
    agentAssignments: AgentLocation[];
}
