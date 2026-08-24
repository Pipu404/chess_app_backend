const jwt = require('jsonwebtoken');

const SESSION_COOKIE = 'chess_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const sameSiteValue = () => {
  const configured = String(process.env.COOKIE_SAME_SITE || '').toLowerCase();
  if (['lax', 'strict', 'none'].includes(configured)) return configured;
  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
};

const cookieOptions = () => {
  const sameSite = sameSiteValue();
  return {
    httpOnly: true,
    sameSite,
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/'
  };
};

const createSessionToken = (user) => jwt.sign(
  { userId: user.id, role: user.role || 'player' },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

const setSessionCookie = (res, user) => {
  res.cookie(SESSION_COOKIE, createSessionToken(user), cookieOptions());
};

const clearSessionCookie = (res) => {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(SESSION_COOKIE, options);
};

module.exports = { SESSION_COOKIE, clearSessionCookie, createSessionToken, setSessionCookie };
