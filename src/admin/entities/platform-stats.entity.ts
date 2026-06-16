import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('platform_stats')
export class PlatformStats {
  @PrimaryColumn({ type: 'varchar', length: 50, default: 'global' })
  key: string;

  @Column({ type: 'bigint', default: 0 })
  totalTicketVolumeMinor: number;

  @Column({ type: 'bigint', default: 0 })
  totalPayoutsMinor: number;

  @Column({ type: 'bigint', default: 0 })
  totalRefundsMinor: number;

  @Column({ type: 'bigint', default: 0 })
  totalServiceChargesMinor: number;
}
