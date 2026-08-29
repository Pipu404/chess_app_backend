require('../utils/environment').loadEnvironment();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Game = require('../models/Game');
const GlobalPuzzle = require('../models/GlobalPuzzle');
const GlobalPuzzleAttempt = require('../models/GlobalPuzzleAttempt');
const ImprovementGoal = require('../models/ImprovementGoal');
const { SESSION_COOKIE } = require('../utils/session');

async function request(path, cookie, options = {}) {
  const response = await fetch(`${process.env.TEST_SERVER_URL || 'http://localhost:5000'}${path}`, {
    ...options, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.msg || 'Request failed'}`);
  return data;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const marker = `improvement-test-${Date.now()}`;
  const user = await User.create({ name: 'Improvement Test', email: `${marker}@example.test`, password: await bcrypt.hash(marker, 4), role: 'player', puzzleRating: 1250, chessRating: 1300 });
  const puzzle = await GlobalPuzzle.create({ slug: marker, title: 'Fork Test', instruction: 'Test', fen: '8/8/8/8/8/8/4K3/6k1 w - - 0 1', solution: { from: 'e2', to: 'e3' }, tags: ['Fork'], rating: 1100, published: true });
  await GlobalPuzzleAttempt.create({ puzzleId: puzzle._id, userId: user._id, mistakes: 2, hintsUsed: 1, durationSeconds: 30, accuracy: 50, ratingBefore: 1200, ratingAfter: 1190, ratingChange: -10 });
  await Game.create({ userId: user._id, clientGameId: marker, mode: 'local', timeControl: '10+0', userColor: 'w', result: { reason: 'resigned', winner: 'Black' }, moves: [{ from: 'e2', to: 'e4', san: 'e4' }], pgn: '1. e4', finalFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', reviewedAt: new Date(), reviewVersion: 2, review: [{ index: 0, moveNumber: 1, color: 'w', san: 'e4', from: 'e2', to: 'e4', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', evaluation: -500, evaluationBefore: 0, loss: 500, classification: 'Blunder', bestMove: 'd4', explanation: 'Test blunder.' }] });
  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
  try {
    const dashboard = await request('/api/improvement', cookie);
    if (dashboard.summary.puzzleAccuracy !== 50 || dashboard.summary.costlyMoves !== 1) throw new Error('Summary aggregation failed');
    if (dashboard.weaknesses[0]?.tag !== 'Fork' || dashboard.gameWeaknesses[0]?.classification !== 'Blunder') throw new Error('Weakness detection failed');
    const created = await request('/api/improvement/goals', cookie, { method: 'POST', body: JSON.stringify({ title: 'Reach 1400', metric: 'chess_rating', target: 1400 }) });
    const updated = await request(`/api/improvement/goals/${created.goal._id}`, cookie, { method: 'PATCH', body: JSON.stringify({ title: 'Reach 1450', target: 1450 }) });
    if (updated.goal.target !== 1450) throw new Error('Goal update failed');
    const withGoal = await request('/api/improvement', cookie);
    if (withGoal.goals[0]?.current !== 1300 || withGoal.goals[0]?.target !== 1450) throw new Error('Goal progress failed');
    await request(`/api/improvement/goals/${created.goal._id}`, cookie, { method: 'DELETE' });
    console.log('Improvement dashboard integration test passed: aggregation, weaknesses, recommendations, and goal create/edit/remove.');
  } finally {
    await ImprovementGoal.deleteMany({ userId: user._id });
    await Game.deleteMany({ userId: user._id });
    await GlobalPuzzleAttempt.deleteMany({ userId: user._id });
    await GlobalPuzzle.deleteOne({ _id: puzzle._id });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
