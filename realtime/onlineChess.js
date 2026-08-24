const jwt = require('jsonwebtoken');
const { Chess } = require('chess.js');
const { readCookie } = require('../middleware/auth');
const { SESSION_COOKIE } = require('../utils/session');
const User = require('../models/User');
const Game = require('../models/Game');
const OnlineGame = require('../models/OnlineGame');

const TIME_CONTROL_PATTERN = /^(\d{1,3})\+(\d{1,2})$/;
const DISCONNECT_GRACE_MS = Number(process.env.ONLINE_DISCONNECT_GRACE_MS) || 30_000;
const ELO_K_FACTOR = 32;

function ratingChanges(whiteRating, blackRating, winner) {
  const whiteExpected = 1 / (1 + (10 ** ((blackRating - whiteRating) / 400)));
  const whiteScore = winner === 'White' ? 1 : winner === 'Black' ? 0 : 0.5;
  const whiteChange = Math.round(ELO_K_FACTOR * (whiteScore - whiteExpected));
  return { whiteChange, blackChange: -whiteChange };
}

function parseTimeControl(value) {
  const match = String(value || '').match(TIME_CONTROL_PATTERN);
  if (!match) return null;
  const minutes = Number(match[1]);
  const increment = Number(match[2]);
  if (minutes < 1 || minutes > 180 || increment < 0 || increment > 60) return null;
  return { value: `${minutes}+${increment}`, initialTimeMs: minutes * 60_000, incrementMs: increment * 1_000 };
}

function playerColor(game, userId) {
  return String(game.whiteUserId) === String(userId) ? 'w' : String(game.blackUserId) === String(userId) ? 'b' : null;
}

function liveClock(game, now = Date.now()) {
  let whiteTimeMs = game.whiteTimeMs;
  let blackTimeMs = game.blackTimeMs;
  if (game.status === 'active') {
    const turn = new Chess(game.fen).turn();
    const elapsed = Math.max(0, now - new Date(game.activeSince).getTime());
    if (turn === 'w') whiteTimeMs = Math.max(0, whiteTimeMs - elapsed);
    else blackTimeMs = Math.max(0, blackTimeMs - elapsed);
  }
  return { whiteTimeMs, blackTimeMs };
}

function publicState(game, userId, connectedUsers = new Map()) {
  const clocks = liveClock(game);
  const color = playerColor(game, userId);
  return {
    gameId: String(game._id),
    color,
    opponentName: color === 'w' ? game.blackName : game.whiteName,
    opponentRating: color === 'w' ? game.blackRatingBefore + game.blackRatingChange : game.whiteRatingBefore + game.whiteRatingChange,
    playerRating: color === 'w' ? game.whiteRatingBefore + game.whiteRatingChange : game.blackRatingBefore + game.blackRatingChange,
    ratingChange: color === 'w' ? game.whiteRatingChange : game.blackRatingChange,
    opponentConnected: (connectedUsers.get(String(color === 'w' ? game.blackUserId : game.whiteUserId)) || 0) > 0,
    whiteName: game.whiteName,
    blackName: game.blackName,
    timeControl: game.timeControl,
    fen: game.fen,
    moves: game.moves,
    whiteTimeMs: clocks.whiteTimeMs,
    blackTimeMs: clocks.blackTimeMs,
    activeSince: game.activeSince,
    drawOfferFromOpponent: Boolean(game.drawOfferedBy) && String(game.drawOfferedBy) !== String(userId),
    drawOfferPending: Boolean(game.drawOfferedBy) && String(game.drawOfferedBy) === String(userId),
    status: game.status,
    result: game.result?.winner ? game.result : null
  };
}

