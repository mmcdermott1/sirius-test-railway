import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'employer.ledger',
  description: 'Access to employer ledger - requires staff permission OR (employer.ledger permission AND employer.mine policy)',
  scope: 'entity',
  component: 'ledger',
  rules: [
    { permission: 'staff' },
    { permission: 'employer.ledger', policy: 'employer.mine' }
  ],
});

registerPolicy(policy);
export default policy;
