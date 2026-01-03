import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'employer.userManage',
  description: 'Requires employer.login component and employer.usermanage permission',
  scope: 'route',
  component: 'employer.login',
  rules: [{ component: 'employer.login', permission: 'employer.usermanage' }],
});

registerPolicy(policy);
export default policy;
