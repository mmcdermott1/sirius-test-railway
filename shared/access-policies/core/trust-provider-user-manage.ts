import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'trustProvider.userManage',
  description: 'Requires trust.providers.login component and trustprovider.usermanage permission',
  scope: 'route',
  component: 'trust.providers.login',
  rules: [{ component: 'trust.providers.login', permission: 'trustprovider.usermanage' }],
});

registerPolicy(policy);
export default policy;
