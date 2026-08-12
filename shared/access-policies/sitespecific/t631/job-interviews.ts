import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

/**
 * View the T631 interviews tab of a dispatch job.
 *
 * Staff always; employer users only for jobs belonging to an employer they
 * are linked to (delegates to employer.mine). Workers do NOT get access to
 * the job-side page — they see their own interviews on their worker page.
 * The entity id is the DISPATCH JOB id.
 */
const policy = definePolicy({
  id: 'sitespecific.t631.job.interviews',
  description: 'View T631 interviews for a dispatch job',
  scope: 'entity',
  entityType: 'dispatch',
  component: 'sitespecific.t631.interviews',

  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'employer' }, { attribute: "associated with the job's employer" }] },
  ],

  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }

    if (ctx.entityId) {
      const job = await ctx.storage.dispatchJobs?.get?.(ctx.entityId);
      if (job?.employerId && (await ctx.checkPolicy('employer.mine', job.employerId))) {
        return { granted: true, reason: "Associated with this job's employer" };
      }
    }

    return { granted: false, reason: 'No access to interviews for this job' };
  },
});

registerPolicy(policy);
export default policy;
