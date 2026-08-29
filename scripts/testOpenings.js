require('../utils/environment').loadEnvironment();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Classroom = require('../models/Classroom');
const OpeningRepertoire = require('../models/OpeningRepertoire');
const RepertoireAssignment = require('../models/RepertoireAssignment');
const RepertoireProgress = require('../models/RepertoireProgress');
const { SESSION_COOKIE } = require('../utils/session');

async function request(path, cookie, options = {}) {
  const response = await fetch(`${process.env.TEST_SERVER_URL || 'http://localhost:5000'}${path}`, { ...options, headers: { Cookie: cookie, 'Content-Type': 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.msg || 'Request failed'}`);
  return data;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const marker = `opening-test-${Date.now()}`; const password = await bcrypt.hash(marker, 4);
  const [coach, student] = await User.create([{ name: 'Opening Coach', email: `${marker}-coach@example.test`, password, role: 'coach' }, { name: 'Opening Student', email: `${marker}-student@example.test`, password, role: 'student' }]);
  const classroom = await Classroom.create({ name: 'Opening Test Class', coachId: coach._id, inviteCode: marker.slice(-8).toUpperCase(), students: [student._id] });
  const cookieFor = user => `${SESSION_COOKIE}=${encodeURIComponent(jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '5m' }))}`;
  const coachCookie = cookieFor(coach); const studentCookie = cookieFor(student); let repertoireId;
  try {
    const created = await request('/api/openings', coachCookie, { method: 'POST', body: JSON.stringify({ name: 'Italian Game', side: 'white', description: 'Class repertoire' }) });
    repertoireId = created.repertoire._id;
    const line = await request(`/api/openings/${repertoireId}/lines`, coachCookie, { method: 'POST', body: JSON.stringify({ label: 'Main line', moves: [{ from: 'e2', to: 'e4' }, { from: 'e7', to: 'e5' }, { from: 'g1', to: 'f3' }, { from: 'b8', to: 'c6' }, { from: 'f1', to: 'c4' }] }) });
    if (line.repertoire.lines[0].moves.map(move => move.san).join(' ') !== 'e4 e5 Nf3 Nc6 Bc4') throw new Error('Legal move normalization failed');
    const lineId = line.repertoire.lines[0]._id;
    await request(`/api/openings/${repertoireId}/publish`, coachCookie, { method: 'PATCH', body: JSON.stringify({ published: true }) });
    await request(`/api/openings/${repertoireId}/assign`, coachCookie, { method: 'POST', body: JSON.stringify({ classroomId: classroom._id, instructions: 'Practice the main line' }) });
    const studentLibrary = await request('/api/openings', studentCookie);
    if (studentLibrary.repertoires[0]?.assignment?.classroom !== classroom.name || studentLibrary.repertoires[0]?.dueLines !== 1) throw new Error('Coach assignment visibility failed');
    const firstReview = await request(`/api/openings/${repertoireId}/practice`, studentCookie, { method: 'POST', body: JSON.stringify({ lineId, grade: 5 }) });
    if (firstReview.progress.repetitions !== 1 || firstReview.progress.intervalDays !== 1) throw new Error('First spaced review failed');
    await RepertoireProgress.updateOne({ _id: firstReview.progress._id }, { dueAt: new Date(0) });
    const secondReview = await request(`/api/openings/${repertoireId}/practice`, studentCookie, { method: 'POST', body: JSON.stringify({ lineId, grade: 5 }) });
    if (secondReview.progress.repetitions !== 2 || secondReview.progress.intervalDays !== 6) throw new Error('Spaced repetition interval failed');
    console.log('Opening repertoire integration test passed: legal line creation, publishing, classroom assignment, student access, and spaced repetition.');
  } finally {
    await RepertoireProgress.deleteMany({ userId: student._id });
    if (repertoireId) { await RepertoireAssignment.deleteMany({ repertoireId }); await OpeningRepertoire.deleteOne({ _id: repertoireId }); }
    await Classroom.deleteOne({ _id: classroom._id });
    await User.deleteMany({ _id: { $in: [coach._id, student._id] } });
    await mongoose.disconnect();
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
