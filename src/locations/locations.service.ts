import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AgentLocation } from './entities/agent-location.entity';
import { Location } from './entities/location.entity';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { AssignAgentLocationsDto } from './dto/assign-agent-locations.dto';
import { SetMyLocationDto } from './dto/set-my-location.dto';
import { findNearestLocation, GeoCandidate } from './location-geo';

export type PublicLocation = {
  id: string;
  name: string;
  region?: string | null;
};

export type UserLocationResult = {
  locationId: string | null;
  locationName: string | null;
  locationSource: 'telegram_geo' | 'self_selected' | 'other';
};

/**
 * SQL fragment: the location has at least one active agent covering it. Players
 * are never offered a location nobody services.
 */
const HAS_ACTIVE_AGENT = `EXISTS (
  SELECT 1 FROM agent_locations al
    JOIN users au ON au.id = al.agentId
   WHERE al.locationId = location.id
     AND au.status = 'active'
     AND JSON_CONTAINS(au.roles, '"agent"')
)`;

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Location)
    private readonly locationRepository: Repository<Location>,
    @InjectRepository(AgentLocation)
    private readonly agentLocationRepository: Repository<AgentLocation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  // ── Player-facing ──────────────────────────────────────────────────

  /** The registration dropdown: active locations that have at least one active agent. */
  async listPublicLocations(): Promise<PublicLocation[]> {
    const locations = await this.locationRepository
      .createQueryBuilder('location')
      .where('location.isActive = :isActive', { isActive: true })
      .andWhere(HAS_ACTIVE_AGENT)
      .orderBy('location.sortOrder', 'ASC')
      .addOrderBy('location.name', 'ASC')
      .getMany();

    return locations.map((location) => ({
      id: location.id,
      name: location.name,
      region: location.region ?? null,
    }));
  }

  /**
   * Record the player's answer. `other` clears the location and leaves the
   * player attributed to the house. `referredByAgentId` is deliberately not
   * touched here — agent-level credit is earned by whoever handles the player's
   * first deposit, since a location may have many agents.
   */
  async setUserLocation(
    userId: string,
    dto: SetMyLocationDto,
    source: 'self_selected' | 'telegram_geo' = 'self_selected',
  ): Promise<UserLocationResult> {
    const wantsOther = dto.other === true;

    if (wantsOther && dto.locationId) {
      throw new BadRequestException('Send either locationId or other, not both');
    }
    if (!wantsOther && !dto.locationId) {
      throw new BadRequestException('Send a locationId, or other: true to skip attribution');
    }

    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (wantsOther) {
      user.locationId = null;
      user.locationSource = 'other';
      user.locationCapturedAt = new Date();
      await this.userRepository.save(user);
      return { locationId: null, locationName: null, locationSource: 'other' };
    }

    const location = await this.locationRepository.findOneBy({ id: dto.locationId });
    if (!location) throw new NotFoundException('Location not found');
    if (!location.isActive) throw new BadRequestException('That location is no longer available');

    user.locationId = location.id;
    user.locationSource = source;
    user.locationCapturedAt = new Date();
    await this.userRepository.save(user);

    return { locationId: location.id, locationName: location.name, locationSource: source };
  }

  /**
   * Map a shared Telegram pin onto a configured location. Returns null when the
   * pin falls outside every location's radius — the caller then falls back to
   * the pick-from-list prompt rather than guessing.
   */
  async resolveLocationFromCoords(
    latitude: number,
    longitude: number,
  ): Promise<{ id: string; name: string; distanceMeters: number } | null> {
    const locations = await this.locationRepository
      .createQueryBuilder('location')
      .where('location.isActive = :isActive', { isActive: true })
      .andWhere('location.latitude IS NOT NULL')
      .andWhere('location.longitude IS NOT NULL')
      .andWhere(HAS_ACTIVE_AGENT)
      .orderBy('location.sortOrder', 'ASC')
      .addOrderBy('location.name', 'ASC')
      .getMany();

    const candidates: GeoCandidate[] = locations.map((location) => ({
      id: location.id,
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      radiusMeters: location.radiusMeters,
    }));

    return findNearestLocation(candidates, latitude, longitude);
  }

  /** The player's current answer, or null when they have never been asked. */
  async getUserLocation(userId: string): Promise<UserLocationResult | null> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user || !user.locationSource) return null;

    let locationName: string | null = null;
    if (user.locationId) {
      const location = await this.locationRepository.findOneBy({ id: user.locationId });
      locationName = location?.name ?? null;
    }

    return {
      locationId: user.locationId ?? null,
      locationName,
      locationSource: user.locationSource,
    };
  }

  // ── Admin ──────────────────────────────────────────────────────────

  /** Every location with its agent and player counts, for the admin table. */
  async listLocationsForAdmin(): Promise<
    Array<PublicLocation & {
      latitude: number | null;
      longitude: number | null;
      radiusMeters: number;
      isActive: boolean;
      sortOrder: number;
      agentCount: number;
      playerCount: number;
    }>
  > {
    const rows: Array<{
      id: string;
      name: string;
      region: string | null;
      latitude: string | null;
      longitude: string | null;
      radiusMeters: number;
      isActive: number;
      sortOrder: number;
      agentCount: string | number;
      playerCount: string | number;
    }> = await this.dataSource.query(
      `SELECT l.id, l.name, l.region, l.latitude, l.longitude, l.radiusMeters,
              l.isActive, l.sortOrder,
              COALESCE(a.agentCount, 0) agentCount,
              COALESCE(p.playerCount, 0) playerCount
         FROM locations l
         LEFT JOIN (
           SELECT al.locationId, COUNT(*) agentCount
             FROM agent_locations al
             JOIN users au ON au.id = al.agentId
            WHERE au.status = 'active'
            GROUP BY al.locationId
         ) a ON a.locationId = l.id
         LEFT JOIN (
           SELECT locationId, COUNT(*) playerCount
             FROM users
            WHERE locationId IS NOT NULL
            GROUP BY locationId
         ) p ON p.locationId = l.id
        ORDER BY l.sortOrder ASC, l.name ASC`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      region: row.region,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      radiusMeters: Number(row.radiusMeters),
      isActive: Boolean(row.isActive),
      sortOrder: Number(row.sortOrder),
      agentCount: Number(row.agentCount ?? 0),
      playerCount: Number(row.playerCount ?? 0),
    }));
  }

  async createLocation(dto: CreateLocationDto): Promise<Location> {
    const name = dto.name.trim();
    const existing = await this.locationRepository.findOneBy({ name });
    if (existing) throw new ConflictException(`A location named "${name}" already exists`);

    this.assertCoordinatePair(dto.latitude, dto.longitude);

    const location = this.locationRepository.create({
      name,
      region: dto.region?.trim() || null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      radiusMeters: dto.radiusMeters ?? 5000,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });

    return this.locationRepository.save(location);
  }

  async updateLocation(id: string, dto: UpdateLocationDto): Promise<Location> {
    const location = await this.locationRepository.findOneBy({ id });
    if (!location) throw new NotFoundException('Location not found');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const clash = await this.locationRepository.findOneBy({ name });
      if (clash && clash.id !== id) {
        throw new ConflictException(`A location named "${name}" already exists`);
      }
      location.name = name;
    }

    if (dto.region !== undefined) location.region = dto.region?.trim() || null;
    if (dto.latitude !== undefined) location.latitude = dto.latitude ?? null;
    if (dto.longitude !== undefined) location.longitude = dto.longitude ?? null;
    if (dto.radiusMeters !== undefined) location.radiusMeters = dto.radiusMeters;
    if (dto.isActive !== undefined) location.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) location.sortOrder = dto.sortOrder;

    this.assertCoordinatePair(location.latitude, location.longitude);

    return this.locationRepository.save(location);
  }

  /**
   * Hard-delete only while nothing references the location. Once players are
   * attributed to it, deleting would silently rewrite their history, so we
   * refuse and point the admin at deactivation instead.
   */
  async deleteLocation(id: string): Promise<{ deleted: true }> {
    const location = await this.locationRepository.findOneBy({ id });
    if (!location) throw new NotFoundException('Location not found');

    const playerCount = await this.userRepository.countBy({ locationId: id });
    if (playerCount > 0) {
      throw new ConflictException(
        `${playerCount} player(s) are attributed to this location. Deactivate it instead of deleting.`,
      );
    }

    await this.agentLocationRepository.delete({ locationId: id });
    await this.locationRepository.delete({ id });
    return { deleted: true };
  }

  /** Replace an agent's whole set of covered locations. */
  async setAgentLocations(agentId: string, dto: AssignAgentLocationsDto): Promise<AgentLocation[]> {
    const agent = await this.userRepository.findOneBy({ id: agentId });
    if (!agent) throw new NotFoundException('Agent not found');
    if (!agent.roles?.includes('agent')) {
      throw new BadRequestException('That user is not an agent');
    }

    const locationIds = [...new Set(dto.locationIds)];

    if (dto.primaryLocationId && !locationIds.includes(dto.primaryLocationId)) {
      throw new BadRequestException('primaryLocationId must be one of locationIds');
    }

    if (locationIds.length > 0) {
      const found = await this.locationRepository.findBy(locationIds.map((id) => ({ id })));
      if (found.length !== locationIds.length) {
        throw new NotFoundException('One or more locations do not exist');
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentLocation);
      await repo.delete({ agentId });

      if (locationIds.length === 0) return [];

      const assignments = locationIds.map((locationId) =>
        repo.create({
          agentId,
          locationId,
          isPrimary: locationId === dto.primaryLocationId,
        }),
      );

      return repo.save(assignments);
    });
  }

  /** The locations an agent covers. */
  async listAgentLocations(agentId: string): Promise<Array<PublicLocation & { isPrimary: boolean }>> {
    const assignments = await this.agentLocationRepository.find({
      where: { agentId },
      relations: { location: true },
    });

    return assignments
      .filter((assignment) => assignment.location)
      .map((assignment) => ({
        id: assignment.location.id,
        name: assignment.location.name,
        region: assignment.location.region ?? null,
        isPrimary: assignment.isPrimary,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The active agents covering a location. */
  async listLocationAgents(locationId: string): Promise<Array<{ agentId: string; displayName: string; isPrimary: boolean }>> {
    const rows: Array<{ agentId: string; displayName: string; isPrimary: number }> =
      await this.dataSource.query(
        `SELECT al.agentId, u.displayName, al.isPrimary
           FROM agent_locations al
           JOIN users u ON u.id = al.agentId
          WHERE al.locationId = ? AND u.status = 'active'
          ORDER BY al.isPrimary DESC, u.displayName ASC`,
        [locationId],
      );

    return rows.map((row) => ({
      agentId: row.agentId,
      displayName: row.displayName,
      isPrimary: Boolean(row.isPrimary),
    }));
  }

  /**
   * A location is only usable for geo matching with BOTH coordinates. Half a
   * pair is always a data-entry mistake, and silently ignoring it would make
   * the location quietly unmatchable.
   */
  private assertCoordinatePair(latitude?: number | null, longitude?: number | null): void {
    const hasLat = latitude !== null && latitude !== undefined;
    const hasLng = longitude !== null && longitude !== undefined;
    if (hasLat !== hasLng) {
      throw new BadRequestException('Provide both latitude and longitude, or neither');
    }
  }
}
