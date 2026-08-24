const express = require('express');
const Classroom = require('../models/Classroom');
const Feedback = require('../models/Feedback');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/coach', requireRole('coach'), async (req, res) => {
  const feedback = await Feedback.find({ coachId: req.auth.userId }).populate('studentId', 'name email').sort({ createdAt: -1 });
  res.json({ feedback });
});

router.post('/coach', requireRole('coach'), async (req, res) => {
  try {
    const { studentId, message, focusArea = '' } = req.body;
    if (!studentId || !message?.trim()) return res.status(400).json({ msg: 'Student and feedback message are required' });
    const teachesStudent = await Classroom.exists({ coachId: req.auth.userId, students: studentId, active: true });
    if (!teachesStudent) return res.status(403).json({ msg: 'You can only send feedback to your enrolled students' });
    const feedback = await Feedback.create({ coachId: req.auth.userId, studentId, message, focusArea });
    await feedback.populate('studentId', 'name email');
    res.status(201).json({ feedback });
  } catch { res.status(500).json({ msg: 'Unable to send feedback' }); }
});

router.get('/student', requireRole('student'), async (req, res) => {
  const feedback = await Feedback.find({ studentId: req.auth.userId }).populate('coachId', 'name email').sort({ createdAt: -1 });
  res.json({ feedback, unreadCount: feedback.filter(item => !item.readAt).length });
});

router.patch('/student/:id/read', requireRole('student'), async (req, res) => {
  const feedback = await Feedback.findOneAndUpdate({ _id: req.params.id, studentId: req.auth.userId }, { readAt: new Date() }, { new: true }).populate('coachId', 'name email');
  if (!feedback) return res.status(404).json({ msg: 'Feedback not found' });
  res.json({ feedback });
});

module.exports = router;
