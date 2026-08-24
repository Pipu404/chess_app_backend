const mongoose = require('mongoose');

const ClassroomSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  coachId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  inviteCode: { type: String, required: true, unique: true, index: true },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Classroom', ClassroomSchema);
