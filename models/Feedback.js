const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
  coachId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: String, required: true, trim: true, maxlength: 1500 },
  focusArea: { type: String, trim: true, maxlength: 80, default: '' },
  readAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Feedback', FeedbackSchema);
