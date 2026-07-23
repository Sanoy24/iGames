import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RngService, RNG_ALGORITHM_VERSION } from './rng.service';
import { RngAuditLog } from './entities/rng-audit-log.entity';

const mockRepository = () => ({
  create: jest.fn().mockImplementation((dto) => dto),
  save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'audit-id-123', ...entity }))
});

describe('RngService', () => {
  let service: RngService;
  let auditLogRepository: any;

  beforeEach(async () => {
    auditLogRepository = mockRepository();
    const module = await Test.createTestingModule({
      providers: [
        RngService,
        { provide: getRepositoryToken(RngAuditLog), useValue: auditLogRepository }
      ]
    }).compile();
    service = module.get(RngService);
  });

  // ─── drawSeed ─────────────────────────────────────────────────────────────
  describe('drawSeed', () => {
    it('returns a single seed within [1, max] for a huge range without hanging', async () => {
      // A 2-billion range would OOM if the range were materialised as an array;
      // drawSeed must complete instantly and stay in range.
      const result = await service.drawSeed({ max: 2_000_000_000 });
      expect(result.numbers).toHaveLength(1);
      expect(result.numbers[0]).toBeGreaterThanOrEqual(1);
      expect(result.numbers[0]).toBeLessThanOrEqual(2_000_000_000);
    });

    it('writes an audit row when gameType + gameReference are supplied', async () => {
      const result = await service.drawSeed({ gameType: 'pool', gameReference: 'match-1' });
      expect(auditLogRepository.save).toHaveBeenCalled();
      expect(result.auditLogId).toBe('audit-id-123');
      expect(result.algorithmVersion).toBe(RNG_ALGORITHM_VERSION);
    });

    it('does not audit when no game reference is given', async () => {
      await service.drawSeed({});
      expect(auditLogRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a gameType without a gameReference', async () => {
      await expect(service.drawSeed({ gameType: 'pool' })).rejects.toBeInstanceOf(BadRequestException);
    });
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
      expect(auditLogRepository.create).toHaveBeenCalledTimes(1);
      expect(auditLogRepository.save).toHaveBeenCalledTimes(1);
      expect(result.auditLogId).toBe('audit-id-123');
    });

    it('does NOT create an audit log when gameType is omitted', async () => {
      const result = await service.drawUniqueNumbers({ min: 1, max: 80, count: 20 });
      expect(auditLogRepository.create).not.toHaveBeenCalled();
      expect(result.auditLogId).toBeUndefined();
    });

    it('can draw the full range (count = max - min + 1)', async () => {
      const result = await service.drawUniqueNumbers({ min: 1, max: 10, count: 10 });
      expect(result.numbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('always includes required mustInclude numbers', async () => {
      const result = await service.drawUniqueNumbers({
        min: 1,
        max: 80,
        count: 20,
        mustInclude: [7, 13, 42]
      });

      expect(result.numbers).toEqual(expect.arrayContaining([7, 13, 42]));
      expect(new Set(result.numbers).size).toBe(20);
    });

    it('includes mustInclude in the audited input hash', async () => {
      const withSeven = await service.drawUniqueNumbers({
        min: 1,
        max: 80,
        count: 20,
        mustInclude: [7],
        gameType: 'keno',
        gameReference: 'draw-001'
      });
      const withEight = await service.drawUniqueNumbers({
        min: 1,
        max: 80,
        count: 20,
        mustInclude: [8],
        gameType: 'keno',
        gameReference: 'draw-001'
      });

      expect(withSeven.inputHash).not.toBe(withEight.inputHash);
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

    it('throws when mustInclude contains duplicates', async () => {
      await expect(
        service.drawUniqueNumbers({ min: 1, max: 80, count: 5, mustInclude: [3, 3] })
      ).rejects.toThrow(BadRequestException);
    });
  });
});
