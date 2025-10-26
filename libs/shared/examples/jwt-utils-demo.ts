/**
 * JWT Token Generation Utilities Demo
 *
 * Demonstrates the usage of JWT token generation and verification functions.
 * Run with: npx tsx libs/shared/examples/jwt-utils-demo.ts
 *
 * Prerequisites:
 * - Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY environment variables
 * - Or generate test keys with: pnpm run generate:keys
 */

import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,
  getTokenExpiry,
  isTokenExpired,
  type TokenOptions,
} from '../src/jwt-utils';

// Test RSA key pair (for demo only)
const DEMO_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA8vLyMdpSN1/EtweFz/U/uCkzVzDNsn1va9YLQm21AZiL6Pk0
v3TsUr7+ziKQtO5BORspLNofrUJo1Vv4WuWoLrPEa39L14T1jxA5AYa3AlXEZkKs
TsiAVxyWLeSanon8TXsuLCGPaZ7GlBRwKZB5I+9ThMV1kOWS/y9cQV8wyrYWA2PX
+779gZfDt6/T4WBawhlqmCkH+Qg7IFiS4LB8ebLOrWfPUGxfBTgLZmK9zfYmbZiQ
9eIvFcCQ6PSwnayM+yNDs9h3F0h44AqJlpgeGO83ig5lNViKL0at4Z7ezN6uS/oO
IpPznGYDtQkqwuXxloro/zQ1ENo3BwBmX/d2PQIDAQABAoIBAAgkA+GPwzl/yAOq
CN3TBfORzdqaFAprEZS3c2Eic/I9vlJsJ0xTCqgrJjaaCedGJIFZW6PZGz6e/wxH
LKc/Esed1nMTrOLn3aKRlJdsgC1f2lji2ws4xLQmjRG0m0m8reuauQ1ZgoizfUvw
82ExKh3+IvpL84iLaMWMPLckDWp9Zr+UYCXSe9REy1w4I3Bg/vc/S8J7kuJuOWu9
1vEYkYQpGGddrk49CYhTWBVgWpPKLNQV5N+VEGhCrMYkQ+60vYaEfeDNZsbTv7RQ
zr+Q0ju3g1exOF5rgGfPMIW4ZaCEEMBN21NiL7p8sd3cfxmQ0SDpXsoFvDCUaNUz
v1FIeAECgYEA/4mFhGDEqzZvUUfBBI2b2rzlNuyiGdX66Op+uJZMRtH+6WD37qN8
NScM0WpPsuObwwlHNyJd8nQubvyH8Wem8QZOQVABs+MGR3Ot9SEFwHngsT23VKzB
9bb/nMOxZwKNXu662wApY46MIXRDLLsc16z2XKncZQ8dHEXh6bM++b0CgYEA82OW
jDzxvEonF2PeEBU7e8uVxlkRupwpUQxvsHKM8I6vKrlPCqbz67DV2HGIFwXG9vI4
/crlsfwj9u2z2XGhU8QZ+dh/nPDRDYKvOXyd0ETbV0tXhhVtN0opL1IL2oo8pR7s
tRaVGYjn1OYJBx22IpIXJdFRfiJPW9lMlyJA9oECgYEAtBzJeDoAxTEUGzU5Li1l
6jJ0WVdHFnDFbsBB23dMgipnwzVu68xdstU4aq7FSDC3zCvQ/2KA13DefaoPY68M
cxxfshdja9ibx2cY+Qtyk20UW7lFbDBscfWvi14/v3yECqK4H76obZy+1qGs621j
cf1elIfBaZXSjegPyPpna/0CgYBLClNqXYfyk7JFxea7crBqVLSS+Pc8X9VlRb5R
2p+Vs4hSVdwG3r6p1lW4bBiXcJKNpNTpetsi6yhzg4pF6oDhAL85hwShcKYj0j0Q
LlnB0tkFqxcLIiQQPe9Axb0d3i0gg85bbuD9hHZl756s8P4s3noAkO7dQtrQ6Mhy
eH8rAQKBgHia7lz67OfRHdhMJHoEDa6+aIw2dzmr7bm1Dojfw+bApDH5zOvHl+HJ
j/gczsrP1aZMkSovNqpJnBPlLKOQbZyUQyvLuPaHFRuyl9gx7r04JSvzSQS96eSd
TPKMF96EYFbl9lKcWthx83dCUmPr1XzZZXKYa92UnDd9sJe8amDS
-----END RSA PRIVATE KEY-----`;

const DEMO_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8vLyMdpSN1/EtweFz/U/
uCkzVzDNsn1va9YLQm21AZiL6Pk0v3TsUr7+ziKQtO5BORspLNofrUJo1Vv4WuWo
LrPEa39L14T1jxA5AYa3AlXEZkKsTsiAVxyWLeSanon8TXsuLCGPaZ7GlBRwKZB5
I+9ThMV1kOWS/y9cQV8wyrYWA2PX+779gZfDt6/T4WBawhlqmCkH+Qg7IFiS4LB8
ebLOrWfPUGxfBTgLZmK9zfYmbZiQ9eIvFcCQ6PSwnayM+yNDs9h3F0h44AqJlpge
GO83ig5lNViKL0at4Z7ezN6uS/oOIpPznGYDtQkqwuXxloro/zQ1ENo3BwBmX/d2
PQIDAQAB
-----END PUBLIC KEY-----`;

