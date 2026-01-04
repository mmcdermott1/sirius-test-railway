import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'contact.view',
  description: 'View a specific contact record (via linked worker/employer/provider access)',
  scope: 'entity',
  entityType: 'contact',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'worker' }, { attribute: 'contact belongs to owned worker' }] },
    { all: [{ permission: 'trustprovider' }, { attribute: 'associated with provider using this contact' }] },
    { all: [{ permission: 'employer' }, { attribute: 'employer association to this contact' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    const contact = await ctx.loadEntity('contact', ctx.entityId!);
    if (!contact) {
      return { granted: false, reason: 'Contact not found' };
    }
    
    const userContact = await ctx.getUserContact();
    if (!userContact) {
      return { granted: false, reason: 'User has no contact record' };
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
    
    if (await ctx.hasPermission('trustprovider')) {
      const userWorker = await ctx.getUserWorker();
      if (userWorker) {
        const worker = await ctx.storage.workers?.get?.(userWorker.id);
        if (worker?.contactId === ctx.entityId) {
          return { granted: true, reason: 'Provider for worker using this contact' };
        }
      }
      
      const providerContacts = await ctx.storage.trustProviderContacts?.getByContactId?.(userContact.id);
      if (providerContacts?.length > 0) {
        for (const pc of providerContacts) {
          const provider = await ctx.storage.trustProviders?.get?.(pc.providerId);
          if (provider?.contactId === ctx.entityId) {
            return { granted: true, reason: 'Associated with provider using this contact' };
          }
        }
      }
    }
    
    if (await ctx.hasPermission('employer')) {
      const employerContacts = await ctx.storage.employerContacts?.getByContactId?.(userContact.id);
      if (employerContacts?.length > 0) {
        for (const ec of employerContacts) {
          const employer = await ctx.storage.employers?.get?.(ec.employerId);
          if (employer) {
            const empContacts = await ctx.storage.employerContacts?.listByEmployer?.(ec.employerId);
            if (empContacts?.some((c: any) => c.contactId === ctx.entityId)) {
              return { granted: true, reason: 'Employer association to this contact' };
            }
          }
        }
      }
    }
    
    return { granted: false, reason: 'No access to this contact' };
  },
});

registerPolicy(policy);
export default policy;
