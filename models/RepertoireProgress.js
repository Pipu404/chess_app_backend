const mongoose = require('mongoose');

const RepertoireProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  repertoireId: { type: mongoose.Schema.Types.ObjectId, ref: 'OpeningRepertoire', required: true, index: true },
  lineId: { type: mongoose.Schema.Types.ObjectId, required: true },
  repetitions: { type: Number, min: 0, default: 0 },
  intervalDays: { type: Number, min: 0, default: 0 },
  easeFactor: { type: Number, min: 1.3, default: 2.5 },
  dueAt: { type: Date, default: Date.now, index: true },
  lastGrade: { type: Number, min: 0, max: 5, default: 0 },
  lastPracticedAt: { type: Date, default: null }
}, { timestamps: true });

RepertoireProgressSchema.index({ userId: 1, repertoireId: 1, lineId: 1 }, { unique: true });
module.exports = mongoose.model('RepertoireProgress', RepertoireProgressSchema);
