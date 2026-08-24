const express = require('express');
const { Chess } = require('chess.js');
const CoachPuzzle = require('../models/CoachPuzzle');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('coach'));

const validatePositionAndSolution = (fen, moves) => {
  let game;
  try { game = new Chess(fen); } catch { return { error: 'Invalid FEN position' }; }
  if (!Array.isArray(moves) || moves.length === 0) return { error: 'Record at least one solution move' };
  const normalizedMoves = [];
  try {
    for (const move of moves) {
      const played = game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
      normalizedMoves.push({ from: played.from, to: played.to, promotion: played.promotion || 'q', san: played.san });
    }
  } catch { return { error: 'Solution contains an illegal move' }; }
  return { normalizedMoves };
};

router.get('/', async (req, res) => {
  const puzzles = await CoachPuzzle.find({ createdBy: req.auth.userId }).sort({ updatedAt: -1 });
  res.json({ puzzles });
});

router.post('/', async (req, res) => {
  try {
    const { title, description = '', initialFen, solutionMoves, hints = [], tags = [], difficulty = 'Medium', status = 'draft' } = req.body;
    if (!title?.trim()) return res.status(400).json({ msg: 'Puzzle title is required' });
    const validation = validatePositionAndSolution(initialFen, solutionMoves);
    if (validation.error) return res.status(400).json({ msg: validation.error });
    const puzzle = await CoachPuzzle.create({ title, description, initialFen, solutionMoves: validation.normalizedMoves, hints: hints.filter(Boolean), tags, difficulty, status, createdBy: req.auth.userId });
    res.status(201).json({ puzzle });
  } catch { res.status(500).json({ msg: 'Unable to save puzzle' }); }
});

router.delete('/:id', async (req, res) => {
  const puzzle = await CoachPuzzle.findOneAndDelete({ _id: req.params.id, createdBy: req.auth.userId });
  if (!puzzle) return res.status(404).json({ msg: 'Puzzle not found' });
  res.json({ msg: 'Puzzle deleted' });
});

module.exports = router;
module.exports.validatePositionAndSolution = validatePositionAndSolution;
