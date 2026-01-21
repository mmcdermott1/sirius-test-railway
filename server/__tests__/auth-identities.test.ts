import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { storage } from '../storage';
import type { AuthProviderType } from '../../shared/schema';

describe('AuthIdentityStorage', () => {
  let testUserId: string;
  let testIdentityId: string;

  beforeAll(async () => {
    const testUser = await storage.users.createUser({
      email: 'test-auth-identity@example.com',
      firstName: 'Test',
      lastName: 'User',
      isActive: true,
    });
    testUserId = testUser.id;
  });

  afterAll(async () => {
    if (testIdentityId) {
      await storage.authIdentities.delete(testIdentityId);
    }
    if (testUserId) {
      await storage.users.deleteUser(testUserId);
    }
  });

  describe('create', () => {
    it('should create an auth identity', async () => {
      const identity = await storage.authIdentities.create({
        userId: testUserId,
        providerType: 'replit' as AuthProviderType,
        externalId: 'test-external-id-123',
        email: 'test-auth-identity@example.com',
        displayName: 'Test User',
      });

      expect(identity).toBeDefined();
      expect(identity.id).toBeDefined();
      expect(identity.userId).toBe(testUserId);
      expect(identity.providerType).toBe('replit');
      expect(identity.externalId).toBe('test-external-id-123');
      expect(identity.email).toBe('test-auth-identity@example.com');

      testIdentityId = identity.id;
    });
  });

  describe('getByProviderAndExternalId', () => {
    it('should find an identity by provider and external ID', async () => {
      const identity = await storage.authIdentities.getByProviderAndExternalId(
        'replit',
        'test-external-id-123'
      );

      expect(identity).toBeDefined();
      expect(identity?.userId).toBe(testUserId);
      expect(identity?.providerType).toBe('replit');
    });

    it('should return undefined for non-existent identity', async () => {
      const identity = await storage.authIdentities.getByProviderAndExternalId(
        'saml',
        'non-existent-id'
      );

      expect(identity).toBeUndefined();
    });
  });

  describe('updateLastUsed', () => {
    it('should update the last used timestamp', async () => {
      const beforeUpdate = await storage.authIdentities.getByProviderAndExternalId(
        'replit',
        'test-external-id-123'
      );
      const beforeLastUsed = beforeUpdate?.lastUsedAt;

      await new Promise(resolve => setTimeout(resolve, 10));

      await storage.authIdentities.updateLastUsed(testIdentityId);

      const afterUpdate = await storage.authIdentities.getByProviderAndExternalId(
        'replit',
        'test-external-id-123'
      );

      expect(afterUpdate?.lastUsedAt).toBeDefined();
      if (beforeLastUsed) {
        expect(afterUpdate?.lastUsedAt).not.toEqual(beforeLastUsed);
      }
    });
  });

  describe('getByUserId', () => {
    it('should find all identities for a user', async () => {
      const identities = await storage.authIdentities.getByUserId(testUserId);

      expect(identities).toBeDefined();
      expect(identities.length).toBeGreaterThan(0);
      expect(identities[0].userId).toBe(testUserId);
    });
  });

  describe('multiple providers for same user', () => {
    let samlIdentityId: string;

    it('should allow same user to have multiple auth providers', async () => {
      const samlIdentity = await storage.authIdentities.create({
        userId: testUserId,
        providerType: 'saml' as AuthProviderType,
        externalId: 'saml-external-id-456',
        email: 'test-auth-identity@example.com',
      });

      expect(samlIdentity).toBeDefined();
      expect(samlIdentity.providerType).toBe('saml');
      samlIdentityId = samlIdentity.id;

      const identities = await storage.authIdentities.getByUserId(testUserId);
      expect(identities.length).toBe(2);

      await storage.authIdentities.delete(samlIdentityId);
    });
  });
});
