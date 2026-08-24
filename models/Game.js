const mongoose = require('mongoose');

const MoveSchema = new mongoose.Schema({
  from: { type: String, required: true, match: /^[a-h][1-8]$/ },
  to: { type: String, required: true, match: /^[a-h][1-8]$/ },
  promotion: { type: String, enum: ['q', 'r', 'b', 'n'], default: 'q' },
  san: { type: String, required: true }
}, { _id: false });

const ReviewMoveSchema = new mongoose.Schema({
  index: Number, moveNumber: Number, color: String, san: String, from: String, to: String,
  fen: String, evaluation: Number, evaluationBefore: Number, loss: Number, classification: String,
  bestMove: String, bestLine: { type: [String], default: [] }, explanation: String
}, { _id: false });

const GameSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  clientGameId: { type: String, required: true },
  mode: { type: String, enum: ['ai', 'local', 'online'], required: true },
  difficulty: { type: String, default: 'Medium' },
  timeControl: { type: String, required: true },
  userColor: { type: String, enum: ['w', 'b'], required: true },
  result: {
    reason: { type: String, required: true },
    winner: { type: String, enum: ['White', 'Black', 'Draw'], required: true }
  },
  moves: { type: [MoveSchema], required: true },
  pgn: { type: String, default: '' },
  finalFen: { type: String, required: true },
  review: { type: [ReviewMoveSchema], default: [] },
  reviewVersion: { type: Number, default: 0 },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });

GameSchema.index({ userId: 1, clientGameId: 1 }, { unique: true });
module.exports = mongoose.model('Game', GameSchema);
