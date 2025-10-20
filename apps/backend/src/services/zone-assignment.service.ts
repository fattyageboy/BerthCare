/**
 * Zone Assignment Service
 *
 * Assigns clients to zones based on geographic proximity using authoritative
 * zone definitions stored in PostgreSQL. Results are cached in Redis to keep
 * lookups fast while ensuring a single source of truth.
 *
 * Philosophy alignment:
 * - Integration of data sources (Postgres + Redis) for a seamless experience
 * - Focus on simplicity: a single, well-defined place for zone definitions
 * - Perfection in details: deterministic behaviour, informative errors
 */

import { Pool } from 'pg';
import { createClient } from 'redis';

/**
 * Zone data
 */
export interface Zone {
  id: string;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number | null;
}

/**
 * Zone assignment error
 */
export class ZoneAssignmentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ZoneAssignmentError';
  }
}

const ZONE_CACHE_KEY = 'zones:all:v1';

/**
 * Zone Assignment Service
 *
 * Handles zone assignment based on geographic proximity.
 */
export class ZoneAssignmentService {
  private cacheTTL: number = 3600; // 1 hour

  constructor(
    private redisClient: ReturnType<typeof createClient>,
    private pgPool: Pool
  ) {}

  /**
   * Assign a zone based on latitude/longitude
   *
   * Uses proximity to zone center points to determine nearest zone.
   *
   * @param latitude - Client latitude
   * @param longitude - Client longitude
   * @returns Zone ID
   * @throws ZoneAssignmentError if no zones available or invalid coordinates
   */
  async assignZone(latitude: number, longitude: number): Promise<string> {
    // Validate coordinates
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new ZoneAssignmentError('Invalid coordinates', 'INVALID_COORDINATES', {
        latitude,
        longitude,
      });
    }

    // Get all active zones
    const zones = await this.getAllZones();

    if (zones.length === 0) {
      throw new ZoneAssignmentError(
        'No zones available for assignment — seed the database with zones first.',
        'NO_ZONES_AVAILABLE'
      );
    }

    // Find nearest zone
    let nearestZone = zones[0];
    let minDistance = this.calculateDistance(
      latitude,
      longitude,
      zones[0].centerLatitude,
      zones[0].centerLongitude
    );

    for (const zone of zones.slice(1)) {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        zone.centerLatitude,
        zone.centerLongitude
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestZone = zone;
      }
    }

    return nearestZone.id;
  }

  /**
   * Get all active zones
   *
   * Results are cached for 1 hour to reduce database queries.
   *
   * @returns Array of zones
   */
  private async getAllZones(): Promise<Zone[]> {
    // Try cache first
    try {
      const cachedData = await this.redisClient.get(ZONE_CACHE_KEY);
      if (cachedData) {
        return JSON.parse(cachedData);
      }
    } catch (cacheError) {
      console.warn('Zone cache read error:', cacheError);
    }

    // Query database
    const result = await this.pgPool.query<{
      id: string;
      name: string;
      center_latitude: number;
      center_longitude: number;
      radius_km: number | null;
    }>(
      `SELECT id, name, center_latitude, center_longitude, radius_km
       FROM zones
       WHERE is_active = true
       ORDER BY name ASC`
    );

    const zones: Zone[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      centerLatitude: Number(row.center_latitude),
      centerLongitude: Number(row.center_longitude),
      radiusKm: row.radius_km,
    }));

    if (zones.length === 0) {
      console.warn('Zone lookup returned zero records. Ensure zones are seeded.');
    }

    // Cache zones
    try {
      await this.redisClient.setEx(ZONE_CACHE_KEY, this.cacheTTL, JSON.stringify(zones));
    } catch (cacheError) {
      console.warn('Zone cache write error:', cacheError);
    }

    return zones;
  }

  /**
   * Calculate distance between two points using Haversine formula
   *
   * @param lat1 - First point latitude
   * @param lon1 - First point longitude
   * @param lat2 - Second point latitude
   * @param lon2 - Second point longitude
   * @returns Distance in kilometers
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers

    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Convert degrees to radians
   *
   * @param degrees - Angle in degrees
   * @returns Angle in radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Validate a zone ID exists
   *
   * @param zoneId - Zone ID to validate
   * @returns true if zone exists
   */
  async validateZoneId(zoneId: string): Promise<boolean> {
    if (!zoneId) {
      return false;
    }

    const zones = await this.getAllZones();
    return zones.some((zone) => zone.id === zoneId);
  }

  /**
   * Clear zone cache
   */
  async clearCache(): Promise<void> {
    try {
      await this.redisClient.del(ZONE_CACHE_KEY);
    } catch (error) {
      console.warn('Failed to clear zone cache:', error);
    }
  }
}
