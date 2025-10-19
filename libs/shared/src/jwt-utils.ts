/**
 * JWT Token Generation Utilities
 *
 * Task A3: Implement JWT token generation
 * Create JWT utility module using jsonwebtoken; implement generateAccessToken() (1 hour expiry)
 * and generateRefreshToken() (30 days expiry); include user id, role, zone_id in payload;
 * use RS256 algorithm with key rotation support.
 *
 * Provides secure JWT token generation for authentication and authorization.
 *
 * Security Features:
 * - RS256 algorithm (asymmetric encryption)
 * - Key rotation support via environment variables
 * - Short-lived access tokens (1 hour)
 * - Long-lived refresh tokens (30 days)
 * - Comprehensive payload with user context
 *
 * Reference: project-documentation/task-plan.md - Phase A – Authentication & Authorization
 * Reference: Architecture Blueprint - JWT Authentication section
 *
 * Philosophy: "Uncompromising Security"
 * - Stateless authentication for horizontal scalability
 * - Industry-standard JWT patterns
 * - Clear separation between access and refresh tokens
 */

import { randomUUID } from 'crypto';

import jwt, { type JwtPayload } from 'jsonwebtoken';

import type { Permission } from './authorization';

type SecretsManagerGetSecretValueOutput =
  import('@aws-sdk/client-secrets-manager').GetSecretValueCommandOutput;

interface SecretsClient {
  send(command: unknown): Promise<SecretsManagerGetSecretValueOutput>;
}

/**
 * User role types
 * - caregiver: Home care workers who provide direct care to clients
 * - coordinator: Zone managers who handle alerts and oversight
 * - admin: System administrators with full access
 * - family: Authorized family members with limited access
 */
export type UserRole = 'caregiver' | 'coordinator' | 'admin' | 'family';

/**
 * JWT payload structure
 */
export interface JWTPayload extends JwtPayload {
  sub: string;
  userId?: string;
  role: UserRole;
  zoneId: string;
  email?: string;
  deviceId?: string;
  tokenId?: string;
  permissions?: Permission[];
}

/**
 * Token generation options
 */
interface TokenBaseOptions {
  userId: string;
  role: UserRole;
  zoneId: string;
  deviceId?: string;
  email?: string;
  permissions?: Permission[];
}

export type AccessTokenOptions = TokenBaseOptions;

export interface RefreshTokenOptions extends TokenBaseOptions {
  tokenId?: string;
}

/** Default device identifier used when a concrete device id is unavailable. */
export const DEFAULT_DEVICE_ID = 'unknown-device';

/**
 * Access token expiry: 1 hour
 * Short-lived for security - forces regular re-authentication
 */
export const ACCESS_TOKEN_EXPIRY = '1h';

/**
 * Refresh token expiry: 30 days
 * Long-lived for user convenience - allows staying logged in
 */
export const REFRESH_TOKEN_EXPIRY = '30d';

/**
 * JWT algorithm: RS256 (RSA Signature with SHA-256)
 * Asymmetric encryption allows:
 * - Private key for signing (backend only)
 * - Public key for verification (can be distributed)
 * - Key rotation without service disruption
 */
export const JWT_ALGORITHM = 'RS256';

// Key cache with TTL to support key rotation without requiring process restart
const KEY_CACHE_TTL = 1000 * 60 * 5; // 5 minutes

interface KeyEntry {
  kid: string;
  privateKey?: string;
  publicKey: string;
}

interface KeyConfig {
  activeKid: string;
  keys: Record<string, KeyEntry>;
}

interface ConfigCache {
  signature: string;
  config: KeyConfig;
  cachedAt: number;
}

interface EnvKeyMaterialSnapshot {
  json: string | null;
  keyId: string | null;
  privateKey: string | null;
  publicKey: string | null;
  publicKeySet: string | null;
}

let runtimeKeyConfig: KeyConfig | null = null;
let runtimeKeyConfigLoadedAt: number | null = null;
let envKeyCache: ConfigCache | null = null;
let envKeyCacheBuildInProgress = false;
let secretsManagerInitialization: Promise<void> | null = null;
let secretsManagerInitialized = false;

