import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'employer.mine',
  description: 'Access associated employer record (no worker access)',
  scope: 'entity',
  entityType: 'employer',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'employer' }, { attribute: 'associated with employer' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.hasPermission('employer')) {
      const userContact = await ctx.getUserContact();
      if (userContact) {
        const employerContacts = await ctx.storage.employerContacts?.listByEmployer?.(ctx.entityId);
        if (employerContacts?.some((ec: any) => ec.contactId === userContact.id)) {
          return { granted: true, reason: 'Associated with this employer' };
        }
      }
    }
    
    return { granted: false, reason: 'Not associated with this employer' };
  },
});

registerPolicy(policy);
export default policy;
