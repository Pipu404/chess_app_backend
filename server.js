require('./utils/environment').loadEnvironment();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const coachPuzzleRoutes = require('./routes/coachPuzzles');
const classroomRoutes = require('./routes/classrooms');
const assignmentRoutes = require('./routes/assignments');
const analyticsRoutes = require('./routes/analytics');
const feedbackRoutes = require('./routes/feedback');
const globalPuzzleRoutes = require('./routes/globalPuzzles');
const gameRoutes = require('./routes/games');
const improvementRoutes = require('./routes/improvement');
const openingRoutes = require('./routes/openings');
const initializeOnlineChess = require('./realtime/onlineChess');

function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return;
  const required = ['MONGODB_URI', 'JWT_SECRET', 'CLIENT_ORIGIN', 'COACH_REGISTRATION_CODE'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(', ')}`);
  if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  if (process.env.COACH_REGISTRATION_CODE.length < 12) throw new Error('COACH_REGISTRATION_CODE must contain at least 12 characters');
}

validateProductionEnvironment();

const app = express();
const server = http.createServer(app);
const allowedOrigins = String(process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || 'http://localhost:3000').split(',').map(origin => origin.trim()).filter(Boolean);
const isPrivateDevelopmentOrigin = (origin) => {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.port !== '3000') return false;
    const host = url.hostname;
    return host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
};
const originAllowed = origin => !origin
  || allowedOrigins.includes(origin)
  || isPrivateDevelopmentOrigin(origin);
const corsOptions = {
  origin(origin, callback) { callback(originAllowed(origin) ? null : new Error('Origin not allowed'), originAllowed(origin)); },
  credentials: true
};
const io = new Server(server, {
  cors: corsOptions,
  allowRequest(request, callback) { callback(null, originAllowed(request.headers.origin)); }
});

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cors(corsOptions));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '1mb' }));

const databaseReady = mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB connection error:', err.message); throw err; });

app.get('/api/health', async (req, res) => {
  try { await databaseReady; } catch { return res.status(503).json({ status: 'unhealthy', database: 'disconnected' }); }
  const connected = mongoose.connection.readyState === 1;
  return res.status(connected ? 200 : 503).json({ status: connected ? 'healthy' : 'unhealthy', database: connected ? 'connected' : 'disconnected', uptimeSeconds: Math.round(process.uptime()) });
});

app.use('/api/auth', authRoutes);
app.use('/api/coach/puzzles', coachPuzzleRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/global-puzzles', globalPuzzleRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/improvement', improvementRoutes);
app.use('/api/openings', openingRoutes);

app.use((error, req, res, next) => {
  if (error?.message === 'Origin not allowed') return res.status(403).json({ msg: 'Origin not allowed' });
  return next(error);
});

initializeOnlineChess(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; closing server gracefully`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  io.close();
  server.close(async () => {
    await mongoose.disconnect();
    clearTimeout(forceExit);
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
