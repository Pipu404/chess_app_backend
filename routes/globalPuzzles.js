const express = require('express');
const GlobalPuzzle = require('../models/GlobalPuzzle');
const GlobalPuzzleAttempt = require('../models/GlobalPuzzleAttempt');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const STARTER_PUZZLES = [
  { slug: 'protected-queen-mate', title: 'Protected Queen Mate', instruction: 'White to move and checkmate in one.', hint: 'The bishop on c3 protects a queen capture near the king.', fen: '6k1/6pp/7Q/8/8/2B5/8/6K1 w - - 0 1', solution: { from: 'h6', to: 'g7', promotion: 'q' }, tags: ['Mate'], rating: 900 },
  { slug: 'back-rank-finish', title: 'Back-Rank Finish', instruction: 'White to move and checkmate in one.', hint: 'Use the open e-file to reach the eighth rank.', fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', solution: { from: 'e1', to: 'e8', promotion: 'q' }, tags: ['Mate'], rating: 1050 },
  { slug: 'open-king-punishment', title: 'Open King Punishment', instruction: 'Black to move and checkmate in one.', hint: 'The queen attacks the exposed king along a diagonal.', fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', solution: { from: 'd8', to: 'h4', promotion: 'q' }, tags: ['Mate', 'Discovery'], rating: 1150 }
];

async function ensureStarterPuzzles() {
  if (await GlobalPuzzle.exists({ published: true })) return;
  await GlobalPuzzle.insertMany(STARTER_PUZZLES, { ordered: false });
}

router.get('/', async (req, res) => {
  try {
    await ensureStarterPuzzles();
    const [puzzles, user, attempts] = await Promise.all([
      GlobalPuzzle.find({ published: true }).sort({ slug: 1 }),
      User.findById(req.auth.userId).select('puzzleRating'),
      GlobalPuzzleAttempt.find({ userId: req.auth.userId }).select('puzzleId accuracy ratingChange durationSeconds')
    ]);
    const dayNumber = Math.floor(Date.now() / 86400000);
    res.json({ puzzles, dailyPuzzleId: puzzles[dayNumber % puzzles.length]._id, puzzleRating: user?.puzzleRating || 1200, attempts });
  } catch { res.status(500).json({ msg: 'Unable to load rated puzzles' }); }
});

router.post('/:id/attempts', async (req, res) => {
  try {
    const puzzle = await GlobalPuzzle.findOne({ _id: req.params.id, published: true });
    if (!puzzle) return res.status(404).json({ msg: 'Puzzle not found' });
    const existing = await GlobalPuzzleAttempt.findOne({ puzzleId: puzzle._id, userId: req.auth.userId });
    if (existing) return res.status(409).json({ msg: 'This puzzle already has a rated result', attempt: existing });
    const { from, to, promotion = 'q', mistakes = 0, hintsUsed = 0, durationSeconds = 0 } = req.body;
    if (from !== puzzle.solution.from || to !== puzzle.solution.to || promotion !== (puzzle.solution.promotion || 'q')) return res.status(400).json({ msg: 'The submitted move is not the puzzle solution' });
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(401).json({ msg: 'User account not found' });
    const safeMistakes = Math.max(0, Number(mistakes) || 0); const safeHints = Math.max(0, Number(hintsUsed) || 0);
    const accuracy = Math.max(0, Math.round(100 - safeMistakes * 20 - safeHints * 10));
    const expectedScore = 1 / (1 + 10 ** ((puzzle.rating - user.puzzleRating) / 400));
    const actualScore = accuracy / 100; const ratingChange = Math.round(32 * (actualScore - expectedScore));
    const ratingBefore = user.puzzleRating; const ratingAfter = Math.max(100, Math.min(3000, ratingBefore + ratingChange));
    const attempt = await GlobalPuzzleAttempt.create({ puzzleId: puzzle._id, userId: user._id, mistakes: safeMistakes, hintsUsed: safeHints, durationSeconds: Math.max(1, Math.round(Number(durationSeconds) || 0)), accuracy, ratingBefore, ratingAfter, ratingChange });
    user.puzzleRating = ratingAfter; await user.save();
    puzzle.plays += 1; puzzle.solves += 1; puzzle.rating = Math.max(100, Math.min(3000, puzzle.rating - ratingChange)); await puzzle.save();
    res.status(201).json({ attempt, puzzleRating: ratingAfter, puzzle: { rating: puzzle.rating, plays: puzzle.plays, solves: puzzle.solves } });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ msg: 'This puzzle already has a rated result' });
    res.status(500).json({ msg: 'Unable to save rated attempt' });
  }
});

module.exports = router;
module.exports.ensureStarterPuzzles = ensureStarterPuzzles;
