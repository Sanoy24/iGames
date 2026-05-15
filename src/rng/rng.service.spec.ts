import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { RngService, RNG_ALGORITHM_VERSION } from './rng.service';
import { RngAuditLog } from './schemas/rng-audit-log.schema';

const mockAuditLogModel = () => ({
  create: jest.fn().mockResolvedValue([{ _id: 'audit-id-123' }])
});

describe('RngService', () => {
  let service: RngService;
  let auditLogModel: ReturnType<typeof mockAuditLogModel>;

  beforeEach(async () => {
    auditLogModel = mockAuditLogModel();
    const module = await Test.createTestingModule({
      providers: [
        RngService,
        { provide: getModelToken(RngAuditLog.name), useValue: auditLogModel }
      ]
    }).compile();
    service = module.get(RngService);
  });

  // ─── drawUniqueNumbers ────────────────────────────────────────────────────
  describe('drawUniqueNumbers', () => {
    it('returns the requested count of numbers', async () => {
      const result = await service.drawUniqueNumbers({ min: 1, max: 80, count: 20 });
      expect(result.numbers.length).toBe(20);
    });

    it('returns unique numbers only', async () => {
      const result = await service.drawUniqueNumbers({ min: 1, max: 80, count: 20 });
      expect(new Set(result.numbers).size).toBe(20);
    });

    it('returns numbers within the specified range', async () => {
      const result = await service.drawUniqueNumbers({ min: 1, max: 80, count: 20 });
      result.numbers.forEach((n) => {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(80);
      });
    });

    it('includes the correct algorithmVersion', async () => {
      const result = await service.drawUniqueNumbers({ min: 1, max: 80, count: 20 });
      expect(result.algorithmVersion).toBe(RNG_ALGORITHM_VERSION);
    });

    it('produces different draws on successive calls (non-deterministic)', async () => {
      const a = await service.drawUniqueNumbers({ min: 1, max: 80, count: 20 });
      const b = await service.drawUniqueNumbers({ min: 1, max: 80, count: 20 });
      expect(a.numbers.join(',')).not.toBe(b.numbers.join(','));
    });

    it('creates an audit log when gameType and gameReference are provided', async () => {
      const result = await service.drawUniqueNumbers({
        min: 1,
        max: 80,
        count: 20,
        gameType: 'keno',
        gameReference: 'draw-001'
      });
      expect(auditLogModel.create).toHaveBeenCalledTimes(1);
      expect(result.auditLogId).toBe('audit-id-123');
    });

    it('does NOT create an audit log when gameType is omitted', async () => {
      const result = await service.drawUniqueNumbers({ min: 1, max: 80, count: 20 });
      expect(auditLogModel.create).not.toHaveBeenCalled();
      expect(result.auditLogId).toBeUndefined();
    });

    it('can draw the full range (count = max - min + 1)', async () => {
      const result = await service.drawUniqueNumbers({ min: 1, max: 10, count: 10 });
      expect(result.numbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  // ─── input validation ─────────────────────────────────────────────────────
  describe('input validation', () => {
    it('throws when count exceeds range size', async () => {
      await expect(
        service.drawUniqueNumbers({ min: 1, max: 5, count: 10 })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when min < 1', async () => {
      await expect(
        service.drawUniqueNumbers({ min: 0, max: 80, count: 5 })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when max < min', async () => {
      await expect(
        service.drawUniqueNumbers({ min: 50, max: 10, count: 5 })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when count is 0', async () => {
      await expect(
        service.drawUniqueNumbers({ min: 1, max: 80, count: 0 })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when gameType is provided without gameReference', async () => {
      await expect(
        service.drawUniqueNumbers({ min: 1, max: 80, count: 5, gameType: 'keno' })
      ).rejects.toThrow(BadRequestException);
    });
  });
});
