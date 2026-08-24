const express = require('express');
const { Chess } = require('chess.js');
const OpeningRepertoire = require('../models/OpeningRepertoire');
const RepertoireAssignment = require('../models/RepertoireAssignment');
const RepertoireProgress = require('../models/RepertoireProgress');
const Classroom = require('../models/Classroom');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

async function accessibleRepertoire(userId, repertoireId) {
  const owned = await OpeningRepertoire.findOne({ _id: repertoireId, ownerId: userId });
  if (owned) return owned;
  const classrooms = await Classroom.find({ students: userId, active: true }).select('_id');
  const assignment = await RepertoireAssignment.findOne({ repertoireId, classroomId: { $in: classrooms.map(room => room._id) }, active: true });
  if (!assignment) return null;
  return OpeningRepertoire.findOne({ _id: repertoireId, published: true });
}

function normalizeMoves(moves) {
  if (!Array.isArray(moves) || !moves.length || moves.length > 60) throw new Error('A line must contain 1–60 legal moves');
  const chess = new Chess();
  return moves.map(move => {
    let played;
    try { played = chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }); } catch { played = null; }
    if (!played) throw new Error(`Illegal move ${move.from || ''}${move.to || ''}`);
    return { from: played.from, to: played.to, promotion: played.promotion || 'q', san: played.san };
  });
}

router.get('/', async (req, res) => {
  try {
    const classrooms = await Classroom.find({ students: req.auth.userId, active: true }).select('_id name');
    const assignments = await RepertoireAssignment.find({ classroomId: { $in: classrooms.map(room => room._id) }, active: true })
      .populate({ path: 'repertoireId', populate: { path: 'ownerId', select: 'name' } }).populate('classroomId', 'name');
    const owned = await OpeningRepertoire.find({ ownerId: req.auth.userId }).populate('ownerId', 'name').sort({ updatedAt: -1 });
    const assignedRepertoires = assignments.filter(item => item.repertoireId?.published).map(item => item.repertoireId);
    const all = [...owned, ...assignedRepertoires.filter(rep => !owned.some(item => String(item._id) === String(rep._id)))];
    const progress = await RepertoireProgress.find({ userId: req.auth.userId, repertoireId: { $in: all.map(item => item._id) } });
    const progressMap = new Map(progress.map(item => [`${item.repertoireId}:${item.lineId}`, item]));
    const now = Date.now();
    const repertoires = all.map(rep => {
      const assignment = assignments.find(item => String(item.repertoireId?._id) === String(rep._id));
      const lines = rep.lines.map(line => {
        const item = progressMap.get(`${rep._id}:${line._id}`);
        return { ...line.toObject(), progress: item ? { repetitions: item.repetitions, intervalDays: item.intervalDays, easeFactor: item.easeFactor, dueAt: item.dueAt, lastGrade: item.lastGrade, due: new Date(item.dueAt).getTime() <= now } : { repetitions: 0, intervalDays: 0, easeFactor: 2.5, dueAt: new Date(0), lastGrade: 0, due: true } };
      });
      return { ...rep.toObject(), lines, isOwner: String(rep.ownerId?._id || rep.ownerId) === req.auth.userId, assignment: assignment ? { classroom: assignment.classroomId?.name, instructions: assignment.instructions, dueAt: assignment.dueAt } : null, dueLines: lines.filter(line => line.progress.due).length, masteredLines: lines.filter(line => line.progress.repetitions >= 3 && line.progress.lastGrade >= 4).length };
    });
    res.json({ repertoires });
  } catch (error) {
    console.error('Opening list error:', error.message);
    res.status(500).json({ msg: 'Unable to load opening repertoires' });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim(); const description = String(req.body.description || '').trim(); const side = req.body.side === 'black' ? 'black' : 'white';
    if (!name || name.length > 100 || description.length > 500) return res.status(400).json({ msg: 'Valid repertoire details are required' });
    const repertoire = await OpeningRepertoire.create({ ownerId: req.auth.userId, name, description, side });
    res.status(201).json({ repertoire });
  } catch { res.status(400).json({ msg: 'Unable to create repertoire' }); }
});

router.post('/:id/lines', async (req, res) => {
  try {
    const repertoire = await OpeningRepertoire.findOne({ _id: req.params.id, ownerId: req.auth.userId });
    if (!repertoire) return res.status(404).json({ msg: 'Repertoire not found' });
    const label = String(req.body.label || '').trim();
    if (!label || label.length > 100) return res.status(400).json({ msg: 'Line label is required' });
    repertoire.lines.push({ label, moves: normalizeMoves(req.body.moves) });
    await repertoire.save();
    res.status(201).json({ repertoire });
  } catch (error) { res.status(400).json({ msg: error.message || 'Unable to add opening line' }); }
});

router.patch('/:id/publish', requireRole('coach'), async (req, res) => {
  const repertoire = await OpeningRepertoire.findOneAndUpdate({ _id: req.params.id, ownerId: req.auth.userId, 'lines.0': { $exists: true } }, { published: Boolean(req.body.published) }, { returnDocument: 'after' });
  if (!repertoire) return res.status(404).json({ msg: 'Add at least one line before publishing' });
  res.json({ repertoire });
});

router.post('/:id/assign', requireRole('coach'), async (req, res) => {
  try {
    const [repertoire, classroom] = await Promise.all([
      OpeningRepertoire.findOne({ _id: req.params.id, ownerId: req.auth.userId, published: true }),
      Classroom.findOne({ _id: req.body.classroomId, coachId: req.auth.userId, active: true })
    ]);
    if (!repertoire || !classroom) return res.status(404).json({ msg: 'Published repertoire or classroom not found' });
    const dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) return res.status(400).json({ msg: 'Due date is invalid' });
    const assignment = await RepertoireAssignment.findOneAndUpdate(
      { repertoireId: repertoire._id, classroomId: classroom._id },
      { coachId: req.auth.userId, instructions: String(req.body.instructions || '').slice(0, 500), dueAt, active: true },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.status(201).json({ assignment });
  } catch { res.status(400).json({ msg: 'Unable to assign repertoire' }); }
});

router.post('/:id/practice', async (req, res) => {
  try {
    const repertoire = await accessibleRepertoire(req.auth.userId, req.params.id);
    if (!repertoire) return res.status(404).json({ msg: 'Repertoire not found' });
    const line = repertoire.lines.id(req.body.lineId); const grade = Math.max(0, Math.min(5, Math.round(Number(req.body.grade))));
    if (!line || !Number.isFinite(grade)) return res.status(400).json({ msg: 'Valid practice result is required' });
    let progress = await RepertoireProgress.findOne({ userId: req.auth.userId, repertoireId: repertoire._id, lineId: line._id });
    if (!progress) progress = new RepertoireProgress({ userId: req.auth.userId, repertoireId: repertoire._id, lineId: line._id });
    if (grade < 3) { progress.repetitions = 0; progress.intervalDays = 1; }
    else {
      progress.repetitions += 1;
      progress.intervalDays = progress.repetitions === 1 ? 1 : progress.repetitions === 2 ? 6 : Math.max(1, Math.round(progress.intervalDays * progress.easeFactor));
    }
    progress.easeFactor = Math.max(1.3, progress.easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
    progress.lastGrade = grade; progress.lastPracticedAt = new Date(); progress.dueAt = new Date(Date.now() + progress.intervalDays * 86_400_000);
    await progress.save();
    res.json({ progress });
  } catch { res.status(400).json({ msg: 'Unable to save practice result' }); }
});

module.exports = router;
