import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Repository, EntityManager } from 'typeorm';
import { RngAuditLog, RngGameType } from './entities/rng-audit-log.entity';

export const RNG_ALGORITHM_VERSION = 'crypto-random-int-without-replacement-v1';

export type DrawUniqueNumbersInput = {
  min: number;
  max: number;
  count: number;
  gameType?: RngGameType;
  gameReference?: string;
  metadata?: Record<string, unknown>;
  mustInclude?: number[];
  manager?: EntityManager;
};

export type DrawUniqueNumbersResult = {
  numbers: number[];
  algorithmVersion: string;
  inputHash: string;
  randomnessMaterialHash: string;
  auditLogId?: string;
};

@Injectable()
export class RngService {
  constructor(
    @InjectRepository(RngAuditLog)
    private readonly rngAuditLogRepository: Repository<RngAuditLog>
  ) {}

  async drawUniqueNumbers(
    input: DrawUniqueNumbersInput
  ): Promise<DrawUniqueNumbersResult> {
    this.validateDrawInput(input);

    const randomnessMaterial = randomBytes(32);
    const numbers = this.drawWithoutReplacement(input.min, input.max, input.count, input.mustInclude, randomnessMaterial);
    const inputHash = this.hashJson({
      min: input.min,
      max: input.max,
      count: input.count,
      mustInclude: [...(input.mustInclude ?? [])].sort((left, right) => left - right),
      gameType: input.gameType,
      gameReference: input.gameReference,
      metadata: input.metadata ?? {}
    });
    const randomnessMaterialHash = createHash('sha256')
      .update(randomnessMaterial)
      .digest('hex');

    const result: DrawUniqueNumbersResult = {
      numbers,
      algorithmVersion: RNG_ALGORITHM_VERSION,
      inputHash,
      randomnessMaterialHash
    };

    if (input.gameType && input.gameReference) {
      const auditLog = await this.createAuditLog({
        gameType: input.gameType,
        gameReference: input.gameReference,
        min: input.min,
        max: input.max,
        count: input.count,
        numbers,
        inputHash,
        randomnessMaterialHash,
        metadata: input.metadata ?? {},
        manager: input.manager
      });
      result.auditLogId = auditLog.id;
    }

    return result;
  }

  private async createAuditLog(input: {
    gameType: RngGameType;
    gameReference: string;
    min: number;
    max: number;
    count: number;
    numbers: number[];
    inputHash: string;
    randomnessMaterialHash: string;
    metadata: Record<string, unknown>;
    manager?: EntityManager;
  }): Promise<RngAuditLog> {
    const repo = input.manager ? input.manager.getRepository(RngAuditLog) : this.rngAuditLogRepository;
    const auditLog = repo.create({
      gameType: input.gameType,
      gameReference: input.gameReference,
      algorithmVersion: RNG_ALGORITHM_VERSION,
      inputHash: input.inputHash,
      randomnessMaterialHash: input.randomnessMaterialHash,
      outputNumbers: input.numbers,
      min: input.min,
      max: input.max,
      count: input.count,
      metadata: input.metadata
    });

    return await repo.save(auditLog);
  }

  private drawWithoutReplacement(min: number, max: number, count: number, mustInclude?: number[], seedMaterial?: Buffer): number[] {
    const included = new Set(mustInclude ?? []);
    const pool = Array.from({ length: max - min + 1 }, (_, index) => min + index).filter((n) => !included.has(n));
    const result = Array.from(included);

    const needed = count - included.size;
    let seedCounter = 0;
    
    const getNextRandomInt = (upperBound: number): number => {
      if (!seedMaterial) return randomInt(upperBound);
      const hash = createHash('sha256')
        .update(seedMaterial)
        .update(Buffer.from(seedCounter.toString()))
        .digest();
      seedCounter++;
      return hash.readUInt32LE(0) % upperBound;
    };

    for (let index = 0; index < needed; index += 1) {
      const swapIndex = getNextRandomInt(pool.length - index) + index;
      const selected = pool[swapIndex];
      pool[swapIndex] = pool[index];
      pool[index] = selected;
      result.push(selected);
    }

    for (let i = result.length - 1; i > 0; i--) {
      const j = getNextRandomInt(i + 1);
      const temp = result[i];
      result[i] = result[j];
      result[j] = temp;
    }

    return result;
  }

  private validateDrawInput(input: DrawUniqueNumbersInput): void {
    if (!Number.isSafeInteger(input.min) || !Number.isSafeInteger(input.max)) {
      throw new BadRequestException('RNG min and max must be safe integers');
    }
    if (input.min < 1 || input.max < input.min) {
      throw new BadRequestException('RNG range is invalid');
    }
    if (!Number.isSafeInteger(input.count) || input.count < 1) {
      throw new BadRequestException('RNG count must be a positive integer');
    }
    const rangeSize = input.max - input.min + 1;
    if (input.count > rangeSize) {
      throw new BadRequestException('RNG count cannot exceed range size');
    }
    if (input.mustInclude) {
      const uniqueMustInclude = new Set(input.mustInclude);
      if (uniqueMustInclude.size !== input.mustInclude.length) {
        throw new BadRequestException('RNG mustInclude values must be unique');
      }
      if (input.mustInclude.length > input.count) {
        throw new BadRequestException('RNG mustInclude exceeds count');
      }
      for (const n of input.mustInclude) {
        if (n < input.min || n > input.max) {
          throw new BadRequestException('RNG mustInclude value out of bounds');
        }
      }
    }
    if ((input.gameType && !input.gameReference) || (!input.gameType && input.gameReference)) {
      throw new BadRequestException('RNG audit requires both gameType and gameReference');
    }
  }

  private hashJson(value: Record<string, unknown>): string {
    return createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nestedValue]) => `${JSON.stringify(key)}:${this.stableStringify(nestedValue)}`)
        .join(',')}}`;
    }

    return JSON.stringify(value);
  }
}
