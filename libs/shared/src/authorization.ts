/**
 * Role and permission utilities shared across services.
 *
 * Provides strongly typed permission enums, default role-to-permission
 * mappings, and helper functions for evaluating authorization.
 *
 * Reference: project-documentation/architecture-output.md – Security,
 * role-based access control.
 */

import type { UserRole } from './jwt-utils';

/** Action-resource style permission identifiers (e.g., `create:visit`). */
export const ROLE_PERMISSIONS = {
  caregiver: [
    'read:clients',
    'read:care-plans',
    'read:visits',
    'read:schedules',
    'create:visit',
    'update:visit',
    'update:visit-documentation',
    'delete:visit-draft',
    'create:visit-note',
    'create:alert',
    'resolve:alert',
    'create:message',
  ],
  coordinator: [
    'read:clients',
    'read:care-plans',
    'read:visits',
    'read:schedules',
    'create:visit',
    'update:visit',
    'update:visit-documentation',
    'delete:visit-draft',
    'create:visit-note',
    'create:alert',
    'resolve:alert',
    'delete:alert',
    'create:client',
    'update:client',
    'create:care-plan',
    'update:care-plan',
    'create:schedule',
    'update:schedule',
    'create:user',
  ],
  admin: ['*'],
  family: ['read:clients', 'read:care-plans', 'read:visits', 'read:schedules', 'create:message'],
} as const satisfies Record<UserRole, readonly string[]>;

/** Literal union of all supported permission identifiers. */
export type Permission = (typeof ROLE_PERMISSIONS)[keyof typeof ROLE_PERMISSIONS][number];

/**
 * Minimal user information required for authorization checks.
 */
export interface AuthorizableUser {
  role: UserRole;
  zoneId?: string | null;
  permissions?: Permission[];
}

/**
 * Returns the default permission set for a role.
 *
 * @param role - User role
 */
export function getRolePermissions(role: UserRole): Permission[] {
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return [...permissions];
}

/**
 * Determines whether a user is in one of the allowed roles.
 *
 * @param user - Authenticated user context
 * @param allowedRoles - Role or roles that grant access
 */
export function hasRole(
  user: AuthorizableUser | undefined,
  allowedRoles: UserRole | UserRole[]
): boolean {
  if (!user) {
    return false;
  }

  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (roles.length === 0) {
    return false;
  }

  return roles.includes(user.role);
}

/**
 * Determines whether a user possesses all required permissions.
 *
 * Admins always satisfy permission checks.
 *
 * @param user - Authenticated user context
 * @param requiredPermissions - Permission or permissions that must be present
 */
export function hasPermission(
  user: AuthorizableUser | undefined,
  requiredPermissions: Permission | Permission[]
): boolean {
  if (!user) {
    return false;
  }

  const permissions = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  if (permissions.length === 0) {
    return false;
  }

  if (user.role === 'admin') {
    return true;
  }

  const effectivePermissions = new Set(user.permissions ?? getRolePermissions(user.role));

  if (effectivePermissions.has('*')) {
    return true;
  }

  return permissions.every((permission) => effectivePermissions.has(permission));
}
