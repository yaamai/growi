const form = require('express-form');

const field = form.field;

module.exports = form(
  field('settingForm[security:passport-generic-oidc:isEnabled]').trim().toBooleanStrict().required(),
  field('settingForm[security:passport-generic-oidc:issuerHost]').trim(),
  field('settingForm[security:passport-generic-oidc:clientId]').trim(),
  field('settingForm[security:passport-generic-oidc:clientSecret]').trim(),
  field('settingForm[security:passport-generic-oidc:attrMapUserName]').trim(),
  field('settingForm[security:passport-generic-oidc:attrMapMail]').trim(),
  field('settingForm[security:passport-generic-oidc:attrMapId]').trim(),
  field('settingForm[security:passport-generic-oidc:isSameUsernameTreatedAsIdenticalUser]').trim().toBooleanStrict(),
);
