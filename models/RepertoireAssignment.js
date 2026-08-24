const mongoose = require('mongoose');

const RepertoireAssignmentSchema = new mongoose.Schema({
  repertoireId: { type: mongoose.Schema.Types.ObjectId, ref: 'OpeningRepertoire', required: true, index: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  coachId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  instructions: { type: String, trim: true, maxlength: 500, default: '' },
  dueAt: { type: Date, default: null },
  active: { type: Boolean, default: true }
}, { timestamps: true });

RepertoireAssignmentSchema.index({ repertoireId: 1, classroomId: 1 }, { unique: true });
module.exports = mongoose.model('RepertoireAssignment', RepertoireAssignmentSchema);
