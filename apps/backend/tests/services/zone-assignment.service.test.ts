import type { Pool } from 'pg';

import {
  ZoneAssignmentError,
  ZoneAssignmentService,
} from '../../src/services/zone-assignment.service';
import type { RedisClient } from '../../src/cache/redis-client';

type RedisStub = Pick<RedisClient, 'get' | 'setEx' | 'del'> & {
  get: jest.Mock;
  setEx: jest.Mock;
  del: jest.Mock;
};

type PoolStub = Pick<Pool, 'query'> & { query: jest.Mock };

function createRedisStub(overrides: Partial<RedisStub> = {}): RedisStub {
  return {
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn(),
    del: jest.fn(),
    ...overrides,
  };
}

function createPoolStub(overrides: Partial<PoolStub> = {}): PoolStub {
  return {
    query: jest.fn(),
    ...overrides,
  };
}

describe('ZoneAssignmentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns nearest zone using cached data', async () => {
    const cachedZones = [
      {
        id: 'zone-a',
        name: 'Zone A',
        region: 'East',
        centerLatitude: 43.7,
        centerLongitude: -79.4,
      },
      {
        id: 'zone-b',
        name: 'Zone B',
        region: 'West',
        centerLatitude: 43.65,
        centerLongitude: -79.38,
      },
    ];

    const redis = createRedisStub({
      get: jest.fn().mockResolvedValue(JSON.stringify(cachedZones)),
    });
    const pool = createPoolStub();

    const service = new ZoneAssignmentService(
      pool as unknown as Pool,
      redis as unknown as RedisClient
    );

    const zoneId = await service.assignZone(43.651, -79.383);

    expect(zoneId).toBe('zone-b');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('retrieves zones from database when cache miss and caches result', async () => {
    const redis = createRedisStub();
    const pool = createPoolStub({
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'zone-1',
            name: 'Zone 1',
            region: 'North',
            center_latitude: '43.7',
            center_longitude: '-79.4',
          },
          {
            id: 'zone-2',
            name: 'Zone 2',
            region: 'South',
            center_latitude: 43.6,
            center_longitude: -79.3,
          },
        ],
      }),
    });

    const service = new ZoneAssignmentService(
      pool as unknown as Pool,
      redis as unknown as RedisClient
    );

    const zoneId = await service.assignZone(43.61, -79.31);

    expect(zoneId).toBe('zone-2');
    expect(redis.setEx).toHaveBeenCalledWith(
      'zones:all',
      3600,
      JSON.stringify([
        {
          id: 'zone-1',
          name: 'Zone 1',
          region: 'North',
          centerLatitude: 43.7,
          centerLongitude: -79.4,
        },
        {
          id: 'zone-2',
          name: 'Zone 2',
          region: 'South',
          centerLatitude: 43.6,
          centerLongitude: -79.3,
        },
      ])
    );
  });

  it('throws when no zones are available', async () => {
    const redis = createRedisStub({
      get: jest.fn().mockResolvedValue(null),
    });
    const pool = createPoolStub({
      query: jest.fn().mockResolvedValue({ rows: [] }),
    });

    const service = new ZoneAssignmentService(
      pool as unknown as Pool,
      redis as unknown as RedisClient
    );

    await expect(service.assignZone(43.7, -79.4)).rejects.toMatchObject<ZoneAssignmentError>({
      code: 'NO_ZONES_AVAILABLE',
    });
  });

  it('validates coordinate bounds', async () => {
    const redis = createRedisStub();
    const pool = createPoolStub();
    const service = new ZoneAssignmentService(
      pool as unknown as Pool,
      redis as unknown as RedisClient
    );

    await expect(service.assignZone(200, -79.4)).rejects.toMatchObject<ZoneAssignmentError>({
      code: 'INVALID_COORDINATES',
    });
  });

  it('validates zone ID existence', async () => {
    const redis = createRedisStub();
    const pool = createPoolStub({
      query: jest.fn().mockResolvedValueOnce({ rowCount: 1 }),
    });

    const service = new ZoneAssignmentService(
      pool as unknown as Pool,
      redis as unknown as RedisClient
    );

    await expect(service.validateZoneId('zone-123')).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('SELECT 1'), ['zone-123']);
  });

  it('clears cached zones', async () => {
    const redis = createRedisStub();
    const pool = createPoolStub();
    const service = new ZoneAssignmentService(
      pool as unknown as Pool,
      redis as unknown as RedisClient
    );

    await service.clearCache();

    expect(redis.del).toHaveBeenCalledWith('zones:all');
  });
});
