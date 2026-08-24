const mongoose = require('mongoose');

const OpeningMoveSchema = new mongoose.Schema({
  from: { type: String, required: true, match: /^[a-h][1-8]$/ },
  to: { type: String, required: true, match: /^[a-h][1-8]$/ },
  promotion: { type: String, enum: ['q', 'r', 'b', 'n'], default: 'q' },
  san: { type: String, required: true }
}, { _id: false });

const OpeningLineSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 100 },
  moves: { type: [OpeningMoveSchema], required: true, validate: value => value.length > 0 && value.length <= 60 }
});

const OpeningRepertoireSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  side: { type: String, enum: ['white', 'black'], required: true },
  lines: { type: [OpeningLineSchema], default: [] },
  published: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('OpeningRepertoire', OpeningRepertoireSchema);
