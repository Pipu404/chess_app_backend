const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { USER_ROLES } = require('../constants/roles');
const { validateRegistrationRole } = require('../utils/roleRegistration');
const { requireAuth } = require('../middleware/auth');
const { clearSessionCookie, setSessionCookie } = require('../utils/session');

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role || USER_ROLES.PLAYER,
  puzzleRating: user.puzzleRating || 1200
});

// Register
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, role = USER_ROLES.PLAYER, coachCode } = req.body;
    const roleError = validateRegistrationRole(role, coachCode);
    if (roleError) {
      return res.status(roleError.status).json({ msg: roleError.message });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail });
    if (user) return res.status(400).json({ msg: 'User already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({ name, email: normalizedEmail, password: hashedPassword, role });
    await user.save();

    setSessionCookie(res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

    setSessionCookie(res, user);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(401).json({ msg: 'User account not found' });
    return res.json({ user: publicUser(user) });
  } catch {
    return res.status(500).json({ msg: 'Unable to load the current session' });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ msg: 'Signed out' });
});

module.exports = router;
