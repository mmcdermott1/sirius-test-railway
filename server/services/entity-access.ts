/**
 * Entity Access Evaluation Service
 * 
 * Evaluates entity access policies on-demand with caching.
 * Caches results both server-side (LRU) and provides data for client-side caching.
 */

import { 
  EntityAccessPolicy, 
  EntityAccessCondition, 
  EntityAccessRule,
  EntityAccessResult,
  LinkagePredicate,
  buildCacheKey,
  entityAccessPolicyRegistry
} from '@shared/entityAccessPolicies';
import { logger } from '../logger';
import type { User } from '@shared/schema';

const SERVICE = 'entity-access';

/**
 * LRU Cache for access results
 * Key: userId:policyId:entityId
 * Value: { granted: boolean, evaluatedAt: number }
 */
class AccessCache {
  private cache = new Map<string, EntityAccessResult>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 10000, ttlMs = 5 * 60 * 1000) { // 5 minute TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): EntityAccessResult | undefined {
    const result = this.cache.get(key);
    if (!result) return undefined;
    
    // Check if expired
    if (Date.now() - result.evaluatedAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    
    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, result);
    
    return result;
  }

  set(key: string, result: EntityAccessResult): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, result);
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern: { userId?: string; policyId?: string; entityId?: string }): number {
    let count = 0;
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      const parts = key.split(':');
      if (parts.length !== 3) continue;
      
      const [userId, policyId, entityId] = parts;
      
      const match = 
        (!pattern.userId || userId === pattern.userId) &&
        (!pattern.policyId || policyId === pattern.policyId) &&
        (!pattern.entityId || entityId === pattern.entityId);
      
      if (match) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  stats(): { size: number; maxSize: number; ttlMs: number } {
    return { size: this.cache.size, maxSize: this.maxSize, ttlMs: this.ttlMs };
  }
}

// Singleton cache instance
const accessCache = new AccessCache();

/**
 * Linkage resolver context
 */
interface LinkageContext {
  userId: string;
  userEmail: string;
  entityType: string;
  entityId: string;
}

/**
 * Linkage resolver function type
 */
type LinkageResolver = (ctx: LinkageContext, storage: any) => Promise<boolean>;

/**
 * Registry of linkage resolvers
 */
const linkageResolvers: Record<LinkagePredicate, LinkageResolver> = {
  /**
   * ownsWorker: User's email matches worker's contact email
   */
  ownsWorker: async (ctx, storage) => {
    if (ctx.entityType !== 'worker') return false;
    
    const worker = await storage.workers.getWorker(ctx.entityId);
    if (!worker) return false;
    
    const contact = await storage.contacts.getContact(worker.contactId);
    if (!contact?.email) return false;
    
    return ctx.userEmail.toLowerCase() === contact.email.toLowerCase();
  },

  /**
   * workerBenefitProvider: User is a provider contact for a benefit the worker receives
   */
  workerBenefitProvider: async (ctx, storage) => {
    if (ctx.entityType !== 'worker') return false;
    
    // Find contact by user email
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    // Get provider contacts for this contact
    const providerContacts = await storage.trustProviderContacts?.getByContactId?.(contact.id);
    if (!providerContacts || providerContacts.length === 0) return false;
    
    // Get worker's active benefits
    const workerBenefits = await storage.trustWmb?.getActiveByWorker?.(ctx.entityId);
    if (!workerBenefits || workerBenefits.length === 0) return false;
    
    // Check if any benefit's provider matches user's provider contacts
    const userProviderIds = providerContacts.map((pc: any) => pc.providerId);
    return workerBenefits.some((wb: any) => userProviderIds.includes(wb.providerId));
  },

  /**
   * workerEmploymentHistory: User (as worker) has employment history at this employer
   */
  workerEmploymentHistory: async (ctx, storage) => {
    if (ctx.entityType !== 'employer') return false;
    
    // Find contact by user email
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    // Find worker by contact (scoped lookup instead of listing all workers)
    const userWorker = await storage.workers.getWorkerByContactId?.(contact.id);
    if (!userWorker) return false;
    
    // Check if worker has employment at this employer
    const employments = await storage.workerEmployments?.getByWorker?.(userWorker.id);
    if (!employments) return false;
    
    return employments.some((emp: any) => emp.employerId === ctx.entityId);
  },

  /**
   * employerAssociation: User is an employer contact for this employer
   */
  employerAssociation: async (ctx, storage) => {
    if (ctx.entityType !== 'employer') return false;
    
    // Find contact by user email
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    // Check if this contact has an employer-contact record for this employer
    const employerContacts = await storage.employerContacts.listByEmployer(ctx.entityId);
    return employerContacts.some((ec: any) => ec.contactId === contact.id);
  },

  /**
   * providerAssociation: User is a trust provider contact
   */
  providerAssociation: async (ctx, storage) => {
    if (ctx.entityType !== 'provider') return false;
    
    // Find contact by user email
    const contact = await storage.contacts.getContactByEmail(ctx.userEmail);
    if (!contact) return false;
    
    // Check if this contact has a provider contact record for this provider
    const providerContacts = await storage.trustProviderContacts?.getByContactId?.(contact.id);
    if (!providerContacts) return false;
    
    return providerContacts.some((pc: any) => pc.providerId === ctx.entityId);
  },
};

