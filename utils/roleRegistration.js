const crypto = require('crypto');
const { USER_ROLES, USER_ROLE_VALUES } = require('../constants/roles');

const secureCodeMatches = (submittedCode, configuredCode) => {
  if (!configuredCode || typeof submittedCode !== 'string') return false;

  const submitted = Buffer.from(submittedCode);
  const configured = Buffer.from(configuredCode);
  return submitted.length === configured.length && crypto.timingSafeEqual(submitted, configured);
};

const validateRegistrationRole = (role, coachCode, configuredCoachCode = process.env.COACH_REGISTRATION_CODE) => {
  if (!USER_ROLE_VALUES.includes(role)) {
    return { status: 400, message: 'Invalid account role' };
  }
  if (role === USER_ROLES.COACH && !secureCodeMatches(coachCode, configuredCoachCode)) {
    return { status: 403, message: 'Coach registration requires a valid registration code' };
  }
  return null;
};

module.exports = { secureCodeMatches, validateRegistrationRole };
