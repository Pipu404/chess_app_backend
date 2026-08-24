const express = require('express');
const User = require('../models/User');
const Game = require('../models/Game');
const GlobalPuzzle = require('../models/GlobalPuzzle');
const GlobalPuzzleAttempt = require('../models/GlobalPuzzleAttempt');
const PuzzleAttempt = require('../models/PuzzleAttempt');
const ImprovementGoal = require('../models/ImprovementGoal');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const METRICS = new Set(['puzzle_rating', 'chess_rating', 'puzzle_accuracy', 'games_reviewed', 'puzzles_solved']);
const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

function currentFor(metric, summary) {
  return {
    puzzle_rating: summary.puzzleRating,
    chess_rating: summary.chessRating,
    puzzle_accuracy: summary.puzzleAccuracy,
    games_reviewed: summary.gamesReviewed,
    puzzles_solved: summary.puzzlesSolved
  }[metric] || 0;
}

router.get('/', async (req, res) => {
  try {
    const [user, globalAttempts, coachAttempts, reviewedGames, goals] = await Promise.all([
      User.findById(req.auth.userId).select('puzzleRating chessRating ratingHistory'),
      GlobalPuzzleAttempt.find({ userId: req.auth.userId }).populate('puzzleId', 'title tags').sort({ createdAt: -1 }),
      PuzzleAttempt.find({ studentId: req.auth.userId, completed: true }).populate('puzzleId', 'title tags').sort({ createdAt: -1 }),
      Game.find({ userId: req.auth.userId, reviewedAt: { $ne: null } }).select('review mode result createdAt').sort({ createdAt: -1 }),
      ImprovementGoal.find({ userId: req.auth.userId, active: true }).sort({ createdAt: -1 })
    ]);
    if (!user) return res.status(401).json({ msg: 'User account not found' });

    const allAttempts = [...globalAttempts, ...coachAttempts].filter(attempt => attempt.puzzleId);
    const tagMap = new Map();
    for (const attempt of allAttempts) for (const tag of attempt.puzzleId.tags || []) {
      const key = tag.trim();
      if (!key) continue;
      if (!tagMap.has(key)) tagMap.set(key, []);
      tagMap.get(key).push(attempt.accuracy);
    }
    const tacticalThemes = [...tagMap.entries()]
      .map(([tag, scores]) => ({ tag, accuracy: average(scores), attempts: scores.length }))
      .sort((a, b) => a.accuracy - b.accuracy);
    const weakThemes = tacticalThemes.filter(theme => theme.accuracy < 70);
    const strongThemes = tacticalThemes.filter(theme => theme.accuracy >= 80).sort((a, b) => b.accuracy - a.accuracy);

    const reviewedMoves = reviewedGames.flatMap(game => game.review || []);
    const classifications = reviewedMoves.reduce((counts, move) => ({ ...counts, [move.classification]: (counts[move.classification] || 0) + 1 }), {});
    const costlyMoves = reviewedMoves.filter(move => ['Inaccuracy', 'Mistake', 'Blunder'].includes(move.classification));
    const gameWeaknesses = ['Blunder', 'Mistake', 'Inaccuracy'].map(classification => ({ classification, count: classifications[classification] || 0 })).filter(item => item.count > 0);
    const summary = {
      puzzleRating: user.puzzleRating || 1200,
      chessRating: user.chessRating || 1200,
      puzzleAccuracy: average(allAttempts.map(attempt => attempt.accuracy)),
      puzzlesSolved: allAttempts.length,
      gamesReviewed: reviewedGames.length,
      costlyMoves: costlyMoves.length
    };

    const recommendationTags = weakThemes.slice(0, 3).map(theme => theme.tag);
    const recommendedPuzzles = recommendationTags.length
      ? await GlobalPuzzle.find({ published: true, tags: { $in: recommendationTags } }).select('title tags rating').limit(6)
      : await GlobalPuzzle.find({ published: true }).select('title tags rating').sort({ rating: 1 }).limit(3);
    const recommendations = [
      ...weakThemes.slice(0, 3).map(theme => ({ type: 'tactics', title: `Train ${theme.tag}`, detail: `${theme.accuracy}% accuracy across ${theme.attempts} attempt${theme.attempts === 1 ? '' : 's'}.`, href: '/puzzles', priority: 100 - theme.accuracy })),
      ...(gameWeaknesses.find(item => item.classification === 'Blunder') ? [{ type: 'review', title: 'Review recent blunders', detail: `${classifications.Blunder} blunder${classifications.Blunder === 1 ? '' : 's'} found in analyzed games.`, href: '/games', priority: 90 }] : []),
      ...(reviewedGames.length === 0 ? [{ type: 'review', title: 'Analyze a completed game', detail: 'Engine reviews reveal recurring decision-making mistakes.', href: '/games', priority: 80 }] : []),
      ...(allAttempts.length < 5 ? [{ type: 'practice', title: 'Build a tactical baseline', detail: 'Solve at least five rated puzzles for more precise recommendations.', href: '/puzzles', priority: 75 }] : [])
    ].sort((a, b) => b.priority - a.priority).slice(0, 5);

    res.json({
      summary,
      tacticalThemes,
      strengths: strongThemes.slice(0, 4),
      weaknesses: weakThemes.slice(0, 4),
      gameWeaknesses,
      recommendations,
      recommendedPuzzles,
      ratingTrend: (user.ratingHistory || []).slice(-12).map(entry => ({ rating: entry.rating, change: entry.change, playedAt: entry.playedAt })),
      recentMistakes: costlyMoves.slice(-8).reverse().map(move => ({ san: move.san, classification: move.classification, loss: move.loss, bestMove: move.bestMove, explanation: move.explanation })),
      goals: goals.map(goal => ({ ...goal.toObject(), current: currentFor(goal.metric, summary), completed: currentFor(goal.metric, summary) >= goal.target }))
    });
  } catch (error) {
    console.error('Improvement dashboard error:', error.message);
    res.status(500).json({ msg: 'Unable to load your improvement dashboard' });
  }
});

