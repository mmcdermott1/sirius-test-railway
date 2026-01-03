import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'ledger.staff',
  description: 'Requires ledger component and staff permission',
  scope: 'route',
  component: 'ledger',
  rules: [{ component: 'ledger', permission: 'staff' }],
});

registerPolicy(policy);
export default policy;
