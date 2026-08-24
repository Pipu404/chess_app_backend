const mongoose = require('mongoose');

const AssignmentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  instructions: { type: String, trim: true, maxlength: 1000, default: '' },
  coachId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  puzzleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CoachPuzzle', required: true }],
  dueAt: { type: Date, required: true },
  status: { type: String, enum: ['active', 'closed'], default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('Assignment', AssignmentSchema);
