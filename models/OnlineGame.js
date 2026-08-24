const mongoose = require('mongoose');

const OnlineMoveSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  promotion: { type: String, default: 'q' },
  san: { type: String, required: true }
}, { _id: false });

const OnlineGameSchema = new mongoose.Schema({
  whiteUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  blackUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  whiteName: { type: String, required: true },
  blackName: { type: String, required: true },
  whiteRatingBefore: { type: Number, required: true },
  blackRatingBefore: { type: Number, required: true },
  whiteRatingChange: { type: Number, default: 0 },
  blackRatingChange: { type: Number, default: 0 },
  ratingApplied: { type: Boolean, default: false },
  timeControl: { type: String, required: true },
  initialTimeMs: { type: Number, required: true },
  incrementMs: { type: Number, required: true },
  whiteTimeMs: { type: Number, required: true },
  blackTimeMs: { type: Number, required: true },
  activeSince: { type: Date, required: true },
  fen: { type: String, required: true },
  moves: { type: [OnlineMoveSchema], default: [] },
  status: { type: String, enum: ['active', 'completed'], default: 'active', index: true },
  drawOfferedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rematchOf: { type: mongoose.Schema.Types.ObjectId, ref: 'OnlineGame', default: null },
  result: {
    reason: String,
    winner: { type: String, enum: ['White', 'Black', 'Draw'] }
  },
  completedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('OnlineGame', OnlineGameSchema);
