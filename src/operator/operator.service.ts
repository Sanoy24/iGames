import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Operator, OperatorBranding, OperatorPlan } from './entities/operator.entity';
import { OperatorConfig } from './entities/operator-config.entity';

export interface CreateOperatorInput {
  slug: string;
  displayName: string;
  plan?: OperatorPlan;
  customDomain?: string | null;
  branding?: OperatorBranding | null;
}

/**
 * Owns the tenant lifecycle and the read paths that Phase 1 resolvers will use
 * to turn a slug / host / bot into an operatorId. Kept intentionally small for
 * Phase 0 — super-admin CRUD and richer provisioning arrive in Phase 4.
 */
@Injectable()
export class OperatorService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Operator)
    private readonly operatorRepository: Repository<Operator>,
  ) {}

  /** Creates an operator plus its default config row in one transaction. */
  async createOperator(input: CreateOperatorInput): Promise<Operator> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const operator = manager.getRepository(Operator).create({
        slug: input.slug,
        displayName: input.displayName,
        plan: input.plan ?? 'trial',
        status: 'trial',
        customDomain: input.customDomain ?? null,
        branding: input.branding ?? null,
      });
      const saved = await manager.getRepository(Operator).save(operator);

      const config = manager.getRepository(OperatorConfig).create({
        operatorId: saved.id,
      });
      await manager.getRepository(OperatorConfig).save(config);

      return saved;
    });
  }

  findById(id: string): Promise<Operator | null> {
    return this.operatorRepository.findOne({ where: { id } });
  }

  findBySlug(slug: string): Promise<Operator | null> {
    return this.operatorRepository.findOne({ where: { slug } });
  }

  findByCustomDomain(customDomain: string): Promise<Operator | null> {
    return this.operatorRepository.findOne({ where: { customDomain } });
  }

  async getByIdOrThrow(id: string): Promise<Operator> {
    const operator = await this.findById(id);
    if (!operator) {
      throw new NotFoundException(`Operator ${id} not found`);
    }
    return operator;
  }
}
