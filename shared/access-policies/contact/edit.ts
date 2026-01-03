import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'contact.edit',
  description: 'Edit a specific contact record (staff or workers editing their own contact)',
  scope: 'entity',
  entityType: 'contact',
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.hasPermission('worker')) {
      const userWorker = await ctx.getUserWorker();
      if (userWorker) {
        const worker = await ctx.storage.workers?.get?.(userWorker.id);
        if (worker?.contactId === ctx.entityId) {
          return { granted: true, reason: 'Contact belongs to owned worker' };
        }
      }
    }
    
    return { granted: false, reason: 'No edit access to this contact' };
  },
});

registerPolicy(policy);
export default policy;
