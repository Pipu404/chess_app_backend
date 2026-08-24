const jwt = require('jsonwebtoken');
const { SESSION_COOKIE } = require('../utils/session');

const readCookie = (header, name) => {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) return decodeURIComponent(valueParts.join('='));
  }
  return null;
};

const requireAuth = (req, res, next) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return res.status(401).json({ msg: 'Authentication required' });
  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ msg: 'Session expired or invalid' });
  }
};

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.auth || !allowedRoles.includes(req.auth.role)) {
    return res.status(403).json({ msg: 'You do not have permission to access this resource' });
  }
  return next();
};

module.exports = { readCookie, requireAuth, requireRole };
