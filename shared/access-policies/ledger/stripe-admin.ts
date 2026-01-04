import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'ledger.stripe.admin',
  description: 'Administer Stripe integration',
  scope: 'route',
  component: 'ledger.stripe',
  rules: [{ component: 'ledger.stripe', permission: 'admin' }],
});

registerPolicy(policy);
export default policy;
