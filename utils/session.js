const jwt = require('jsonwebtoken');

const SESSION_COOKIE = 'chess_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_MAX_AGE_MS,
  path: '/'
});

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
