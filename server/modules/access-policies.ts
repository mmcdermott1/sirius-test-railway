import type { Express } from 'express';
import { buildContext, evaluatePolicyDetailed } from '../accessControl';
import { requireAuth } from '../accessControl';
import * as policies from '../policies';

/**
 * Register access policy evaluation routes
 */
export function registerAccessPolicyRoutes(app: Express) {
  // GET /api/access/policies/:policyName - Check access policy (requires authentication)
  app.get("/api/access/policies/:policyName", requireAuth, async (req, res) => {
    try {
      const { policyName } = req.params;
      
      // Get the policy by name
      const policy = (policies as any)[policyName];
      
      if (!policy) {
        return res.status(404).json({ 
          message: `Policy '${policyName}' not found` 
        });
      }
      
      // Build context from request
      const context = await buildContext(req);
      
      // Evaluate policy with detailed results
      const result = await evaluatePolicyDetailed(policy, context);
      
      res.json(result);
    } catch (error) {
      console.error('Error evaluating policy:', error);
      res.status(500).json({ message: 'Failed to evaluate policy' });
    }
  });
}
