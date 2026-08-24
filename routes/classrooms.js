const express = require('express');
const Classroom = require('../models/Classroom');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createInviteCode } = require('../utils/inviteCode');

const router = express.Router();
router.use(requireAuth);

async function uniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createInviteCode();
    if (!await Classroom.exists({ inviteCode: code })) return code;
  }
  throw new Error('Unable to generate invite code');
}

router.get('/coach', requireRole('coach'), async (req, res) => {
  const classrooms = await Classroom.find({ coachId: req.auth.userId }).populate('students', 'name email role').sort({ updatedAt: -1 });
  res.json({ classrooms });
});

router.post('/coach', requireRole('coach'), async (req, res) => {
  try {
    if (!req.body.name?.trim()) return res.status(400).json({ msg: 'Classroom name is required' });
    const classroom = await Classroom.create({ name: req.body.name, coachId: req.auth.userId, inviteCode: await uniqueInviteCode() });
    res.status(201).json({ classroom });
  } catch { res.status(500).json({ msg: 'Unable to create classroom' }); }
});

router.patch('/coach/:id/invite-code', requireRole('coach'), async (req, res) => {
  const classroom = await Classroom.findOneAndUpdate({ _id: req.params.id, coachId: req.auth.userId }, { inviteCode: await uniqueInviteCode() }, { new: true });
  if (!classroom) return res.status(404).json({ msg: 'Classroom not found' });
  res.json({ classroom });
});

router.delete('/coach/:id/students/:studentId', requireRole('coach'), async (req, res) => {
  const classroom = await Classroom.findOneAndUpdate({ _id: req.params.id, coachId: req.auth.userId }, { $pull: { students: req.params.studentId } }, { new: true }).populate('students', 'name email role');
  if (!classroom) return res.status(404).json({ msg: 'Classroom not found' });
  res.json({ classroom });
});

router.get('/student', requireRole('student'), async (req, res) => {
  const classrooms = await Classroom.find({ students: req.auth.userId, active: true }).populate('coachId', 'name email').sort({ updatedAt: -1 });
  res.json({ classrooms });
});

router.post('/student/join', requireRole('student'), async (req, res) => {
  const code = String(req.body.inviteCode || '').trim().toUpperCase();
  const classroom = await Classroom.findOne({ inviteCode: code, active: true });
  if (!classroom) return res.status(404).json({ msg: 'Invalid or inactive invite code' });
  if (classroom.students.some(id => id.toString() === req.auth.userId)) return res.status(409).json({ msg: 'You already joined this classroom' });
  classroom.students.push(req.auth.userId);
  await classroom.save();
  await classroom.populate('coachId', 'name email');
  res.status(201).json({ classroom });
});

module.exports = router;
module.exports.uniqueInviteCode = uniqueInviteCode;
