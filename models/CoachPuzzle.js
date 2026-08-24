const mongoose = require('mongoose');

const MoveSchema = new mongoose.Schema({
  from: { type: String, required: true, match: /^[a-h][1-8]$/ },
  to: { type: String, required: true, match: /^[a-h][1-8]$/ },
  promotion: { type: String, enum: ['q', 'r', 'b', 'n'], default: 'q' },
  san: { type: String, required: true }
}, { _id: false });

const CoachPuzzleSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  initialFen: { type: String, required: true },
  solutionMoves: { type: [MoveSchema], required: true, validate: value => value.length > 0 },
  hints: { type: [String], default: [] },
  tags: { type: [String], default: [] },
  difficulty: { type: String, enum: ['Beginner', 'Easy', 'Medium', 'Hard', 'Expert'], default: 'Medium' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' }
}, { timestamps: true });

module.exports = mongoose.model('CoachPuzzle', CoachPuzzleSchema);
