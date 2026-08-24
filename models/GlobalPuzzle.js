const mongoose = require('mongoose');

const GlobalPuzzleSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true, trim: true },
  instruction: { type: String, required: true },
  hint: { type: String, default: '' },
  fen: { type: String, required: true },
  solution: {
    from: { type: String, required: true, match: /^[a-h][1-8]$/ },
    to: { type: String, required: true, match: /^[a-h][1-8]$/ },
    promotion: { type: String, enum: ['q', 'r', 'b', 'n'], default: 'q' }
  },
  tags: { type: [String], default: [] },
  rating: { type: Number, min: 100, max: 3000, default: 1200 },
  plays: { type: Number, min: 0, default: 0 },
  solves: { type: Number, min: 0, default: 0 },
  published: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('GlobalPuzzle', GlobalPuzzleSchema);
