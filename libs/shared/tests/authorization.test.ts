import { getRolePermissions, hasPermission, hasRole, ROLE_PERMISSIONS } from '../src/authorization';

describe('authorization utilities', () => {
  describe('getRolePermissions', () => {
    it('returns a copy of the default permissions for a role', () => {
      const caregiverPermissions = getRolePermissions('caregiver');

      expect(caregiverPermissions).toEqual(ROLE_PERMISSIONS.caregiver);
      expect(caregiverPermissions).not.toBe(ROLE_PERMISSIONS.caregiver);

      const originalLength = ROLE_PERMISSIONS.caregiver.length;
      caregiverPermissions.pop();

      expect(ROLE_PERMISSIONS.caregiver.length).toBe(originalLength);
    });

    it('returns an empty array for unknown roles', () => {
      expect(
        // @ts-expect-error – verifying defensive behavior for unexpected role
        getRolePermissions('unknown')
      ).toEqual([]);
    });
  });

  describe('hasRole', () => {
    it('returns false when user is undefined', () => {
      expect(hasRole(undefined, 'caregiver')).toBe(false);
    });

    it('returns false when user is undefined and no roles are allowed', () => {
      expect(hasRole(undefined, [])).toBe(false);
    });

    it('returns true when user role matches a single allowed role', () => {
      expect(hasRole({ role: 'coordinator' }, 'coordinator')).toBe(true);
      expect(hasRole({ role: 'coordinator' }, 'caregiver')).toBe(false);
    });

    it('returns true when user role matches any allowed roles', () => {
      expect(hasRole({ role: 'admin' }, ['caregiver', 'admin'])).toBe(true);
      expect(hasRole({ role: 'family' }, ['caregiver', 'coordinator'])).toBe(false);
    });

    it('returns false when allowed roles is empty', () => {
      expect(hasRole({ role: 'family' }, [])).toBe(false);
    });
  });

  describe('hasPermission', () => {
    const user = { role: 'coordinator', zoneId: 'zone-1' } as const;

    it('returns false when user is undefined', () => {
      expect(hasPermission(undefined, 'read:clients')).toBe(false);
    });

    it('returns true for admin users regardless of permissions', () => {
      expect(hasPermission({ role: 'admin' }, ['create:client', 'delete:alert'])).toBe(true);
    });

    it('returns true when user has explicit permissions', () => {
      expect(hasPermission({ ...user, permissions: ['create:client'] }, 'create:client')).toBe(
        true
      );
    });

    it('returns true when user has wildcard permission', () => {
      expect(hasPermission({ ...user, permissions: ['*'] }, ['delete:alert'])).toBe(true);
    });

    it('falls back to default role permissions when explicit set not provided', () => {
      expect(hasPermission(user, ['read:clients', 'read:care-plans'])).toBe(true);
      expect(hasPermission(user, ['create:user'])).toBe(true);
    });

    it('returns false when required permissions are missing', () => {
      expect(hasPermission(user, ['create:message'])).toBe(false);
    });

    it('returns false when required permissions array is empty', () => {
      expect(hasPermission(user, [])).toBe(false);
    });
  });
});
