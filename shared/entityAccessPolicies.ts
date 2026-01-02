/**
 * Entity-Based Access Policy Framework
 * 
 * This module defines policies for controlling access to specific entities
 * (workers, employers, etc.) based on permissions, ownership, and associations.
 * 
 * Unlike route-based middleware policies, these policies are evaluated on-demand
 * and cached for performance.
 */

/**
 * Linkage predicate types - define how a user can be associated with an entity
 */
export type LinkagePredicate = 
  | 'ownsWorker'              // User's email matches worker's contact email
  | 'workerBenefitProvider'   // User is a provider for a benefit the worker receives
  | 'workerEmploymentHistory' // User (as worker) has employment history at this employer
  | 'employerAssociation'     // User is an employer contact for this employer
  | 'providerAssociation';    // User is a trust provider contact

/**
 * A single condition that can grant access
 */
export interface EntityAccessCondition {
  /** Required permission (if any) */
  permission?: string;
  /** Required linkage to the entity (if any) */
  linkage?: LinkagePredicate;
}

/**
 * Policy rule - can be a single condition, OR of conditions, or AND of conditions
 */
export type EntityAccessRule = 
  | EntityAccessCondition
  | { any: EntityAccessCondition[] }  // OR - any condition grants access
  | { all: EntityAccessCondition[] }; // AND - all conditions required

/**
 * Entity access policy definition
 */
export interface EntityAccessPolicy {
  /** Unique policy identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this policy grants */
  description: string;
  /** Entity type this policy applies to */
  entityType: 'worker' | 'employer' | 'provider' | 'policy';
  /** Access rules - evaluated as OR (any rule grants access) */
  rules: EntityAccessRule[];
}

/**
 * Result of a policy evaluation
 */
export interface EntityAccessResult {
  granted: boolean;
  reason?: string;
  evaluatedAt: number; // timestamp for cache management
}

/**
 * Cache key format: userId:policyId:entityId
 */
export function buildCacheKey(userId: string, policyId: string, entityId: string): string {
  return `${userId}:${policyId}:${entityId}`;
}

/**
 * Parse a cache key back into components
 */
export function parseCacheKey(key: string): { userId: string; policyId: string; entityId: string } | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  return { userId: parts[0], policyId: parts[1], entityId: parts[2] };
}

/**
 * Policy Registry
 */
class EntityAccessPolicyRegistry {
  private policies = new Map<string, EntityAccessPolicy>();

  register(policy: EntityAccessPolicy): void {
    if (this.policies.has(policy.id)) {
      throw new Error(`Entity access policy '${policy.id}' is already registered`);
    }
    this.policies.set(policy.id, policy);
  }

  get(id: string): EntityAccessPolicy | undefined {
    return this.policies.get(id);
  }

  getAll(): EntityAccessPolicy[] {
    return Array.from(this.policies.values());
  }

  has(id: string): boolean {
    return this.policies.has(id);
  }
}

export const entityAccessPolicyRegistry = new EntityAccessPolicyRegistry();

/**
 * Register a policy and return it (for convenience)
 */
export function definePolicy(policy: EntityAccessPolicy): EntityAccessPolicy {
  entityAccessPolicyRegistry.register(policy);
  return policy;
}
