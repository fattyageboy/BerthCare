/**
 * Protected Route Examples
 *
 * Demonstrates how to use JWT authentication middleware to protect routes.
 *
 * This file is for documentation purposes only - not used in production.
 */

import { Router } from 'express';

import { RedisClient } from '../../cache/redis-client';
import { authenticateJWT, authorize, AuthenticatedRequest } from '../auth';

export function createProtectedRoutes(redisClient: RedisClient): Router {
  const router = Router();

  /**
   * Example 1: Basic Protected Route
   *
   * Any authenticated user can access this route.
   * The middleware verifies the JWT token and attaches user info to req.user.
   */
  router.get('/profile', authenticateJWT(redisClient), async (req: AuthenticatedRequest, res) => {
    // Access user information from req.user
    const { userId, role, zoneId, email } = req.user!;

    res.json({
      data: {
        userId,
        role,
        zoneId,
        email,
      },
    });
  });

  /**
   * Example 2: Role-Based Access Control
   *
   * Only coordinators and admins can access this route.
   * Caregivers will receive a 403 Forbidden error.
   */
  router.get(
    '/reports',
    authenticateJWT(redisClient),
    authorize(['coordinator', 'admin'], ['read:visits']),
    async (req: AuthenticatedRequest, res) => {
      const { zoneId, role } = req.user!;

      // Admins can see all zones, coordinators only their zone
      const reports =
        role === 'admin'
          ? await getAllReports() // Hypothetical function
          : await getReportsForZone(zoneId); // Hypothetical function

      res.json({ data: reports });
    }
  );

  /**
   * Example 3: Admin-Only Route
   *
   * Only admins can access this route.
   * All other roles will receive a 403 Forbidden error.
   */
  router.post(
    '/users',
    authenticateJWT(redisClient),
    authorize(['admin'], ['create:user']),
    async (req: AuthenticatedRequest, res) => {
      const { body } = req;

      // Create new user (admin only)
      const newUser = await createUser(body); // Hypothetical function

      res.status(201).json({ data: newUser });
    }
  );

  /**
   * Example 4: Zone-Based Data Access
   *
   * Users can only access data from their assigned zone.
   * Admins can access all zones.
   */
  router.get('/clients', authenticateJWT(redisClient), async (req: AuthenticatedRequest, res) => {
    const { zoneId, role } = req.user!;

    // Filter by zone unless admin
    const clients =
      role === 'admin'
        ? await getAllClients() // Hypothetical function
        : await getClientsForZone(zoneId); // Hypothetical function

    res.json({ data: clients });
  });

  /**
   * Example 5: Multiple Middleware Layers
   *
   * Demonstrates proper middleware ordering:
   * 1. Rate limiting (not shown here, but would go first)
   * 2. Validation (not shown here)
   * 3. Authentication
   * 4. Authorization
   * 5. Business logic
   */
  router.patch(
    '/clients/:clientId',
    // Rate limiting would go here
    // Validation would go here
    authenticateJWT(redisClient),
    authorize(['coordinator', 'admin'], ['read:visits']),
    async (req: AuthenticatedRequest, res) => {
      const { clientId } = req.params;
      const { zoneId, role } = req.user!;

      // Verify user has access to this client
      const client = await getClient(clientId); // Hypothetical function

      if (role !== 'admin' && client.zoneId !== zoneId) {
        res.status(403).json({
          error: {
            code: 'AUTH_ZONE_ACCESS_DENIED',
            message: 'You do not have access to this client',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
        return;
      }

      // Update client
      const updatedClient = await updateClient(clientId, req.body); // Hypothetical function

      res.json({ data: updatedClient });
    }
  );

  /**
   * Example 6: Conditional Authorization
   *
   * Different logic based on user role.
   */
  router.get('/visits', authenticateJWT(redisClient), async (req: AuthenticatedRequest, res) => {
    const { userId, role, zoneId } = req.user!;

    let visits;

    switch (role) {
      case 'caregiver':
        // Caregivers only see their own visits
        visits = await getVisitsForCaregiver(userId); // Hypothetical function
        break;

      case 'coordinator':
        // coordinators see all visits in their zone
        visits = await getVisitsForZone(zoneId); // Hypothetical function
        break;

      case 'admin':
        // Admins see all visits
        visits = await getAllVisits(); // Hypothetical function
        break;

      default:
        res.status(403).json({
          error: {
            code: 'AUTH_INSUFFICIENT_ROLE',
            message: 'Invalid role',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
        return;
    }

    res.json({ data: visits });
  });

  return router;
}

// Hypothetical functions (not implemented)
async function getAllReports() {
  return [];
}
async function getReportsForZone(_zoneId: string) {
  return [];
}
async function createUser(_data: unknown) {
  return {};
}
async function getAllClients() {
  return [];
}
async function getClientsForZone(_zoneId: string) {
  return [];
}
async function getClient(_clientId: string) {
  return { zoneId: 'zone_123' };
}
async function updateClient(_clientId: string, _data: unknown) {
  return {};
}
async function getVisitsForCaregiver(_userId: string) {
  return [];
}
async function getVisitsForZone(_zoneId: string) {
  return [];
}
async function getAllVisits() {
  return [];
}