/**
 * Evaluate a single condition
 */
async function evaluateCondition(
  condition: EntityAccessCondition,
  user: User,
  policy: EntityAccessPolicy,
  entityId: string,
  storage: any
): Promise<boolean> {
  // Check permission if required
  if (condition.permission) {
    const hasPermission = await storage.users.userHasPermission(user.id, condition.permission);
    if (!hasPermission) return false;
    
    // If no linkage required, permission alone grants access
    if (!condition.linkage) return true;
  }

  // Check linkage if required
  if (condition.linkage) {
    const resolver = linkageResolvers[condition.linkage];
    if (!resolver) {
      logger.warn(`Unknown linkage predicate: ${condition.linkage}`, { service: SERVICE });
      return false;
    }

    const ctx: LinkageContext = {
      userId: user.id,
      userEmail: user.email,
      entityType: policy.entityType,
      entityId,
    };

    const hasLinkage = await resolver(ctx, storage);
    if (!hasLinkage) return false;
  }

  // If we got here, condition is satisfied
  return true;
}

/**
 * Evaluate a rule (handles any/all compositions)
 */
async function evaluateRule(
  rule: EntityAccessRule,
  user: User,
  policy: EntityAccessPolicy,
  entityId: string,
  storage: any
): Promise<boolean> {
  // Check if it's an OR rule
  if ('any' in rule) {
    for (const condition of rule.any) {
      if (await evaluateCondition(condition, user, policy, entityId, storage)) {
        return true;
      }
    }
    return false;
  }

  // Check if it's an AND rule
  if ('all' in rule) {
    for (const condition of rule.all) {
      if (!(await evaluateCondition(condition, user, policy, entityId, storage))) {
        return false;
      }
    }
    return true;
  }

  // Simple condition
  return evaluateCondition(rule as EntityAccessCondition, user, policy, entityId, storage);
}

/**
 * Evaluate an entity access policy
 */
export async function evaluateEntityAccess(
  user: User,
  policyId: string,
  entityId: string,
  storage: any,
  options: { skipCache?: boolean } = {}
): Promise<EntityAccessResult> {
  const cacheKey = buildCacheKey(user.id, policyId, entityId);

  // Check cache first (unless skipping)
  if (!options.skipCache) {
    const cached = accessCache.get(cacheKey);
    if (cached) {
      logger.debug(`Entity access cache hit`, { 
        service: SERVICE, 
        userId: user.id, 
        policyId, 
        entityId,
        granted: cached.granted 
      });
      return cached;
    }
  }

  // Get policy
  const policy = entityAccessPolicyRegistry.get(policyId);
  if (!policy) {
    const result: EntityAccessResult = {
      granted: false,
      reason: `Unknown policy: ${policyId}`,
      evaluatedAt: Date.now(),
    };
    return result;
  }

  // Check if user is admin (bypass all checks except missing policy)
  const isAdmin = await storage.users.userHasPermission(user.id, 'admin');
  if (isAdmin) {
    const result: EntityAccessResult = {
      granted: true,
      reason: 'Admin bypass',
      evaluatedAt: Date.now(),
    };
    accessCache.set(cacheKey, result);
    return result;
  }

  // Evaluate rules (OR - any rule grants access)
  for (const rule of policy.rules) {
    if (await evaluateRule(rule, user, policy, entityId, storage)) {
      const result: EntityAccessResult = {
        granted: true,
        evaluatedAt: Date.now(),
      };
      accessCache.set(cacheKey, result);
      logger.debug(`Entity access granted`, { 
        service: SERVICE, 
        userId: user.id, 
        policyId, 
        entityId 
      });
      return result;
    }
  }

  // No rules matched
  const result: EntityAccessResult = {
    granted: false,
    reason: 'No matching access rules',
    evaluatedAt: Date.now(),
  };
  accessCache.set(cacheKey, result);
  logger.debug(`Entity access denied`, { 
    service: SERVICE, 
    userId: user.id, 
    policyId, 
    entityId 
  });
  return result;
}

/**
 * Batch evaluate access for multiple entities
 */
export async function evaluateEntityAccessBatch(
  user: User,
  policyId: string,
  entityIds: string[],
  storage: any
): Promise<Map<string, EntityAccessResult>> {
  const results = new Map<string, EntityAccessResult>();
  
  // Evaluate in parallel
  await Promise.all(
    entityIds.map(async (entityId) => {
      const result = await evaluateEntityAccess(user, policyId, entityId, storage);
      results.set(entityId, result);
    })
  );
  
  return results;
}

/**
 * Invalidate cache entries
 */
export function invalidateEntityAccessCache(pattern: {
  userId?: string;
  policyId?: string;
  entityId?: string;
}): number {
  const count = accessCache.invalidate(pattern);
  if (count > 0) {
    logger.debug(`Invalidated ${count} entity access cache entries`, { 
      service: SERVICE, 
      pattern 
    });
  }
  return count;
}

/**
 * Clear all cache entries
 */
export function clearEntityAccessCache(): void {
  accessCache.clear();
  logger.info(`Cleared entity access cache`, { service: SERVICE });
}

/**
 * Get cache statistics
 */
export function getEntityAccessCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return accessCache.stats();
}