/**
 * Clear cached key configuration.
 * Primarily intended for test suites to ensure environment changes are picked up.
 */
export function clearJwtKeyCache(): void {
  runtimeKeyConfig = null;
  runtimeKeyConfigLoadedAt = null;
  envKeyCache = null;
}

function decodeKeyValue(rawValue: string, label: string): string {
  const value = rawValue.trim();
  if (!value) {
    throw new Error(`${label} is empty`);
  }

  if (value.startsWith('base64:')) {
    const base64Content = value.substring(7);
    return Buffer.from(base64Content, 'base64').toString('utf-8');
  }

  return value;
}

function mergeKeyEntry(
  existing: KeyEntry | undefined,
  incoming: Partial<KeyEntry>,
  kid: string
): KeyEntry {
  return {
    kid,
    privateKey: incoming.privateKey ?? existing?.privateKey,
    publicKey: incoming.publicKey ?? existing?.publicKey ?? '',
  };
}

function parseKeyEntry(kid: string, value: unknown, source: string): Partial<KeyEntry> {
  if (typeof value === 'string') {
    return {
      kid,
      publicKey: decodeKeyValue(value, `${source}.${kid}.publicKey`),
    };
  }

  if (!value || typeof value !== 'object') {
    throw new Error(`${source}.${kid} must be a string or object containing key material`);
  }

  const entryValue = value as Record<string, unknown>;
  const publicKeyCandidate =
    entryValue.publicKey ?? entryValue.key ?? entryValue.value ?? entryValue.pub;

  if (typeof publicKeyCandidate !== 'string') {
    throw new Error(`${source}.${kid}.publicKey must be defined`);
  }

  const privateKeyCandidate = entryValue.privateKey ?? entryValue.signingKey ?? entryValue.priv;

  const result: Partial<KeyEntry> = {
    kid,
    publicKey: decodeKeyValue(String(publicKeyCandidate), `${source}.${kid}.publicKey`),
  };

  if (typeof privateKeyCandidate === 'string') {
    result.privateKey = decodeKeyValue(privateKeyCandidate, `${source}.${kid}.privateKey`);
  }

  return result;
}

function parseKeySetFromJson(jsonValue: string, source: string): KeyConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonValue);
  } catch (error) {
    throw new Error(`${source} contains invalid JSON: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${source} must be a JSON object`);
  }

  const configObject = parsed as Record<string, unknown>;
  const activeKidValue =
    configObject.activeKid ??
    configObject.activeKey ??
    configObject.currentKid ??
    configObject.currentKey;

  if (typeof activeKidValue !== 'string' || !activeKidValue.trim()) {
    throw new Error(`${source} must include a non-empty "activeKid" property`);
  }

  const keysSection =
    configObject.keys ??
    configObject.keySet ??
    configObject.versions ??
    configObject.keyVersions ??
    {};

  if (!keysSection || typeof keysSection !== 'object') {
    throw new Error(`${source} must include a "keys" object containing key material`);
  }

  const keys: Record<string, KeyEntry> = {};

  Object.entries(keysSection as Record<string, unknown>).forEach(([kid, value]) => {
    const entry = parseKeyEntry(kid, value, `${source}.keys`);
    keys[kid] = mergeKeyEntry(keys[kid], entry, kid);
  });

  const previous = configObject.previous ?? configObject.previousKeys ?? configObject.oldKeys;

  if (Array.isArray(previous)) {
    previous.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`${source}.previous[${index}] must be an object`);
      }

      const entryObject = item as Record<string, unknown>;
      const kidValue = entryObject.kid ?? entryObject.keyId ?? entryObject.id;

      if (typeof kidValue !== 'string' || !kidValue.trim()) {
        throw new Error(`${source}.previous[${index}] is missing a kid/keyId`);
      }

      const entry = parseKeyEntry(kidValue, entryObject, `${source}.previous[${index}]`);
      keys[kidValue] = mergeKeyEntry(keys[kidValue], entry, kidValue);
    });
  }

  const activeKid = activeKidValue.trim();
  const activeEntry = keys[activeKid];

  if (!activeEntry) {
    throw new Error(`${source} is missing key material for active kid "${activeKid}"`);
  }

  if (!activeEntry.privateKey) {
    throw new Error(`${source} must include a privateKey for active kid "${activeKid}"`);
  }

  if (!activeEntry.publicKey) {
    throw new Error(`${source} must include a publicKey for active kid "${activeKid}"`);
  }

  return {
    activeKid,
    keys,
  };
}

