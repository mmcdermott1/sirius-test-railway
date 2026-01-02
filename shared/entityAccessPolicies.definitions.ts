/**
 * Entity Access Policy Definitions
 * 
 * Defines the actual policies for entity-level access control.
 */

import { definePolicy } from './entityAccessPolicies';

/**
 * worker.view - Access to view a worker's detail page
 * 
 * Grants access if:
 * - User has 'staff' permission, OR
 * - User has 'worker' permission AND owns this worker record (email match), OR
 * - User has 'provider' permission AND is a provider for a benefit the worker receives
 */
export const workerView = definePolicy({
  id: 'worker.view',
  name: 'View Worker',
  description: 'Access to view a worker detail page',
  entityType: 'worker',
  rules: [
    // Staff can view any worker
    { permission: 'staff' },
    // Worker can view their own record
    { permission: 'worker', linkage: 'ownsWorker' },
    // Provider can view workers receiving their benefits
    { permission: 'provider', linkage: 'workerBenefitProvider' },
  ],
});

/**
 * worker.bans.view - Access to view a worker's bans
 * 
 * Same as worker.view
 */
export const workerBansView = definePolicy({
  id: 'worker.bans.view',
  name: 'View Worker Bans',
  description: 'Access to view a worker\'s ban records',
  entityType: 'worker',
  rules: [
    { permission: 'staff' },
    { permission: 'worker', linkage: 'ownsWorker' },
    { permission: 'provider', linkage: 'workerBenefitProvider' },
  ],
});

/**
 * worker.bans.edit - Access to edit a worker's bans
 * 
 * Staff only
 */
export const workerBansEdit = definePolicy({
  id: 'worker.bans.edit',
  name: 'Edit Worker Bans',
  description: 'Access to create, update, or delete a worker\'s ban records',
  entityType: 'worker',
  rules: [
    { permission: 'staff' },
  ],
});

/**
 * employer.view - Access to view an employer's detail page
 * 
 * Grants access if:
 * - User has 'staff' permission, OR
 * - User has 'worker' permission AND has employment history at this employer, OR
 * - User has 'employer' permission AND is associated with this employer
 */
export const employerView = definePolicy({
  id: 'employer.view',
  name: 'View Employer',
  description: 'Access to view an employer detail page',
  entityType: 'employer',
  rules: [
    // Staff can view any employer
    { permission: 'staff' },
    // Worker can view employers they've worked at
    { permission: 'worker', linkage: 'workerEmploymentHistory' },
    // Employer contacts can view their employer
    { permission: 'employer', linkage: 'employerAssociation' },
  ],
});

/**
 * employer.edit - Access to edit an employer record
 * 
 * Staff only
 */
export const employerEdit = definePolicy({
  id: 'employer.edit',
  name: 'Edit Employer',
  description: 'Access to edit an employer record',
  entityType: 'employer',
  rules: [
    { permission: 'staff' },
  ],
});
