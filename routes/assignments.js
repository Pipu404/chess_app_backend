const express = require('express');
const Assignment = require('../models/Assignment');
const Classroom = require('../models/Classroom');
const CoachPuzzle = require('../models/CoachPuzzle');
const PuzzleAttempt = require('../models/PuzzleAttempt');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/coach', requireRole('coach'), async (req, res) => {
  const assignments = await Assignment.find({ coachId: req.auth.userId }).populate('classroomId', 'name students').populate('puzzleIds', 'title difficulty').sort({ dueAt: 1 });
  res.json({ assignments });
});

router.post('/coach', requireRole('coach'), async (req, res) => {
  try {
    const { title, instructions = '', classroomId, puzzleIds, dueAt } = req.body;
    if (!title?.trim() || !classroomId || !Array.isArray(puzzleIds) || !puzzleIds.length || !dueAt) return res.status(400).json({ msg: 'Title, classroom, puzzles, and due date are required' });
    const classroom = await Classroom.findOne({ _id: classroomId, coachId: req.auth.userId });
    if (!classroom) return res.status(403).json({ msg: 'You do not own this classroom' });
    const ownedPuzzleCount = await CoachPuzzle.countDocuments({ _id: { $in: puzzleIds }, createdBy: req.auth.userId });
    if (ownedPuzzleCount !== puzzleIds.length) return res.status(403).json({ msg: 'Assignments can only use your custom puzzles' });
    const assignment = await Assignment.create({ title, instructions, classroomId, puzzleIds, dueAt, coachId: req.auth.userId });
    await assignment.populate('classroomId', 'name students'); await assignment.populate('puzzleIds', 'title difficulty');
    res.status(201).json({ assignment });
  } catch { res.status(500).json({ msg: 'Unable to create assignment' }); }
});

router.get('/student', requireRole('student'), async (req, res) => {
  const classrooms = await Classroom.find({ students: req.auth.userId }).select('_id');
  const assignments = await Assignment.find({ classroomId: { $in: classrooms.map(room => room._id) }, status: 'active' }).populate('classroomId', 'name').populate('puzzleIds', 'title difficulty initialFen hints tags').sort({ dueAt: 1 });
  const attempts = await PuzzleAttempt.find({ studentId: req.auth.userId, completed: true }).select('assignmentId puzzleId accuracy durationSeconds createdAt');
  res.json({ assignments, attempts });
});

router.get('/student/:assignmentId/puzzles/:puzzleId', requireRole('student'), async (req, res) => {
  const classroomIds = await Classroom.find({ students: req.auth.userId }).distinct('_id');
  const assignment = await Assignment.findOne({ _id: req.params.assignmentId, classroomId: { $in: classroomIds }, puzzleIds: req.params.puzzleId, status: 'active' }).select('title instructions dueAt classroomId');
  if (!assignment) return res.status(404).json({ msg: 'Assigned puzzle not found' });
  const puzzle = await CoachPuzzle.findById(req.params.puzzleId).select('title description initialFen solutionMoves hints tags difficulty');
  if (!puzzle) return res.status(404).json({ msg: 'Puzzle not found' });
  res.json({ assignment, puzzle });
});

router.post('/student/:assignmentId/puzzles/:puzzleId/attempts', requireRole('student'), async (req, res) => {
  try {
    const classroomIds = await Classroom.find({ students: req.auth.userId }).distinct('_id');
    const assignment = await Assignment.findOne({ _id: req.params.assignmentId, classroomId: { $in: classroomIds }, puzzleIds: req.params.puzzleId, status: 'active' });
    if (!assignment) return res.status(404).json({ msg: 'Assigned puzzle not found' });
    const puzzle = await CoachPuzzle.findById(req.params.puzzleId);
    if (!puzzle) return res.status(404).json({ msg: 'Puzzle not found' });
    const { playedMoves = [], mistakes = 0, hintsUsed = 0, durationSeconds = 0 } = req.body;
    const completed = playedMoves.length === puzzle.solutionMoves.length && puzzle.solutionMoves.every((move, index) => {
      const played = playedMoves[index];
      return played && played.from === move.from && played.to === move.to && (played.promotion || 'q') === (move.promotion || 'q');
    });
    if (!completed) return res.status(400).json({ msg: 'The submitted move sequence is not the puzzle solution' });
    const safeMistakes = Math.max(0, Number(mistakes) || 0);
    const accuracy = Math.round((puzzle.solutionMoves.length / (puzzle.solutionMoves.length + safeMistakes)) * 100);
    const attempt = await PuzzleAttempt.create({ assignmentId: assignment._id, puzzleId: puzzle._id, studentId: req.auth.userId, playedMoves, mistakes: safeMistakes, hintsUsed: Math.max(0, Number(hintsUsed) || 0), durationSeconds: Math.max(0, Math.round(Number(durationSeconds) || 0)), accuracy, completed: true });
    res.status(201).json({ attempt });
  } catch { res.status(500).json({ msg: 'Unable to save puzzle attempt' }); }
});

module.exports = router;