function buildConfigFromEnv(snapshot?: EnvKeyMaterialSnapshot): KeyConfig {
  const keyIdRaw = snapshot?.keyId ?? process.env.JWT_KEY_ID;
  const activeKid = (keyIdRaw && keyIdRaw.trim()) || 'env-default';

  const privateKeyRaw = snapshot?.privateKey ?? process.env.JWT_PRIVATE_KEY;
  const publicKeyRaw = snapshot?.publicKey ?? process.env.JWT_PUBLIC_KEY;

  if (!publicKeyRaw) {
    throw new Error(
      'JWT_PUBLIC_KEY not configured. Set JWT_PUBLIC_KEY environment variable (optionally base64-encoded with "base64:" prefix).'
    );
  }

  const keys: Record<string, KeyEntry> = {
    [activeKid]: {
      kid: activeKid,
      publicKey: decodeKeyValue(publicKeyRaw, `JWT_PUBLIC_KEY (${activeKid})`),
      ...(privateKeyRaw && {
        privateKey: decodeKeyValue(privateKeyRaw, `JWT_PRIVATE_KEY (${activeKid})`),
      }),
    },
  };

  const publicKeySetRaw = snapshot?.publicKeySet ?? process.env.JWT_PUBLIC_KEY_SET;
  if (publicKeySetRaw) {
    let additional: unknown;
    try {
      additional = JSON.parse(publicKeySetRaw);
    } catch (error) {
      throw new Error(`JWT_PUBLIC_KEY_SET contains invalid JSON: ${(error as Error).message}`);
    }

    if (!additional || typeof additional !== 'object') {
      throw new Error('JWT_PUBLIC_KEY_SET must be a JSON object');
    }

    Object.entries(additional as Record<string, unknown>).forEach(([kid, value]) => {
      const entry = parseKeyEntry(kid, value, 'JWT_PUBLIC_KEY_SET');
      keys[kid] = mergeKeyEntry(keys[kid], entry, kid);
    });
  }

  return {
    activeKid,
    keys,
  };
}

