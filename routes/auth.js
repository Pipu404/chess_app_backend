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
  puzzleRating: user.puzzleRating || 1200,
  chessRating: user.chessRating || 1200,
  ratingHistory: [...(user.ratingHistory || [])].slice(-20).reverse()
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

    setSessionCookie(res, user, req);
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

    setSessionCookie(res, user, req);
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

router.patch('/me', requireAuth, async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(401).json({ msg: 'User account not found' });

    const nextName = typeof name === 'string' ? name.trim() : user.name;
    const nextEmail = typeof email === 'string' ? email.toLowerCase().trim() : user.email;
    if (nextName.length < 2 || nextName.length > 80) return res.status(400).json({ msg: 'Name must be between 2 and 80 characters' });
    if (!/^\S+@\S+\.\S+$/.test(nextEmail)) return res.status(400).json({ msg: 'Enter a valid email address' });

    if (nextEmail !== user.email) {
      const emailInUse = await User.exists({ email: nextEmail, _id: { $ne: user._id } });
      if (emailInUse) return res.status(409).json({ msg: 'That email address is already in use' });
    }

    if (newPassword) {
      if (newPassword.length < 8) return res.status(400).json({ msg: 'New password must be at least 8 characters' });
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(400).json({ msg: 'Your current password is incorrect' });
      }
      user.password = await bcrypt.hash(newPassword, 10);
    }

    user.name = nextName;
    user.email = nextEmail;
    await user.save();
    setSessionCookie(res, user, req);
    return res.json({ user: publicUser(user) });
  } catch {
    return res.status(500).json({ msg: 'Unable to update your profile' });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res, req);
  res.json({ msg: 'Signed out' });
});

module.exports = router;
