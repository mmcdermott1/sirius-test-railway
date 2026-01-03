import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'files.upload',
  description: 'Requires files.upload permission or staff permission',
  scope: 'route',
  rules: [
    { permission: 'files.upload' },
    { permission: 'staff' },
  ],
});

registerPolicy(policy);
export default policy;
