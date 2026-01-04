import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'contact.edit',
  description: 'Edit a specific contact record (staff, workers editing their own contact, or employers editing their employer contacts)',
  scope: 'entity',
  entityType: 'contact',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'worker' }, { attribute: 'contact belongs to owned worker' }] },
    { all: [{ permission: 'employer.manage' }, { attribute: 'employer contact at associated employer' }] }
  ],
  
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
    
    // Check employer contact access with employer.manage permission
    if (await ctx.hasPermission('employer.manage')) {
      const userContact = await ctx.getUserContact();
      if (userContact) {
        // Get employer contacts for the current user (uses listByContactId, not getByContactId)
        const userEmployerContacts = await ctx.storage.employerContacts?.listByContactId?.(userContact.id);
        if (userEmployerContacts && userEmployerContacts.length > 0) {
          // Check if the target contact belongs to the same employer(s) the user is associated with
          for (const ec of userEmployerContacts) {
            const empContacts = await ctx.storage.employerContacts?.listByEmployer?.(ec.employerId);
            if (empContacts?.some((c: any) => c.contactId === ctx.entityId)) {
              return { granted: true, reason: 'Employer contact with manage permission' };
            }
          }
        }
      }
    }
    
    return { granted: false, reason: 'No edit access to this contact' };
  },
});

registerPolicy(policy);
export default policy;
