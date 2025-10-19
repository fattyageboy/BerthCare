/**
 * Geocoding Service
 *
 * Converts addresses to geographic coordinates using Google Maps Geocoding API.
 *
 * Features:
 * - Address to lat/long conversion
 * - Result caching (24 hour TTL)
 * - Error handling and retry logic
 * - Canadian address validation
 *
 * Reference: Architecture Blueprint - Client Management
 * Task: C5 - Create client endpoint with geocoding
 *
 * Philosophy: "Obsess over details"
 * - Cache results to reduce API calls
 * - Validate coordinates are in service area
 * - Clear error messages for debugging
 */

import { Client, GeocodeResult } from '@googlemaps/google-maps-services-js';

import { RedisClient } from '../cache/redis-client';

/**
 * Geocoding result
 */
export interface GeocodingResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  placeId: string;
}

/**
 * Geocoding error
 */
export class GeocodingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'GeocodingError';
  }
}

/**
 * Geocoding Service
 *
 * Handles address geocoding with caching and error handling.
 */
export class GeocodingService {
  private client: Client;
  private apiKey: string;
  private cacheTTL: number;

  constructor(
    private redisClient: RedisClient,
    apiKey?: string,
    cacheTTL: number = 86400 // 24 hours default
  ) {
    this.client = new Client({});
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || '';
    this.cacheTTL = cacheTTL;

    if (!this.apiKey) {
      console.warn('Google Maps API key not configured. Geocoding will fail.');
    }
  }

  /**
   * Geocode an address to latitude/longitude
   *
   * @param address - Full street address to geocode
   * @returns Geocoding result with coordinates and formatted address
   * @throws GeocodingError if geocoding fails
   */
  async geocodeAddress(address: string): Promise<GeocodingResult> {
    // Validate input
    if (!address || typeof address !== 'string' || address.trim().length === 0) {
      throw new GeocodingError('Address is required', 'INVALID_ADDRESS');
    }

    if (!this.apiKey) {
      throw new GeocodingError('Google Maps API key not configured', 'CONFIGURATION_ERROR');
    }

    const normalizedAddress = address.trim().toLowerCase();

    // Check cache first
    const cacheKey = `geocode:${normalizedAddress}`;
    try {
      const cachedResult = await this.redisClient.get(cacheKey);
      if (cachedResult) {
        return JSON.parse(cachedResult);
      }
    } catch (cacheError) {
      // Log but continue if cache fails
      console.warn('Geocoding cache read error:', cacheError);
    }

    // Call Google Maps Geocoding API
    try {
      const response = await this.client.geocode({
        params: {
          address: address,
          key: this.apiKey,
          region: 'ca', // Bias results to Canada
        },
        timeout: 5000, // 5 second timeout
      });

      // Check if we got results
      if (!response.data.results || response.data.results.length === 0) {
        throw new GeocodingError('Address not found', 'ADDRESS_NOT_FOUND', { address });
      }

      // Get first result (most relevant)
      const result: GeocodeResult = response.data.results[0];

      // Validate result has coordinates
      if (!result.geometry || !result.geometry.location) {
        throw new GeocodingError('Invalid geocoding response', 'INVALID_RESPONSE', { address });
      }

      // Validate coordinates are in Canada (approximate bounds)
      // Canada latitude: 41.7°N to 83.1°N
      // Canada longitude: -141.0°W to -52.6°W
      const lat = result.geometry.location.lat;
      const lng = result.geometry.location.lng;

      if (lat < 41.7 || lat > 83.1 || lng < -141.0 || lng > -52.6) {
        throw new GeocodingError(
          'Address is outside service area (Canada)',
          'OUTSIDE_SERVICE_AREA',
          { address, latitude: lat, longitude: lng }
        );
      }

      // Build result
      const geocodingResult: GeocodingResult = {
        latitude: lat,
        longitude: lng,
        formattedAddress: result.formatted_address || address,
        placeId: result.place_id || '',
      };

      // Cache result
      try {
        await this.redisClient.setEx(cacheKey, this.cacheTTL, JSON.stringify(geocodingResult));
      } catch (cacheError) {
        // Log but don't fail if caching fails
        console.warn('Geocoding cache write error:', cacheError);
      }

      return geocodingResult;
    } catch (error) {
      // Handle Google Maps API errors
      if (error instanceof GeocodingError) {
        throw error;
      }

      // Handle network/timeout errors
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new GeocodingError('Geocoding request timed out', 'TIMEOUT', { address });
        }

        if (error.message.includes('OVER_QUERY_LIMIT')) {
          throw new GeocodingError('Geocoding API quota exceeded', 'QUOTA_EXCEEDED', { address });
        }

        if (error.message.includes('REQUEST_DENIED')) {
          throw new GeocodingError(
            'Geocoding API request denied (check API key)',
            'REQUEST_DENIED',
            { address }
          );
        }
      }

      // Generic error
      throw new GeocodingError('Failed to geocode address', 'GEOCODING_FAILED', {
        address,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Validate coordinates are within service area
   *
   * @param latitude - Latitude to validate
   * @param longitude - Longitude to validate
   * @returns true if coordinates are in Canada
   */
  validateCoordinates(latitude: number, longitude: number): boolean {
    // Canada approximate bounds
    return latitude >= 41.7 && latitude <= 83.1 && longitude >= -141.0 && longitude <= -52.6;
  }

  /**
   * Clear geocoding cache for an address
   *
   * @param address - Address to clear from cache
   */
  async clearCache(address: string): Promise<void> {
    const normalizedAddress = address.trim().toLowerCase();
    const cacheKey = `geocode:${normalizedAddress}`;

    try {
      await this.redisClient.del(cacheKey);
    } catch (error) {
      console.warn('Failed to clear geocoding cache:', error);
    }
  }
}
