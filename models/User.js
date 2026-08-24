const mongoose = require('mongoose');
const { USER_ROLES, USER_ROLE_VALUES } = require('../constants/roles');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: USER_ROLE_VALUES,
    default: USER_ROLES.PLAYER,
    required: true
  },
  puzzleRating: { type: Number, min: 100, max: 3000, default: 1200 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
