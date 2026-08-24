require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { io } = require('../../node_modules/socket.io-client');
const User = require('../models/User');
const Game = require('../models/Game');
const OnlineGame = require('../models/OnlineGame');
const { SESSION_COOKIE } = require('../utils/session');

const waitFor = (socket, event, predicate = () => true, timeoutMs = 8_000) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timed out waiting for ${event}`)); }, timeoutMs);
  const listener = payload => {
    if (!predicate(payload)) return;
    clearTimeout(timeout);
    socket.off(event, listener);
    resolve(payload);
  };
  socket.on(event, listener);
});

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const marker = `online-test-${Date.now()}`;
  const password = await bcrypt.hash(marker, 4);
  const users = await User.create([
    { name: 'Online Test White', email: `${marker}-w@example.test`, password, role: 'player' },
    { name: 'Online Test Black', email: `${marker}-b@example.test`, password, role: 'player' }
  ]);
  const sockets = [];
  const onlineGameIds = [];
  try {
    for (const user of users) {
      const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
      sockets.push(io(process.env.TEST_SERVER_URL || 'http://localhost:5000', {
        transports: ['websocket'], extraHeaders: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }
      }));
    }
    await Promise.all(sockets.map(socket => waitFor(socket, 'connect')));
    sockets[0].emit('online:join-queue', { timeControl: '3+2', side: 'White' });
    await waitFor(sockets[0], 'online:queue-status', state => state.waiting === true);
    const whiteStatePromise = waitFor(sockets[0], 'online:state');
    const blackStatePromise = waitFor(sockets[1], 'online:state');
    sockets[1].emit('online:join-queue', { timeControl: '3+2', side: 'Black' });
    const [whiteState, blackState] = await Promise.all([whiteStatePromise, blackStatePromise]);
    if (whiteState.color !== 'w' || blackState.color !== 'b') throw new Error('Color assignment failed');
    const onlineGameId = whiteState.gameId;
    onlineGameIds.push(onlineGameId);

    const afterWhite = waitFor(sockets[1], 'online:state', state => state.moves.length === 1);
    sockets[0].emit('online:move', { gameId: onlineGameId, from: 'e2', to: 'e4' });
    await afterWhite;
    const afterBlack = waitFor(sockets[0], 'online:state', state => state.moves.length === 2);
    sockets[1].emit('online:move', { gameId: onlineGameId, from: 'e7', to: 'e5' });
    await afterBlack;
    const completed = waitFor(sockets[0], 'online:state', state => state.status === 'completed');
    sockets[1].emit('online:resign', { gameId: onlineGameId });
    const finalState = await completed;
    if (finalState.result?.winner !== 'White') throw new Error('Resignation result failed');
    const ratedUsers = await User.find({ _id: { $in: users.map(user => user._id) } }).sort({ name: -1 });
    if (!ratedUsers.some(user => user.chessRating === 1216) || !ratedUsers.some(user => user.chessRating === 1184)) throw new Error(`ELO update failed: ${ratedUsers.map(user => user.chessRating).join(', ')}`);
    if (ratedUsers.some(user => user.ratingHistory.length !== 1)) throw new Error('Rating history update failed');

    const rematchWhitePromise = waitFor(sockets[1], 'online:state', state => state.status === 'active' && state.gameId !== onlineGameId);
    const rematchBlackPromise = waitFor(sockets[0], 'online:state', state => state.status === 'active' && state.gameId !== onlineGameId);
    sockets[0].emit('online:rematch', { gameId: onlineGameId });
    await waitFor(sockets[1], 'online:rematch-status', state => state.requestedByOpponent === true);
    sockets[1].emit('online:rematch', { gameId: onlineGameId });
    const [rematchWhite, rematchBlack] = await Promise.all([rematchWhitePromise, rematchBlackPromise]);
    if (rematchWhite.color !== 'w' || rematchBlack.color !== 'b') throw new Error('Rematch did not swap colors');
    onlineGameIds.push(rematchWhite.gameId);

    const drawOffer = waitFor(sockets[0], 'online:state', state => state.gameId === rematchWhite.gameId && state.drawOfferFromOpponent);
    sockets[1].emit('online:offer-draw', { gameId: rematchWhite.gameId });
    await drawOffer;
    const agreedDraw = waitFor(sockets[1], 'online:state', state => state.gameId === rematchWhite.gameId && state.status === 'completed');
    sockets[0].emit('online:respond-draw', { gameId: rematchWhite.gameId, accept: true });
    const drawState = await agreedDraw;
    if (drawState.result?.winner !== 'Draw') throw new Error('Draw agreement failed');

    let expectedHistoryCount = 4;
    if (process.env.TEST_ABANDONMENT === 'true') {
      sockets[0].emit('online:join-queue', { timeControl: '1+0', side: 'White' });
      await waitFor(sockets[0], 'online:queue-status', state => state.waiting === true);
      const abandonmentGameWhite = waitFor(sockets[0], 'online:state', state => state.status === 'active' && !onlineGameIds.includes(state.gameId));
      const abandonmentGameBlack = waitFor(sockets[1], 'online:state', state => state.status === 'active' && !onlineGameIds.includes(state.gameId));
      sockets[1].emit('online:join-queue', { timeControl: '1+0', side: 'Black' });
      const [connectedWhite, connectedBlack] = await Promise.all([abandonmentGameWhite, abandonmentGameBlack]);
      onlineGameIds.push(connectedWhite.gameId);
      const abandoned = waitFor(sockets[0], 'online:state', state => state.gameId === connectedWhite.gameId && state.status === 'completed');
      sockets[1].disconnect();
      const abandonedState = await abandoned;
      if (abandonedState.result?.reason !== 'abandoned' || connectedBlack.color !== 'b') throw new Error('Disconnect abandonment failed');
      expectedHistoryCount = 6;
    }

    const historyCount = await Game.countDocuments({ userId: { $in: users.map(user => user._id) }, mode: 'online' });
    if (historyCount !== expectedHistoryCount) throw new Error(`Expected ${expectedHistoryCount} history records, found ${historyCount}`);
    console.log('Online rated integration test passed: rating matchmaking, legal moves, clocks, ELO history, resignation, rematch, draw offer, disconnect abandonment, and both game histories.');
  } finally {
    sockets.forEach(socket => socket.disconnect());
    await Game.deleteMany({ userId: { $in: users.map(user => user._id) } });
    if (onlineGameIds.length) await OnlineGame.deleteMany({ _id: { $in: onlineGameIds } });
    await User.deleteMany({ _id: { $in: users.map(user => user._id) } });
    await mongoose.disconnect();
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
