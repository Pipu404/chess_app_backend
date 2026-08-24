const mongoose = require('mongoose');

const PlayedMoveSchema = new mongoose.Schema({
  from: { type: String, required: true, match: /^[a-h][1-8]$/ },
  to: { type: String, required: true, match: /^[a-h][1-8]$/ },
  promotion: { type: String, enum: ['q', 'r', 'b', 'n'], default: 'q' }
}, { _id: false });

const PuzzleAttemptSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true, index: true },
  puzzleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CoachPuzzle', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  playedMoves: { type: [PlayedMoveSchema], required: true },
  mistakes: { type: Number, min: 0, default: 0 },
  hintsUsed: { type: Number, min: 0, default: 0 },
  durationSeconds: { type: Number, min: 0, required: true },
  accuracy: { type: Number, min: 0, max: 100, required: true },
  completed: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('PuzzleAttempt', PuzzleAttemptSchema);
