import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'masquerade',
  description: 'Requires masquerade or admin permission',
  scope: 'route',
  rules: [{ anyPermission: ['masquerade', 'admin'] }],
});

registerPolicy(policy);
export default policy;
