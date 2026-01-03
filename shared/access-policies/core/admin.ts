import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'admin',
  description: 'Requires admin permission',
  scope: 'route',
  rules: [{ permission: 'admin' }],
});

registerPolicy(policy);
export default policy;