function getKeyConfig(): KeyConfig {
  const now = Date.now();
  const secretArn = process.env.JWT_KEYS_SECRET_ARN;
  const currentRuntimeConfig = runtimeKeyConfig;
  const currentRuntimeLoadedAt = runtimeKeyConfigLoadedAt;

  const runtimeCacheFresh =
    currentRuntimeLoadedAt !== null && now - currentRuntimeLoadedAt < KEY_CACHE_TTL;
  const shouldUseRuntimeConfig = Boolean(currentRuntimeConfig) && (!secretArn || runtimeCacheFresh);

  if (shouldUseRuntimeConfig && currentRuntimeConfig) {
    return currentRuntimeConfig;
  }

  const envSnapshot: EnvKeyMaterialSnapshot = {
    json: process.env.JWT_KEYS_JSON ?? null,
    keyId: process.env.JWT_KEY_ID ?? null,
    privateKey: process.env.JWT_PRIVATE_KEY ?? null,
    publicKey: process.env.JWT_PUBLIC_KEY ?? null,
    publicKeySet: process.env.JWT_PUBLIC_KEY_SET ?? null,
  };

  const signature = JSON.stringify({
    json: envSnapshot.json ?? '',
    keyId: envSnapshot.keyId ?? '',
    privateKey: envSnapshot.privateKey ?? '',
    publicKey: envSnapshot.publicKey ?? '',
    publicKeySet: envSnapshot.publicKeySet ?? '',
  });

  const cachedSnapshot = envKeyCache;
  if (cachedSnapshot && cachedSnapshot.signature === signature) {
    const isFresh = now - cachedSnapshot.cachedAt < KEY_CACHE_TTL;
    if (isFresh) {
      return cachedSnapshot.config;
    }
  }

  if (envKeyCacheBuildInProgress) {
    const latestCache = envKeyCache;
    if (latestCache && latestCache.signature === signature) {
      const isFresh = now - latestCache.cachedAt < KEY_CACHE_TTL;
      if (isFresh) {
        return latestCache.config;
      }
    }
  }

  envKeyCacheBuildInProgress = true;

  try {
    const config = envSnapshot.json
      ? parseKeySetFromJson(envSnapshot.json, 'JWT_KEYS_JSON')
      : buildConfigFromEnv(envSnapshot);

    const newEntry: ConfigCache = {
      signature,
      config,
      cachedAt: now,
    };

    if (envKeyCache === cachedSnapshot) {
      envKeyCache = newEntry;
    } else {
      const latestCache = envKeyCache;
      const latestIsOutdated =
        !latestCache ||
        latestCache.signature !== signature ||
        now - latestCache.cachedAt >= KEY_CACHE_TTL;

      if (latestIsOutdated) {
        envKeyCache = newEntry;
      }
    }

    const finalCache = envKeyCache && envKeyCache.signature === signature ? envKeyCache : newEntry;

    return finalCache.config;
  } finally {
    envKeyCacheBuildInProgress = false;
  }
}

/**
 * Initialize JWT key store from AWS Secrets Manager.
 *
 * Secrets Manager payload must be JSON in the following format:
 * {
 *   "activeKid": "2024-rotation",
 *   "keys": {
 *     "2024-rotation": { "privateKey": "-----BEGIN...", "publicKey": "-----BEGIN..." },
 *     "2023-rotation": { "publicKey": "-----BEGIN..." }
 *   }
 * }
 */
export interface InitializeJwtKeyStoreOptions {
  secretArn?: string;
  region?: string;
  cacheResultMs?: number;
  client?: unknown;
}

export async function initializeJwtKeyStore(
  options: InitializeJwtKeyStoreOptions = {}
): Promise<void> {
  // Designed to run once during bootstrap; subsequent calls short-circuit.
  if (secretsManagerInitialized) {
    return;
  }

  if (secretsManagerInitialization) {
    await secretsManagerInitialization;
    return;
  }

  const initialize = async () => {
    const secretArn = options.secretArn ?? process.env.JWT_KEYS_SECRET_ARN;
    if (!secretArn) {
      return;
    }

    const region =
      options.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

    let client = options.client as SecretsClient | undefined;

    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );

    if (!client) {
      client = new SecretsManagerClient({ region }) as unknown as SecretsClient;
    }

    if (!client) {
      throw new Error('Failed to initialise Secrets Manager client for JWT key loading');
    }

    const command = new GetSecretValueCommand({ SecretId: secretArn });
    const response = await client.send(command);

    const secretString: string | undefined =
      response.SecretString ??
      (response.SecretBinary
        ? Buffer.from(response.SecretBinary as Uint8Array).toString('utf-8')
        : undefined);

    if (!secretString) {
      throw new Error(`Secrets Manager secret "${secretArn}" is empty`);
    }

    const config = parseKeySetFromJson(secretString, `SecretsManager:${secretArn}`);

    runtimeKeyConfig = config;
    runtimeKeyConfigLoadedAt = Date.now();
    envKeyCache = null;
    secretsManagerInitialized = true;
  };

  secretsManagerInitialization = initialize();

  try {
    await secretsManagerInitialization;
  } finally {
    secretsManagerInitialization = null;
  }
}

function getSigningKey(): { kid: string; key: string } {
  const config = getKeyConfig();
  const entry = config.keys[config.activeKid];

  if (!entry || !entry.privateKey) {
    throw new Error(
      'JWT_PRIVATE_KEY not configured. ' +
        'Set JWT_PRIVATE_KEY environment variable (optionally base64-encoded with "base64:" prefix).'
    );
  }

  return { kid: config.activeKid, key: entry.privateKey };
}

