/**
 * Entity Access API Module
 * 
 * Provides API endpoints for checking entity-level access.
 */

import { Express } from 'express';
import { z } from 'zod';
import { requireAuth, buildContext } from '../accessControl';
import { 
  evaluateEntityAccess, 
  evaluateEntityAccessBatch,
  getEntityAccessCacheStats,
  invalidateEntityAccessCache,
  clearEntityAccessCache
} from '../services/entity-access';
import { entityAccessPolicyRegistry } from '@shared/entityAccessPolicies';
import * as policies from '../policies';
import { requireAccess } from '../accessControl';
import { logger } from '../logger';

const SERVICE = 'entity-access-api';

export function registerEntityAccessModule(app: Express, storage: any): void {
  /**
   * GET /api/access/check
   * 
   * Check access to a specific entity
   * Query params:
   *   - policy: Policy ID (e.g., 'worker.view')
   *   - entityId: Entity ID to check access for
   */
  app.get('/api/access/check', requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        policy: z.string(),
        entityId: z.string(),
      });

      const result = schema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({ 
          message: 'Invalid query parameters',
          errors: result.error.errors 
        });
      }

      const { policy: policyId, entityId } = result.data;

      // Get user from context
      const context = await buildContext(req);
      if (!context.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Evaluate access
      const accessResult = await evaluateEntityAccess(
        context.user,
        policyId,
        entityId,
        storage
      );

      res.json({
        granted: accessResult.granted,
        reason: accessResult.reason,
      });
    } catch (error) {
      logger.error('Error checking entity access', {
        service: SERVICE,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Failed to check access' });
    }
  });

  /**
   * POST /api/access/check-batch
   * 
   * Check access to multiple entities at once
   * Body:
   *   - policy: Policy ID
   *   - entityIds: Array of entity IDs
   */
  app.post('/api/access/check-batch', requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        policy: z.string(),
        entityIds: z.array(z.string()).max(100), // Limit batch size
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: 'Invalid request body',
          errors: result.error.errors 
        });
      }

      const { policy: policyId, entityIds } = result.data;

      // Get user from context
      const context = await buildContext(req);
      if (!context.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Evaluate access for all entities
      const accessResults = await evaluateEntityAccessBatch(
        context.user,
        policyId,
        entityIds,
        storage
      );

      // Convert Map to object for JSON response
      const results: Record<string, { granted: boolean; reason?: string }> = {};
      accessResults.forEach((accessResult, entityId) => {
        results[entityId] = {
          granted: accessResult.granted,
          reason: accessResult.reason,
        };
      });

      res.json({ results });
    } catch (error) {
      logger.error('Error checking entity access batch', {
        service: SERVICE,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Failed to check access' });
    }
  });

  /**
   * GET /api/access/policies
   * 
   * List all registered entity access policies
   * Admin only
   */
  app.get('/api/access/policies', requireAccess(policies.admin), async (req, res) => {
    try {
      const allPolicies = entityAccessPolicyRegistry.getAll();
      res.json({ 
        policies: allPolicies.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          entityType: p.entityType,
        }))
      });
    } catch (error) {
      logger.error('Error listing entity access policies', {
        service: SERVICE,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Failed to list policies' });
    }
  });

  /**
   * GET /api/access/cache/stats
   * 
   * Get cache statistics
   * Admin only
   */
  app.get('/api/access/cache/stats', requireAccess(policies.admin), async (req, res) => {
    try {
      const stats = getEntityAccessCacheStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: 'Failed to get cache stats' });
    }
  });

  /**
   * POST /api/access/cache/invalidate
   * 
   * Invalidate cache entries matching a pattern
   * Admin only
   */
  app.post('/api/access/cache/invalidate', requireAccess(policies.admin), async (req, res) => {
    try {
      const schema = z.object({
        userId: z.string().optional(),
        policyId: z.string().optional(),
        entityId: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: 'Invalid request body',
          errors: result.error.errors 
        });
      }

      const count = invalidateEntityAccessCache(result.data);
      res.json({ invalidated: count });
    } catch (error) {
      res.status(500).json({ message: 'Failed to invalidate cache' });
    }
  });

  /**
   * POST /api/access/cache/clear
   * 
   * Clear all cache entries
   * Admin only
   */
  app.post('/api/access/cache/clear', requireAccess(policies.admin), async (req, res) => {
    try {
      clearEntityAccessCache();
      res.json({ cleared: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to clear cache' });
    }
  });

  logger.info('Entity access module registered', { service: SERVICE });
}
