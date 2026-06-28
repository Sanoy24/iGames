import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PatternType = 'fixed' | 'any_row' | 'any_col' | 'any_diagonal' | 'any_line' | 'coverall';

@Entity('bingo_patterns')
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
   * 5×5 boolean mask — only used when patternType === 'fixed'.
   * true = this cell must be marked to complete the pattern.
   */
  @Column({ type: 'json', nullable: true })
  mask?: boolean[][];

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
