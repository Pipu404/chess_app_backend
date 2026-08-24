const mongoose = require('mongoose');

const GlobalPuzzleAttemptSchema = new mongoose.Schema({
  puzzleId: { type: mongoose.Schema.Types.ObjectId, ref: 'GlobalPuzzle', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  mistakes: { type: Number, min: 0, default: 0 },
  hintsUsed: { type: Number, min: 0, default: 0 },
  durationSeconds: { type: Number, min: 0, required: true },
  accuracy: { type: Number, min: 0, max: 100, required: true },
  ratingBefore: { type: Number, required: true },
  ratingAfter: { type: Number, required: true },
  ratingChange: { type: Number, required: true }
}, { timestamps: true });

GlobalPuzzleAttemptSchema.index({ puzzleId: 1, userId: 1 }, { unique: true });
module.exports = mongoose.model('GlobalPuzzleAttempt', GlobalPuzzleAttemptSchema);
