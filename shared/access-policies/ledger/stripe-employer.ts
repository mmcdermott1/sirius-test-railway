import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'ledger.stripe.employer',
  description: 'Access to employer Stripe ledger - requires staff permission OR (employer.ledger permission AND employer.mine policy)',
  scope: 'entity',
  component: 'ledger.stripe',
  rules: [
    { permission: 'staff' },
    { permission: 'employer.ledger', policy: 'employer.mine' }
  ],
});

registerPolicy(policy);
export default policy;