/* intentionally empty helper removed for rotation logic */

/**
 * Generate access token (1 hour expiry)
 *
 * Access tokens are short-lived and used for API authentication.
 * They contain user identity and authorization information.
 *
 * Token Payload:
 * - userId: Unique user identifier
 * - sub: Subject (mirror of userId for JWT spec compliance)
 * - role: User role (caregiver, coordinator, admin, family)
 * - zoneId: Geographic zone for data access control
 * - deviceId: Device identifier asserting session binding (defaults to unknown-device)
 * - email: User email (optional, for logging/debugging)
 * - iat: Issued at timestamp (automatic)
 * - exp: Expiration timestamp (automatic)
 *
 * @param options - User information for token payload
 * @returns Signed JWT access token
 * @throws Error if token generation fails
 *
 * @example
 * const accessToken = generateAccessToken({
 *   userId: 'user_123',
 *   role: 'caregiver',
 *   zoneId: 'zone_456',
 *   deviceId: 'device_789',
 *   email: 'caregiver@example.com'
 * });
 */
export function generateAccessToken(options: AccessTokenOptions): string {
  try {
    const { kid, key: privateKey } = getSigningKey();

    const deviceId = options.deviceId?.trim() || DEFAULT_DEVICE_ID;

    const payload: JWTPayload = {
      sub: options.userId,
      userId: options.userId,
      role: options.role,
      zoneId: options.zoneId,
      deviceId,
      ...(options.email && {
        email: options.email,
      }),
      ...(options.permissions &&
        options.permissions.length > 0 && {
          permissions: options.permissions,
        }),
    };

    const jwtId = randomUUID();

    const token = jwt.sign(payload, privateKey, {
      algorithm: JWT_ALGORITHM,
      expiresIn: ACCESS_TOKEN_EXPIRY,
      issuer: 'berthcare-api',
      audience: 'berthcare-app',
      jwtid: jwtId,
      keyid: kid,
    });

    return token;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Access token generation failed: ${errorMessage}`);
  }
}

/**
 * Generate refresh token (30 days expiry)
 *
 * Refresh tokens are long-lived and used to obtain new access tokens
 * without requiring the user to re-authenticate.
 *
 * Security Considerations:
 * - Store refresh tokens securely (httpOnly cookies or secure storage)
 * - Implement token rotation (issue new refresh token on use)
 * - Maintain blacklist for revoked tokens (Redis)
 * - Single-use refresh tokens for maximum security
 *
 * Token Payload:
 * - userId: Unique user identifier
 * - sub: Subject (mirror of userId)
 * - role: User role (for quick validation / audit)
 * - zoneId: Geographic zone
 * - deviceId: Device identifier that issued the token
 * - tokenId: Unique identifier for rotation and revocation tracking
 * - iat: Issued at timestamp (automatic)
 * - exp: Expiration timestamp (automatic)
 *
 * @param options - User information for token payload
 * @returns Signed JWT refresh token
 * @throws Error if token generation fails
 *
 * @example
 * const refreshToken = generateRefreshToken({
 *   userId: 'user_123',
 *   role: 'caregiver',
 *   zoneId: 'zone_456',
 *   deviceId: 'device_789'
 * });
 */
export function generateRefreshToken(options: RefreshTokenOptions): string {
  try {
    const { kid, key: privateKey } = getSigningKey();

    const tokenId = options.tokenId ?? randomUUID();
    const deviceId = options.deviceId?.trim() || DEFAULT_DEVICE_ID;

    const payload: JWTPayload = {
      sub: options.userId,
      userId: options.userId,
      role: options.role,
      zoneId: options.zoneId,
      deviceId,
      tokenId,
      ...(options.permissions &&
        options.permissions.length > 0 && {
          permissions: options.permissions,
        }),
    };

    const token = jwt.sign(payload, privateKey, {
      algorithm: JWT_ALGORITHM,
      expiresIn: REFRESH_TOKEN_EXPIRY,
      issuer: 'berthcare-api',
      audience: 'berthcare-app',
      jwtid: tokenId,
      keyid: kid,
    });

    return token;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Refresh token generation failed: ${errorMessage}`);
  }
}

