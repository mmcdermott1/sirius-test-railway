import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'ledger.stripe.admin',
  description: 'Requires admin permission and ledger.stripe component',
  scope: 'route',
  component: 'ledger.stripe',
  rules: [{ component: 'ledger.stripe', permission: 'admin' }],
});

registerPolicy(policy);
export default policy;
