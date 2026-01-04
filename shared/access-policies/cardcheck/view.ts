import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'cardcheck.view',
  description: 'View a specific cardcheck record (delegates to worker.view)',
  scope: 'entity',
  entityType: 'cardcheck',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { attribute: 'has view access to associated worker' }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    const cardcheck = await ctx.loadEntity('cardcheck', ctx.entityId!);
    if (!cardcheck) {
      return { granted: false, reason: 'Cardcheck not found' };
    }
    
    const workerId = (cardcheck as any).workerId;
    if (!workerId) {
      return { granted: false, reason: 'Cardcheck has no associated worker' };
    }
    
    const hasWorkerAccess = await ctx.checkPolicy('worker.view', workerId);
    if (hasWorkerAccess) {
      return { granted: true, reason: 'Has view access to associated worker' };
    }
    
    return { granted: false, reason: 'No access to this cardcheck' };
  },
});

registerPolicy(policy);
export default policy;