function initializeOnlineChess(io) {
  const queue = [];
  const timeoutHandles = new Map();
  const busyGames = new Set();
  const connectedUsers = new Map();
  const disconnectHandles = new Map();
  const rematchRequests = new Map();

  const clearGameTimeout = gameId => {
    const handle = timeoutHandles.get(String(gameId));
    if (handle) clearTimeout(handle);
    timeoutHandles.delete(String(gameId));
  };

  const emitState = game => {
    io.to(`user:${game.whiteUserId}`).emit('online:state', publicState(game, game.whiteUserId, connectedUsers));
    io.to(`user:${game.blackUserId}`).emit('online:state', publicState(game, game.blackUserId, connectedUsers));
  };

  const createOnlineGame = async ({ white, black, control, rematchOf = null }) => {
    const chess = new Chess();
    return OnlineGame.create({
      whiteUserId: white.userId, blackUserId: black.userId, whiteName: white.name, blackName: black.name,
      whiteRatingBefore: white.rating, blackRatingBefore: black.rating,
      timeControl: control.value, initialTimeMs: control.initialTimeMs, incrementMs: control.incrementMs,
      whiteTimeMs: control.initialTimeMs, blackTimeMs: control.initialTimeMs,
      activeSince: new Date(), fen: chess.fen(), moves: [], rematchOf
    });
  };

  const saveHistory = async game => {
    const chess = new Chess();
    for (const move of game.moves) chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    const base = {
      mode: 'online', difficulty: 'Online opponent', timeControl: game.timeControl,
      result: game.result, moves: game.moves, pgn: chess.pgn(), finalFen: game.fen
    };
    await Promise.all([
      Game.updateOne(
        { userId: game.whiteUserId, clientGameId: `online:${game._id}:white` },
        { $setOnInsert: { ...base, userId: game.whiteUserId, clientGameId: `online:${game._id}:white`, userColor: 'w' } },
        { upsert: true }
      ),
      Game.updateOne(
        { userId: game.blackUserId, clientGameId: `online:${game._id}:black` },
        { $setOnInsert: { ...base, userId: game.blackUserId, clientGameId: `online:${game._id}:black`, userColor: 'b' } },
        { upsert: true }
      )
    ]);
  };

  const finishGame = async (game, result) => {
    if (game.status !== 'active') return;
    const clocks = liveClock(game);
    const changes = ratingChanges(game.whiteRatingBefore, game.blackRatingBefore, result.winner);
    const completedGame = await OnlineGame.findOneAndUpdate(
      { _id: game._id, status: 'active' },
      { $set: {
        whiteTimeMs: clocks.whiteTimeMs, blackTimeMs: clocks.blackTimeMs,
        status: 'completed', result, completedAt: new Date(), ratingApplied: true,
        whiteRatingChange: changes.whiteChange, blackRatingChange: changes.blackChange
      } },
      { returnDocument: 'after' }
    );
    if (!completedGame) return;
    const whiteResult = result.winner === 'Draw' ? 'draw' : result.winner === 'White' ? 'win' : 'loss';
    const blackResult = result.winner === 'Draw' ? 'draw' : result.winner === 'Black' ? 'win' : 'loss';
    await Promise.all([
      User.updateOne({ _id: completedGame.whiteUserId }, {
        $set: { chessRating: completedGame.whiteRatingBefore + changes.whiteChange },
        $push: { ratingHistory: { $each: [{ rating: completedGame.whiteRatingBefore + changes.whiteChange, change: changes.whiteChange, opponentName: completedGame.blackName, result: whiteResult, gameId: completedGame._id }], $slice: -100 } }
      }),
      User.updateOne({ _id: completedGame.blackUserId }, {
        $set: { chessRating: completedGame.blackRatingBefore + changes.blackChange },
        $push: { ratingHistory: { $each: [{ rating: completedGame.blackRatingBefore + changes.blackChange, change: changes.blackChange, opponentName: completedGame.whiteName, result: blackResult, gameId: completedGame._id }], $slice: -100 } }
      })
    ]);
    clearGameTimeout(completedGame._id);
    await saveHistory(completedGame);
    emitState(completedGame);
  };

  const scheduleTimeout = game => {
    clearGameTimeout(game._id);
    if (game.status !== 'active') return;
    const turn = new Chess(game.fen).turn();
    const clocks = liveClock(game);
    const remaining = turn === 'w' ? clocks.whiteTimeMs : clocks.blackTimeMs;
    const handle = setTimeout(async () => {
      try {
        const current = await OnlineGame.findById(game._id);
        if (!current || current.status !== 'active') return;
        const currentTurn = new Chess(current.fen).turn();
        const currentClocks = liveClock(current);
        const expired = currentTurn === 'w' ? currentClocks.whiteTimeMs <= 0 : currentClocks.blackTimeMs <= 0;
        if (expired) await finishGame(current, { reason: 'timeout', winner: currentTurn === 'w' ? 'Black' : 'White' });
        else scheduleTimeout(current);
      } catch (error) {
        console.error('Online timeout error:', error.message);
      }
    }, Math.max(1, remaining + 25));
    timeoutHandles.set(String(game._id), handle);
  };

  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      if (!token) return next(new Error('Authentication required'));
      const auth = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(auth.userId).select('name role chessRating');
      if (!user) return next(new Error('Account not found'));
      socket.user = { id: String(user._id), name: user.name, role: user.role, rating: user.chessRating || 1200 };
      return next();
    } catch {
      return next(new Error('Session expired or invalid'));
    }
  });

  io.on('connection', async socket => {
    const userRoom = `user:${socket.user.id}`;
    socket.join(userRoom);
    connectedUsers.set(socket.user.id, (connectedUsers.get(socket.user.id) || 0) + 1);
    const disconnectHandle = disconnectHandles.get(socket.user.id);
    if (disconnectHandle) clearTimeout(disconnectHandle);
    disconnectHandles.delete(socket.user.id);

    try {
      const active = await OnlineGame.findOne({
        status: 'active', $or: [{ whiteUserId: socket.user.id }, { blackUserId: socket.user.id }]
      }).sort({ updatedAt: -1 });
      if (active) {
        emitState(active);
        scheduleTimeout(active);
      }
    } catch (error) {
      socket.emit('online:error', { message: 'Could not restore your active game.' });
    }

    socket.on('online:join-queue', async payload => {
      try {
        const control = parseTimeControl(payload?.timeControl);
        if (!control) return socket.emit('online:error', { message: 'Invalid time control.' });
        const active = await OnlineGame.findOne({
          status: 'active', $or: [{ whiteUserId: socket.user.id }, { blackUserId: socket.user.id }]
        });
        if (active) return socket.emit('online:state', publicState(active, socket.user.id, connectedUsers));

        const existingIndex = queue.findIndex(entry => entry.userId === socket.user.id);
        if (existingIndex >= 0) queue.splice(existingIndex, 1);
        const now = Date.now();
        const opponentIndex = queue.findIndex(entry => {
          const searchRange = Math.min(800, 250 + Math.floor((now - entry.queuedAt) / 15_000) * 100);
          return entry.timeControl === control.value && entry.userId !== socket.user.id && Math.abs(entry.rating - socket.user.rating) <= searchRange;
        });
        if (opponentIndex < 0) {
          queue.push({ socketId: socket.id, userId: socket.user.id, name: socket.user.name, rating: socket.user.rating, queuedAt: now, timeControl: control.value, side: payload?.side === 'Black' ? 'Black' : 'White' });
          return socket.emit('online:queue-status', { waiting: true, rating: socket.user.rating, message: 'Searching for a similarly rated opponent…' });
        }

        const opponent = queue.splice(opponentIndex, 1)[0];
        const requester = { userId: socket.user.id, name: socket.user.name, rating: socket.user.rating, side: payload?.side === 'Black' ? 'Black' : 'White' };
        const white = opponent.side === 'White' ? opponent : requester;
        const black = white.userId === opponent.userId ? requester : opponent;
        const game = await createOnlineGame({ white, black, control });
        io.to(`user:${opponent.userId}`).emit('online:queue-status', { waiting: false });
        socket.emit('online:queue-status', { waiting: false });
        emitState(game);
        scheduleTimeout(game);
      } catch (error) {
        console.error('Online matchmaking error:', error.message);
        socket.emit('online:error', { message: 'Matchmaking failed. Please try again.' });
      }
    });

    socket.on('online:leave-queue', () => {
      const index = queue.findIndex(entry => entry.userId === socket.user.id);
      if (index >= 0) queue.splice(index, 1);
      socket.emit('online:queue-status', { waiting: false });
    });

    socket.on('online:move', async payload => {
      const lockKey = String(payload?.gameId || '');
      if (!lockKey || busyGames.has(lockKey)) return socket.emit('online:error', { message: 'Your previous game action is still processing.' });
      busyGames.add(lockKey);
      try {
        const game = await OnlineGame.findById(payload?.gameId);
        if (!game || game.status !== 'active') return socket.emit('online:error', { message: 'This game is no longer active.' });
        const color = playerColor(game, socket.user.id);
        const chess = new Chess(game.fen);
        if (!color || chess.turn() !== color) return socket.emit('online:error', { message: 'It is not your turn.' });
        const clocks = liveClock(game);
        if ((color === 'w' ? clocks.whiteTimeMs : clocks.blackTimeMs) <= 0) {
          return finishGame(game, { reason: 'timeout', winner: color === 'w' ? 'Black' : 'White' });
        }
        let move;
        try { move = chess.move({ from: payload.from, to: payload.to, promotion: payload.promotion || 'q' }); } catch { move = null; }
        if (!move) return socket.emit('online:error', { message: 'Illegal move.' });
        game.whiteTimeMs = clocks.whiteTimeMs + (color === 'w' ? game.incrementMs : 0);
        game.blackTimeMs = clocks.blackTimeMs + (color === 'b' ? game.incrementMs : 0);
        game.activeSince = new Date();
        game.fen = chess.fen();
        game.drawOfferedBy = null;
        game.moves.push({ from: move.from, to: move.to, promotion: move.promotion || 'q', san: move.san });
        await game.save();
        if (chess.isGameOver()) {
          const result = chess.isCheckmate()
            ? { reason: 'checkmate', winner: chess.turn() === 'w' ? 'Black' : 'White' }
            : { reason: 'draw', winner: 'Draw' };
          await finishGame(game, result);
        } else {
          emitState(game);
          scheduleTimeout(game);
        }
      } catch (error) {
        console.error('Online move error:', error.message);
        socket.emit('online:error', { message: 'Your move could not be played.' });
      } finally {
        busyGames.delete(lockKey);
      }
    });

    socket.on('online:offer-draw', async payload => {
      try {
        const game = await OnlineGame.findById(payload?.gameId);
        if (!game || game.status !== 'active' || !playerColor(game, socket.user.id)) return;
        game.drawOfferedBy = socket.user.id;
        await game.save();
        emitState(game);
      } catch {
        socket.emit('online:error', { message: 'Could not send the draw offer.' });
      }
    });

    socket.on('online:respond-draw', async payload => {
      const lockKey = String(payload?.gameId || '');
      if (!lockKey || busyGames.has(lockKey)) return;
      busyGames.add(lockKey);
      try {
        const game = await OnlineGame.findById(lockKey);
        if (!game || game.status !== 'active' || !game.drawOfferedBy || String(game.drawOfferedBy) === socket.user.id || !playerColor(game, socket.user.id)) return;
        if (payload.accept) await finishGame(game, { reason: 'draw agreement', winner: 'Draw' });
        else {
          game.drawOfferedBy = null;
          await game.save();
          emitState(game);
        }
      } catch {
        socket.emit('online:error', { message: 'Could not respond to the draw offer.' });
      } finally {
        busyGames.delete(lockKey);
      }
    });

    socket.on('online:rematch', async payload => {
      try {
        const previous = await OnlineGame.findById(payload?.gameId);
        if (!previous || previous.status !== 'completed' || !playerColor(previous, socket.user.id)) return;
        const key = String(previous._id);
        const requests = rematchRequests.get(key) || new Set();
        requests.add(socket.user.id);
        rematchRequests.set(key, requests);
        const otherUserId = String(previous.whiteUserId) === socket.user.id ? String(previous.blackUserId) : String(previous.whiteUserId);
        io.to(`user:${otherUserId}`).emit('online:rematch-status', { gameId: key, requestedByOpponent: true });
        socket.emit('online:rematch-status', { gameId: key, pending: true });
        if (!requests.has(otherUserId)) return;
        const [oldWhite, oldBlack] = await Promise.all([
          User.findById(previous.whiteUserId).select('name chessRating'),
          User.findById(previous.blackUserId).select('name chessRating')
        ]);
        if (!oldWhite || !oldBlack) return;
        const control = parseTimeControl(previous.timeControl);
        const game = await createOnlineGame({
          white: { userId: String(oldBlack._id), name: oldBlack.name, rating: oldBlack.chessRating || 1200 },
          black: { userId: String(oldWhite._id), name: oldWhite.name, rating: oldWhite.chessRating || 1200 },
          control,
          rematchOf: previous._id
        });
        rematchRequests.delete(key);
        emitState(game);
        scheduleTimeout(game);
      } catch (error) {
        console.error('Online rematch error:', error.message);
        socket.emit('online:error', { message: 'Could not start the rematch.' });
      }
    });

    socket.on('online:resign', async payload => {
      const lockKey = String(payload?.gameId || '');
      if (!lockKey || busyGames.has(lockKey)) return socket.emit('online:error', { message: 'Your previous game action is still processing.' });
      busyGames.add(lockKey);
      try {
        const game = await OnlineGame.findById(payload?.gameId);
        if (!game || game.status !== 'active') return;
        const color = playerColor(game, socket.user.id);
        if (!color) return;
        await finishGame(game, { reason: 'resigned', winner: color === 'w' ? 'Black' : 'White' });
      } catch (error) {
        socket.emit('online:error', { message: 'Could not resign the game.' });
      } finally {
        busyGames.delete(lockKey);
      }
    });

    socket.on('disconnect', () => {
      const index = queue.findIndex(entry => entry.socketId === socket.id);
      if (index >= 0) queue.splice(index, 1);
      const remainingConnections = Math.max(0, (connectedUsers.get(socket.user.id) || 1) - 1);
      if (remainingConnections > 0) {
        connectedUsers.set(socket.user.id, remainingConnections);
        return;
      }
      connectedUsers.delete(socket.user.id);
      OnlineGame.findOne({ status: 'active', $or: [{ whiteUserId: socket.user.id }, { blackUserId: socket.user.id }] })
        .then(game => {
          if (!game) return;
          emitState(game);
          const handle = setTimeout(async () => {
            try {
              if ((connectedUsers.get(socket.user.id) || 0) > 0) return;
              const current = await OnlineGame.findById(game._id);
              if (!current || current.status !== 'active') return;
              const color = playerColor(current, socket.user.id);
              await finishGame(current, { reason: 'abandoned', winner: color === 'w' ? 'Black' : 'White' });
            } catch (error) {
              console.error('Online abandonment error:', error.message);
            } finally {
              disconnectHandles.delete(socket.user.id);
            }
          }, DISCONNECT_GRACE_MS);
          disconnectHandles.set(socket.user.id, handle);
        })
        .catch(error => console.error('Online disconnect error:', error.message));
    });
  });
}

module.exports = initializeOnlineChess;
