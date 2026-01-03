import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'authenticated',
  description: 'Requires user to be authenticated',
  scope: 'route',
  rules: [{ authenticated: true }],
});

registerPolicy(policy);
export default policy;
