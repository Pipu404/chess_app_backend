const jwt = require('jsonwebtoken');

const SESSION_COOKIE = 'chess_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const sameSiteValue = () => {
  const configured = String(process.env.COOKIE_SAME_SITE || '').toLowerCase();
  if (['lax', 'strict', 'none'].includes(configured)) return configured;
  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
};

const requestIsSecure = (req) => {
  const forwardedProtocol = req?.headers?.['x-forwarded-proto']
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  return Boolean(req?.secure || forwardedProtocol === 'https');
};

const cookieOptions = (req) => {
  const secure = requestIsSecure(req);
  // Browsers reject Secure cookies over localhost HTTP. A non-secure request
  // must also use Lax because SameSite=None requires the Secure attribute.
  const sameSite = secure ? sameSiteValue() : 'lax';
  return {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: SESSION_MAX_AGE_MS,
    path: '/'
  };
};

const createSessionToken = (user) => jwt.sign(
  { userId: user.id, role: user.role || 'player' },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

const setSessionCookie = (res, user, req) => {
  res.cookie(SESSION_COOKIE, createSessionToken(user), cookieOptions(req));
};

const clearSessionCookie = (res, req) => {
  const { maxAge, ...options } = cookieOptions(req);
  res.clearCookie(SESSION_COOKIE, options);
};

module.exports = { SESSION_COOKIE, clearSessionCookie, createSessionToken, setSessionCookie };
