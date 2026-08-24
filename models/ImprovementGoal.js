const mongoose = require('mongoose');

const ImprovementGoalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  metric: { type: String, enum: ['puzzle_rating', 'chess_rating', 'puzzle_accuracy', 'games_reviewed', 'puzzles_solved'], required: true },
  target: { type: Number, required: true, min: 1, max: 100000 },
  deadline: { type: Date, default: null },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('ImprovementGoal', ImprovementGoalSchema);