/**
 * Verify and decode JWT token
 *
 * Validates token signature, expiration, and claims.
 * Use this for token verification in authentication middleware.
 *
 * @param token - JWT token to verify
 * @returns Decoded token payload
 * @throws Error if token is invalid or expired
 *
 * @example
 * try {
 *   const payload = verifyToken(token);
 *   console.log('User ID:', payload.userId);
 * } catch (error) {
 *   console.error('Invalid token:', error.message);
 * }
 */
export function verifyToken(token: string): JWTPayload {
  try {
    const decodedHeader = jwt.decode(token, { complete: true });
    const kid =
      typeof decodedHeader === 'object' && decodedHeader !== null
        ? (decodedHeader.header?.kid as string | undefined)
        : undefined;

    const config = getKeyConfig();
    const candidateKids: string[] = [];

    if (kid) {
      candidateKids.push(kid);
    }

    if (!kid || kid !== config.activeKid) {
      candidateKids.push(config.activeKid);
    }

    Object.keys(config.keys).forEach((candidate) => {
      if (!candidateKids.includes(candidate)) {
        candidateKids.push(candidate);
      }
    });

    let lastSignatureError: jwt.JsonWebTokenError | null = null;

    for (const candidateKid of candidateKids) {
      const entry = config.keys[candidateKid];
      if (!entry || !entry.publicKey) {
        continue;
      }

      try {
        const decoded = jwt.verify(token, entry.publicKey, {
          algorithms: [JWT_ALGORITHM],
          issuer: 'berthcare-api',
          audience: 'berthcare-app',
        }) as JWTPayload;

        if (!decoded.userId && decoded.sub) {
          decoded.userId = decoded.sub;
        }

        if (!decoded.deviceId) {
          decoded.deviceId = DEFAULT_DEVICE_ID;
        }

        return decoded;
      } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
          throw new Error('Token has expired');
        }

        if (error instanceof jwt.JsonWebTokenError) {
          lastSignatureError = error;
          continue;
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Token verification failed: ${errorMessage}`);
      }
    }

    if (kid && !config.keys[kid]) {
      throw new Error(`Invalid token: unknown key id ${kid}`);
    }

    if (lastSignatureError) {
      throw new Error(`Invalid token: ${lastSignatureError.message}`);
    }

    throw new Error('Token verification failed: Unable to validate token with available keys');
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error(`Invalid token: ${error.message}`);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Token verification failed: ${errorMessage}`);
  }
}

/**
 * Decode JWT token without verification
 *
 * Useful for debugging or extracting claims without validating signature.
 * DO NOT use for authentication - always verify tokens in production.
 *
 * @param token - JWT token to decode
 * @returns Decoded token payload or null if invalid
 *
 * @example
 * const payload = decodeToken(token);
 * if (payload) {
 *   console.log('Token expires at:', new Date(payload.exp! * 1000));
 * }
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload | null;
    if (decoded && !decoded.userId && decoded.sub) {
      decoded.userId = decoded.sub;
    }
    if (decoded && !decoded.deviceId) {
      decoded.deviceId = DEFAULT_DEVICE_ID;
    }
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Get token expiration time in seconds
 *
 * @param tokenType - 'access' or 'refresh'
 * @returns Expiration time in seconds
 */
export function getTokenExpiry(tokenType: 'access' | 'refresh'): number {
  if (tokenType === 'access') {
    // 1 hour = 3600 seconds
    return 3600;
  } else {
    // 30 days = 2592000 seconds
    return 2592000;
  }
}

/**
 * Check if token is expired
 *
 * @param token - JWT token to check
 * @returns True if token is expired, false otherwise
 */
export function isTokenExpired(token: string): boolean {
  try {
    const decoded = decodeToken(token);
    if (!decoded || !decoded.exp) {
      return true;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  } catch (error) {
    return true;
  }
}
