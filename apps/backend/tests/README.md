# Backend Integration Tests

Integration tests for the BerthCare backend API endpoints.

## Overview

These tests verify the complete functionality of API endpoints including:

- Request validation
- Database operations
- Authentication and authorization
- Rate limiting
- Error handling
- Security measures

## Test Structure

```
tests/
├── setup.ts                    # Global test configuration
├── auth.register.test.ts       # Registration endpoint tests
└── README.md                   # This file
```

## Prerequisites

Before running tests, ensure you have:

1. **PostgreSQL test database** running:

   ```bash
   # Database should be available at (set these env vars first):
   # postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}_test
   ```

2. **Redis test instance** running:

   ```bash
   # Redis should be available at (set REDIS_PASSWORD/REDIS_PORT/REDIS_DB):
   # redis://:${REDIS_PASSWORD}@${REDIS_HOST:-localhost}:${REDIS_PORT:-6379}/${REDIS_DB:-1}
   ```

3. **Environment variables** configured in `.env` file

4. **Dependencies installed**:
   ```bash
   npm install
   ```

## Running Tests

### Run all tests

```bash
npm test
```

### Run tests in watch mode

```bash
npm run test:watch
```

### Run tests with coverage

```bash
npm run test:coverage
```

### Run specific test file

```bash
npm test -- auth.register.test.ts
```

### Run specific test suite

```bash
npm test -- --testNamePattern="Successful Registration"
```

## Worker Isolation & Parallelism

- Jest workers derive an isolated PostgreSQL schema and Redis logical database from `JEST_WORKER_ID`. The default Redis ceiling is 16 logical DBs (`0-15`); override with `TEST_REDIS_DB_LIMIT` if your Redis deployment exposes a different count.
- `tests/setup.ts` flushes the worker-specific Redis DB before the first suite and again at global teardown. Each suite still calls `flushDb` in `setupTestConnections` to ensure clean state between tests.
- PostgreSQL schemas are created per worker with unique suffixes and dropped after each suite; any leftover schemas with the `test_schema_w{worker}_*` prefix are removed automatically during teardown.
- CI pipelines must ensure `JEST_WORKER_ID` is exported when invoking Jest manually. Jest sets this automatically per worker, so explicit exports are only required when overriding the worker count or running through custom wrappers.

## Test Database Setup

The tests automatically create required tables if they don't exist. However, for best results:

1. **Create a dedicated test database**:

   ```sql
   CREATE DATABASE berthcare_test;
   ```

2. **Run migrations on test database**:

   ```bash
   # Ensure DATABASE_URL is exported prior to running this command
   # e.g. DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}_test"
   DATABASE_URL="${DATABASE_URL}" npm run migrate:up
   ```

3. **Tests will clean up data** between runs (DELETE operations, not DROP)

## Test Coverage

Current test coverage for registration endpoint:

- ✅ Successful registration (caregiver, coordinator, admin)
- ✅ Duplicate email validation (409 error)
- ✅ Email format validation
- ✅ Password strength validation (min 8 chars, 1 uppercase, 1 number)
- ✅ Required field validation
- ✅ Rate limiting (5 attempts per hour per IP)
- ✅ Password hashing security
- ✅ Refresh token hashing security
- ✅ JWT token generation and validation

## Writing New Tests

### Test Structure

```typescript
describe('Feature Name', () => {
  // Setup before all tests
  beforeAll(async () => {
    // Initialize connections
  });

  // Cleanup after all tests
  afterAll(async () => {
    // Close connections
  });

  // Clean state before each test
  beforeEach(async () => {
    // Clear database and Redis
  });

  describe('Specific Scenario', () => {
    it('should do something specific', async () => {
      const response = await request(app).post('/v1/endpoint').send({ data });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ expected });
    });
  });
});
```

### Best Practices

1. **Isolation**: Each test should be independent and not rely on other tests
2. **Cleanup**: Always clean database state between tests
3. **Descriptive names**: Use clear, descriptive test names
4. **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification
5. **Error cases**: Test both success and failure scenarios
6. **Edge cases**: Test boundary conditions and edge cases

## Debugging Tests

### Enable verbose output

```bash
npm test -- --verbose
```

### Run single test

```bash
npm test -- --testNamePattern="should register a new caregiver successfully"
```

### Debug with Node inspector

```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

Then open `chrome://inspect` in Chrome and click "inspect"

## Continuous Integration

Tests are designed to run in CI/CD pipelines:

- Tests use environment variables for configuration
- Database and Redis connections are configurable
- Tests clean up after themselves
- Exit codes indicate success/failure

## Troubleshooting

### "Connection refused" errors

- Ensure PostgreSQL and Redis are running
- Check connection strings in `.env` file
- Verify network connectivity

### "Table does not exist" errors

- Run migrations on test database
- Check database permissions
- Verify test database exists

### "Rate limit exceeded" errors

- Tests clean Redis between runs
- If running tests multiple times quickly, wait or flush Redis manually:
  ```bash
  REDISCLI_AUTH="${REDIS_PASSWORD}" redis-cli -n "${REDIS_DB:-1}" FLUSHDB
  ```

### Timeout errors

- Increase Jest timeout in `setup.ts`
- Check database query performance
- Verify network latency

## Reference

- Task: A4 - Registration endpoint implementation
- Architecture: `project-documentation/architecture-output.md`
- API Spec: Authentication Endpoints section
