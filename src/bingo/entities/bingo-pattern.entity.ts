import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

export type PatternType =
    | 'fixed'
    | 'any_row'
    | 'any_col'
    | 'any_diagonal'
    | 'any_line'
    | 'any_two_lines'
    | 'any_three_lines'
    | 'coverall'
    | 'composite_or';

/**
 * One alternate way to satisfy a `composite_or` pattern  e.g. "1 line + the
 * Corners mask" or "2 lines" alone. The pattern is completed if ANY option is
 * fully met: `minLines` (if set) requires at least that many completed
 * rows/cols/diagonals, and `mask` (if set) requires those exact cells marked
 * too  matching real bingo-hall pattern books (e.g. "Any 2 Lines or Line & 4
 * Corners"), where a harder line-count tier can also be reached via an easier
 * line-count plus a bonus shape.
 */
export type PatternCompositeOption = {
    minLines?: number;
    mask?: boolean[][];
};

@Entity({ name: 'bingo_patterns', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class BingoPattern {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 100 })
    name: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    description?: string;

    /** Determines how the pattern is evaluated */
    @Column({ type: 'varchar', length: 20, default: 'fixed' })
    patternType: PatternType;

    /**
     * 5×5 boolean mask  only used when patternType === 'fixed'.
     * true = this cell must be marked to complete the pattern.
     */
    @Column({ type: 'json', nullable: true })
    mask?: boolean[][];

    /** Only used when patternType === 'composite_or'. See PatternCompositeOption. */
    @Column({ type: 'json', nullable: true })
    compositeOptions?: PatternCompositeOption[] | null;

    /** Built-in patterns cannot be deleted */
    @Column({ type: 'boolean', default: false })
    isBuiltIn: boolean;

    @Column({ type: 'boolean', default: true })
    enabled: boolean;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
