import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'staff',
  description: 'Requires staff permission',
  scope: 'route',
  rules: [{ permission: 'staff' }],
});

registerPolicy(policy);
export default policy;
