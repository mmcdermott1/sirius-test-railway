import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'ledger.staff',
  description: 'Requires ledger component and ledger.staff permission',
  scope: 'route',
  component: 'ledger',
  rules: [{ component: 'ledger', permission: 'ledger.staff' }],
});

registerPolicy(policy);
export default policy;
