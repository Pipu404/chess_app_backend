const express = require('express');
const { Chess } = require('chess.js');
const Game = require('../models/Game');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const games = await Game.find({ userId: req.auth.userId }).select('mode difficulty timeControl userColor result moves reviewedAt createdAt').sort({ createdAt: -1 });
  res.json({ games });
});

router.post('/', async (req, res) => {
  try {
    const { clientGameId, mode, difficulty = 'Medium', timeControl, userColor, result, moves } = req.body;
    if (!clientGameId || !mode || !timeControl || !userColor || !result?.reason || !result?.winner || !Array.isArray(moves) || !moves.length) return res.status(400).json({ msg: 'Complete game data is required' });
    const existing = await Game.findOne({ userId: req.auth.userId, clientGameId });
    if (existing) return res.json({ game: existing });
    const chess = new Chess(); const normalizedMoves = [];
    for (const move of moves) { const played = chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }); normalizedMoves.push({ from: played.from, to: played.to, promotion: played.promotion || 'q', san: played.san }); }
    const game = await Game.create({ userId: req.auth.userId, clientGameId, mode, difficulty, timeControl, userColor, result, moves: normalizedMoves, pgn: chess.pgn(), finalFen: chess.fen() });
    res.status(201).json({ game });
  } catch (error) {
    if (error?.code === 11000) { const game = await Game.findOne({ userId: req.auth.userId, clientGameId: req.body.clientGameId }); return res.json({ game }); }
    res.status(400).json({ msg: 'Unable to save this completed game' });
  }
});

router.get('/:id', async (req, res) => {
  try { const game = await Game.findOne({ _id: req.params.id, userId: req.auth.userId }); if (!game) return res.status(404).json({ msg: 'Game not found' }); res.json({ game }); }
  catch { res.status(404).json({ msg: 'Game not found' }); }
});

router.patch('/:id/review', async (req, res) => {
  try {
    const allowedClassifications = new Set(['Brilliant', 'Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder']);
    if (!Array.isArray(req.body.review) || !req.body.review.length || req.body.review.length > 600) return res.status(400).json({ msg: 'Review results are required' });
    const existingGame = await Game.findOne({ _id: req.params.id, userId: req.auth.userId }).select('moves');
    if (!existingGame) return res.status(404).json({ msg: 'Game not found' });
    if (existingGame.moves.length !== req.body.review.length) return res.status(400).json({ msg: 'Review must cover every game move' });
    const review = req.body.review.map((move, index) => {
      const played = existingGame.moves[index];
      if (move.index !== index || move.from !== played.from || move.to !== played.to || !allowedClassifications.has(move.classification)) throw new Error('Invalid review move');
      return {
        index, moveNumber: Math.floor(index / 2) + 1, color: move.color === 'b' ? 'b' : 'w',
        san: String(move.san || '').slice(0, 20), from: move.from, to: move.to,
        fen: String(move.fen || '').slice(0, 100), evaluation: Math.max(-100000, Math.min(100000, Number(move.evaluation) || 0)),
        evaluationBefore: Math.max(-100000, Math.min(100000, Number(move.evaluationBefore) || 0)),
        loss: Math.max(0, Math.min(200000, Math.round(Number(move.loss) || 0))), classification: move.classification,
        bestMove: String(move.bestMove || '').slice(0, 20), bestLine: Array.isArray(move.bestLine) ? move.bestLine.slice(0, 8).map(item => String(item).slice(0, 20)) : [],
        explanation: String(move.explanation || '').slice(0, 500)
      };
    });
    const game = await Game.findOneAndUpdate({ _id: req.params.id, userId: req.auth.userId }, { review, reviewVersion: 2, reviewedAt: new Date() }, { returnDocument: 'after' });
    if (!game) return res.status(404).json({ msg: 'Game not found' });
    res.json({ game });
  } catch { res.status(400).json({ msg: 'Unable to save game review' }); }
});

module.exports = router;
