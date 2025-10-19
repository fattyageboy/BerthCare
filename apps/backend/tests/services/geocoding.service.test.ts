import type { RedisClient } from '../../src/cache/redis-client';
import { GeocodingError, GeocodingService } from '../../src/services/geocoding.service';

const geocodeMock = jest.fn();

jest.mock('@googlemaps/google-maps-services-js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    geocode: geocodeMock,
  })),
}));

type RedisStub = Pick<RedisClient, 'get' | 'setEx' | 'del'> & {
  get: jest.Mock;
  setEx: jest.Mock;
  del: jest.Mock;
};

function createRedisStub(overrides: Partial<RedisStub> = {}): RedisStub {
  return {
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn(),
    del: jest.fn(),
    ...overrides,
  };
}

describe('GeocodingService', () => {
  const address = '123 Main St, Toronto, ON';

  beforeEach(() => {
    jest.clearAllMocks();
    geocodeMock.mockReset();
  });

  it('returns cached coordinates when available', async () => {
    const cachedResult = {
      latitude: 43.6532,
      longitude: -79.3832,
      formattedAddress: '123 Main St, Toronto, ON, Canada',
      placeId: 'cached-place-id',
    };
    const redis = createRedisStub({
      get: jest.fn().mockResolvedValue(JSON.stringify(cachedResult)),
    });

    const service = new GeocodingService(redis as unknown as RedisClient, 'api-key');
    const result = await service.geocodeAddress(address);

    expect(result).toEqual(cachedResult);
    expect(redis.get).toHaveBeenCalledWith('geocode:123 main st, toronto, on');
    expect(geocodeMock).not.toHaveBeenCalled();
  });

  it('fetches coordinates and caches the result when cache miss', async () => {
    const redis = createRedisStub();
    geocodeMock.mockResolvedValueOnce({
      data: {
        results: [
          {
            geometry: { location: { lat: 45.4215, lng: -75.6972 } },
            formatted_address: 'Ottawa, ON, Canada',
            place_id: 'ottawa-place-id',
          },
        ],
      },
    });

    const service = new GeocodingService(redis as unknown as RedisClient, 'api-key');
    const result = await service.geocodeAddress('Ottawa, ON');

    expect(result).toEqual({
      latitude: 45.4215,
      longitude: -75.6972,
      formattedAddress: 'Ottawa, ON, Canada',
      placeId: 'ottawa-place-id',
    });
    expect(geocodeMock).toHaveBeenCalledTimes(1);
    expect(redis.setEx).toHaveBeenCalledWith('geocode:ottawa, on', 86400, JSON.stringify(result));
  });

  it('validates coordinates stay within Canada', async () => {
    const redis = createRedisStub();
    geocodeMock.mockResolvedValueOnce({
      data: {
        results: [
          {
            geometry: { location: { lat: 10, lng: 10 } },
            formatted_address: 'Somewhere Else',
            place_id: 'elsewhere',
          },
        ],
      },
    });

    const service = new GeocodingService(redis as unknown as RedisClient, 'api-key');

    await expect(service.geocodeAddress(address)).rejects.toMatchObject<GeocodingError>({
      code: 'OUTSIDE_SERVICE_AREA',
    });
  });

  it('translates timeout errors into GeocodingError', async () => {
    const redis = createRedisStub();
    geocodeMock.mockRejectedValueOnce(new Error('timeout'));

    const service = new GeocodingService(redis as unknown as RedisClient, 'api-key');

    await expect(service.geocodeAddress(address)).rejects.toMatchObject<GeocodingError>({
      code: 'TIMEOUT',
    });
  });

  it('validates coordinates helper correctly', () => {
    const redis = createRedisStub();
    const service = new GeocodingService(redis as unknown as RedisClient, 'api-key');

    expect(service.validateCoordinates(45, -80)).toBe(true);
    expect(service.validateCoordinates(100, -80)).toBe(false);
  });

  it('clears cached entries', async () => {
    const redis = createRedisStub();
    const service = new GeocodingService(redis as unknown as RedisClient, 'api-key');

    await service.clearCache(address);

    expect(redis.del).toHaveBeenCalledWith('geocode:123 main st, toronto, on');
  });
});
