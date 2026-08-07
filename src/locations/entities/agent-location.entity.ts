import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
    ManyToOne,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Location } from './location.entity';

/**
 * Which agents cover which locations. Many-to-many: a location can have several
 * agents (so a busy area is not capped at one), and an agent can cover several
 * locations. Only locations with at least one active agent are offered to
 * players in the registration dropdown.
 */
@Entity({ name: 'agent_locations', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['agentId', 'locationId'], { unique: true })
export class AgentLocation {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 36 })
    @Index()
    agentId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    agent: User;

    @Column({ type: 'varchar', length: 36 })
    @Index()
    locationId: string;

    @ManyToOne(() => Location, (location) => location.agentAssignments, {
        onDelete: 'CASCADE',
    })
    location: Location;

    /** The agent's home location. Informational  attribution stays deposit-driven. */
    @Column({ type: 'boolean', default: false })
    isPrimary: boolean;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;
}
