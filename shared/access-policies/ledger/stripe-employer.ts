import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'ledger.stripe.employer',
  description: 'Requires ledger.stripe component and either ledger.staff or ledger.employer permission',
  scope: 'route',
  component: 'ledger.stripe',
  rules: [{ component: 'ledger.stripe', anyPermission: ['ledger.staff', 'ledger.employer'] }],
});

registerPolicy(policy);
export default policy;