async function demonstrateJWTUtils() {
  // Setup demo keys
  process.env.JWT_PRIVATE_KEY = DEMO_PRIVATE_KEY;
  process.env.JWT_PUBLIC_KEY = DEMO_PUBLIC_KEY;

  console.log('🔐 BerthCare JWT Token Generation Demo\n');
  console.log('='.repeat(70));

  // Configuration
  console.log('\n📋 Configuration:');
  console.log(`   Algorithm: RS256 (RSA with SHA-256)`);
  console.log(`   Access Token Expiry: ${getTokenExpiry('access')}s (1 hour)`);
  console.log(`   Refresh Token Expiry: ${getTokenExpiry('refresh')}s (30 days)`);

  // Example 1: User Login - Generate Tokens
  console.log('\n' + '='.repeat(70));
  console.log('Example 1: User Login - Generate Access & Refresh Tokens');
  console.log('='.repeat(70));

  const caregiverUser: TokenOptions = {
    userId: 'user_abc123',
    role: 'caregiver',
    zoneId: 'zone_toronto_west',
    email: 'sarah.johnson@berthcare.ca',
  };

  console.log('\n1. User logs in:');
  console.log(`   Email: ${caregiverUser.email}`);
  console.log(`   Role: ${caregiverUser.role}`);
  console.log(`   Zone: ${caregiverUser.zoneId}`);

  const accessToken = generateAccessToken(caregiverUser);
  const refreshToken = generateRefreshToken(caregiverUser);

  console.log('\n2. Tokens generated:');
  console.log(`   Access Token: ${accessToken.substring(0, 50)}...`);
  console.log(`   Refresh Token: ${refreshToken.substring(0, 50)}...`);

  // Example 2: Decode Token (Inspect Payload)
  console.log('\n' + '='.repeat(70));
  console.log('Example 2: Decode Token - Inspect Payload');
  console.log('='.repeat(70));

  const accessPayload = decodeToken(accessToken);
  console.log('\nAccess Token Payload:');
  console.log(`   User ID: ${accessPayload?.userId}`);
  console.log(`   Role: ${accessPayload?.role}`);
  console.log(`   Zone ID: ${accessPayload?.zoneId}`);
  console.log(`   Email: ${accessPayload?.email}`);
  console.log(`   Issued At: ${new Date(accessPayload!.iat! * 1000).toISOString()}`);
  console.log(`   Expires At: ${new Date(accessPayload!.exp! * 1000).toISOString()}`);

  // Example 3: Verify Token (Authentication)
  console.log('\n' + '='.repeat(70));
  console.log('Example 3: Verify Token - API Authentication');
  console.log('='.repeat(70));

  try {
    console.log('\n1. API receives request with access token');
    console.log('2. Middleware verifies token signature and expiration');

    const verifiedPayload = verifyToken(accessToken);

    console.log('3. ✅ Token is valid!');
    console.log(`   Authenticated User: ${verifiedPayload.userId}`);
    console.log(`   Role: ${verifiedPayload.role}`);
    console.log(`   Zone Access: ${verifiedPayload.zoneId}`);
    console.log('4. Request proceeds to route handler');
  } catch (error) {
    console.log('3. ❌ Token is invalid!');
    console.log(`   Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    console.log('4. Request rejected with 401 Unauthorized');
  }

  // Example 4: Token Expiration Check
  console.log('\n' + '='.repeat(70));
  console.log('Example 4: Token Expiration Check');
  console.log('='.repeat(70));

  const isExpired = isTokenExpired(accessToken);
  console.log(`\nAccess Token Expired: ${isExpired ? '❌ Yes' : '✅ No'}`);

  if (!isExpired) {
    const payload = decodeToken(accessToken);
    const expiresIn = payload!.exp! - Math.floor(Date.now() / 1000);
    console.log(`Time until expiration: ${expiresIn}s (~${Math.floor(expiresIn / 60)} minutes)`);
  }

  // Example 5: Token Refresh Flow
  console.log('\n' + '='.repeat(70));
  console.log('Example 5: Token Refresh Flow');
  console.log('='.repeat(70));

  console.log('\n1. Access token expires after 1 hour');
  console.log('2. Client sends refresh token to /auth/refresh endpoint');

  try {
    const refreshPayload = verifyToken(refreshToken);
    console.log('3. ✅ Refresh token is valid');

    // Generate new access token
    const newAccessToken = generateAccessToken({
      userId: refreshPayload.userId,
      role: refreshPayload.role,
      zoneId: refreshPayload.zoneId,
    });

    console.log('4. New access token generated');
    console.log(`   Token: ${newAccessToken.substring(0, 50)}...`);
    console.log('5. Client continues making API requests with new token');
  } catch (error) {
    console.log('3. ❌ Refresh token is invalid or expired');
    console.log('4. User must log in again');
  }

  // Example 6: Different User Roles
  console.log('\n' + '='.repeat(70));
  console.log('Example 6: Different User Roles');
  console.log('='.repeat(70));

  const users: TokenOptions[] = [
    {
      userId: 'user_001',
      role: 'caregiver',
      zoneId: 'zone_toronto',
      email: 'caregiver@example.com',
    },
    {
      userId: 'user_002',
      role: 'coordinator',
      zoneId: 'zone_toronto',
      email: 'coordinator@example.com',
    },
    { userId: 'user_003', role: 'admin', zoneId: 'zone_all', email: 'admin@example.com' },
  ];

  console.log('\nGenerating tokens for different roles:');
  users.forEach((user) => {
    const token = generateAccessToken(user);
    const payload = decodeToken(token);
    console.log(`\n${user.role.toUpperCase()}:`);
    console.log(`   User ID: ${payload?.userId}`);
    console.log(`   Zone Access: ${payload?.zoneId}`);
    console.log(`   Token: ${token.substring(0, 40)}...`);
  });

  // Example 7: Invalid Token Handling
  console.log('\n' + '='.repeat(70));
  console.log('Example 7: Invalid Token Handling');
  console.log('='.repeat(70));

  const invalidTokens = [
    { name: 'Malformed Token', token: 'invalid.token.here' },
    {
      name: 'Tampered Token',
      token: accessToken.substring(0, accessToken.length - 10) + 'TAMPERED',
    },
    { name: 'Empty Token', token: '' },
  ];

  console.log('\nTesting invalid tokens:');
  invalidTokens.forEach(({ name, token }) => {
    try {
      verifyToken(token);
      console.log(`\n${name}: ❌ Should have failed but didn't`);
    } catch (error) {
      console.log(`\n${name}: ✅ Correctly rejected`);
      console.log(`   Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  });

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('✅ Demo Complete - Key Takeaways');
  console.log('='.repeat(70));
  console.log('\n1. Access tokens are short-lived (1 hour) for security');
  console.log('2. Refresh tokens are long-lived (30 days) for convenience');
  console.log('3. RS256 algorithm allows key rotation without downtime');
  console.log('4. Tokens include user context (id, role, zone) for authorization');
  console.log('5. Always verify tokens on the server side');
  console.log('6. Store refresh tokens securely (httpOnly cookies)');
}

// Run the demo
demonstrateJWTUtils().catch((error) => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});