router.post('/goals', async (req, res) => {
  try {
    const metric = String(req.body.metric || ''); const target = Math.round(Number(req.body.target));
    const title = String(req.body.title || '').trim();
    if (!METRICS.has(metric) || !title || title.length > 100 || !Number.isFinite(target) || target < 1 || target > 100000) return res.status(400).json({ msg: 'Valid goal details are required' });
    const activeGoals = await ImprovementGoal.countDocuments({ userId: req.auth.userId, active: true });
    if (activeGoals >= 8) return res.status(400).json({ msg: 'Complete or remove an existing goal before adding another' });
    const deadline = req.body.deadline ? new Date(req.body.deadline) : null;
    if (deadline && Number.isNaN(deadline.getTime())) return res.status(400).json({ msg: 'Deadline is invalid' });
    const goal = await ImprovementGoal.create({ userId: req.auth.userId, metric, target, title, deadline });
    res.status(201).json({ goal });
  } catch { res.status(400).json({ msg: 'Unable to create this goal' }); }
});

router.patch('/goals/:id', async (req, res) => {
  try {
    const target = Math.round(Number(req.body.target)); const title = String(req.body.title || '').trim();
    if (!title || title.length > 100 || !Number.isFinite(target) || target < 1 || target > 100000) return res.status(400).json({ msg: 'Valid goal details are required' });
    const deadline = req.body.deadline ? new Date(req.body.deadline) : null;
    if (deadline && Number.isNaN(deadline.getTime())) return res.status(400).json({ msg: 'Deadline is invalid' });
    const goal = await ImprovementGoal.findOneAndUpdate({ _id: req.params.id, userId: req.auth.userId, active: true }, { title, target, deadline }, { returnDocument: 'after' });
    if (!goal) return res.status(404).json({ msg: 'Goal not found' });
    res.json({ goal });
  } catch { res.status(400).json({ msg: 'Unable to update this goal' }); }
});

router.delete('/goals/:id', async (req, res) => {
  try {
    const goal = await ImprovementGoal.findOneAndUpdate({ _id: req.params.id, userId: req.auth.userId, active: true }, { active: false }, { returnDocument: 'after' });
    if (!goal) return res.status(404).json({ msg: 'Goal not found' });
    res.json({ msg: 'Goal removed' });
  } catch { res.status(400).json({ msg: 'Unable to remove this goal' }); }
});

module.exports = router;
