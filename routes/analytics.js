const express = require('express');
const Assignment = require('../models/Assignment');
const Classroom = require('../models/Classroom');
const PuzzleAttempt = require('../models/PuzzleAttempt');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

router.get('/', requireRole('coach'), async (req, res) => {
  try {
    const classrooms = await Classroom.find({ coachId: req.auth.userId, active: true })
      .populate('students', 'name email')
      .select('name students');
    const assignments = await Assignment.find({ coachId: req.auth.userId })
      .populate('puzzleIds', 'title tags difficulty')
      .select('classroomId puzzleIds');
    const assignmentIds = assignments.map(assignment => assignment._id);
    const attempts = await PuzzleAttempt.find({ assignmentId: { $in: assignmentIds }, completed: true })
      .populate('studentId', 'name email')
      .populate('puzzleId', 'title tags difficulty')
      .sort({ createdAt: -1 });

    const studentMap = new Map();
    for (const classroom of classrooms) {
      for (const student of classroom.students) {
        const id = student._id.toString();
        if (!studentMap.has(id)) studentMap.set(id, { _id: id, name: student.name, email: student.email, classrooms: [], assignedKeys: new Set() });
        studentMap.get(id).classrooms.push({ _id: classroom._id.toString(), name: classroom.name });
      }
    }
    for (const assignment of assignments) {
      const classroom = classrooms.find(room => room._id.toString() === assignment.classroomId.toString());
      if (!classroom) continue;
      for (const student of classroom.students) {
        const record = studentMap.get(student._id.toString());
        for (const puzzle of assignment.puzzleIds) record?.assignedKeys.add(`${assignment._id}:${puzzle._id}`);
      }
    }

    const bestAttempts = new Map();
    for (const attempt of attempts) {
      if (!attempt.studentId || !attempt.puzzleId) continue;
      const key = `${attempt.studentId._id}:${attempt.assignmentId}:${attempt.puzzleId._id}`;
      const current = bestAttempts.get(key);
      if (!current || attempt.accuracy > current.accuracy || (attempt.accuracy === current.accuracy && attempt.durationSeconds < current.durationSeconds)) bestAttempts.set(key, attempt);
    }

    const students = [...studentMap.values()].map(student => {
      const results = [...bestAttempts.values()].filter(attempt => attempt.studentId._id.toString() === student._id);
      const tagMap = new Map();
      for (const attempt of results) for (const tag of attempt.puzzleId.tags || []) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag).push(attempt.accuracy);
      }
      const tacticalAreas = [...tagMap.entries()].map(([tag, scores]) => ({ tag, accuracy: average(scores), attempts: scores.length })).sort((a, b) => a.accuracy - b.accuracy);
      return {
        _id: student._id,
        name: student.name,
        email: student.email,
        classrooms: student.classrooms,
        assignedPuzzles: student.assignedKeys.size,
        completedPuzzles: results.length,
        completionRate: student.assignedKeys.size ? Math.round((results.length / student.assignedKeys.size) * 100) : 0,
        averageAccuracy: average(results.map(attempt => attempt.accuracy)),
        averageTime: average(results.map(attempt => attempt.durationSeconds)),
        totalMistakes: results.reduce((sum, attempt) => sum + attempt.mistakes, 0),
        hintsUsed: results.reduce((sum, attempt) => sum + attempt.hintsUsed, 0),
        tacticalAreas,
        weakAreas: tacticalAreas.filter(area => area.accuracy < 70).map(area => area.tag)
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const completedStudents = students.filter(student => student.completedPuzzles > 0);
    res.json({
      summary: {
        totalStudents: students.length,
        activeStudents: completedStudents.length,
        completedPuzzles: students.reduce((sum, student) => sum + student.completedPuzzles, 0),
        averageAccuracy: average(completedStudents.map(student => student.averageAccuracy)),
        averageTime: average(completedStudents.map(student => student.averageTime))
      },
      classrooms: classrooms.map(classroom => ({ _id: classroom._id, name: classroom.name })),
      students
    });
  } catch { res.status(500).json({ msg: 'Unable to load analytics' }); }
});

router.get('/student', requireRole('student'), async (req, res) => {
  try {
    const classrooms = await Classroom.find({ students: req.auth.userId, active: true }).select('name');
    const classroomIds = classrooms.map(classroom => classroom._id);
    const assignments = await Assignment.find({ classroomId: { $in: classroomIds }, status: 'active' })
      .populate('classroomId', 'name')
      .populate('puzzleIds', 'title tags difficulty')
      .sort({ dueAt: 1 });
    const attempts = await PuzzleAttempt.find({ studentId: req.auth.userId, completed: true })
      .populate('puzzleId', 'title tags difficulty')
      .sort({ createdAt: -1 });

    const bestAttempts = new Map();
    for (const attempt of attempts) {
      if (!attempt.puzzleId) continue;
      const key = `${attempt.assignmentId}:${attempt.puzzleId._id}`;
      const current = bestAttempts.get(key);
      if (!current || attempt.accuracy > current.accuracy || (attempt.accuracy === current.accuracy && attempt.durationSeconds < current.durationSeconds)) bestAttempts.set(key, attempt);
    }
    const bestResults = [...bestAttempts.values()];
    const tagMap = new Map();
    for (const attempt of bestResults) for (const tag of attempt.puzzleId.tags || []) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(attempt.accuracy);
    }
    const tacticalAreas = [...tagMap.entries()].map(([tag, scores]) => ({ tag, accuracy: average(scores), attempts: scores.length })).sort((a, b) => b.accuracy - a.accuracy);
    const assignedPuzzles = assignments.reduce((sum, assignment) => sum + assignment.puzzleIds.length, 0);
    const assignmentSummaries = assignments.map(assignment => {
      const completed = assignment.puzzleIds.filter(puzzle => bestAttempts.has(`${assignment._id}:${puzzle._id}`)).length;
      return { _id: assignment._id, title: assignment.title, classroom: assignment.classroomId?.name, dueAt: assignment.dueAt, totalPuzzles: assignment.puzzleIds.length, completedPuzzles: completed, remainingPuzzles: assignment.puzzleIds.length - completed };
    });

    res.json({
      summary: {
        classrooms: classrooms.length,
        assignments: assignments.length,
        assignedPuzzles,
        completedPuzzles: bestResults.length,
        completionRate: assignedPuzzles ? Math.round((bestResults.length / assignedPuzzles) * 100) : 0,
        averageAccuracy: average(bestResults.map(attempt => attempt.accuracy)),
        averageTime: average(bestResults.map(attempt => attempt.durationSeconds)),
        totalPracticeAttempts: attempts.length
      },
      tacticalAreas,
      strengths: tacticalAreas.filter(area => area.accuracy >= 80).map(area => area.tag),
      weakAreas: tacticalAreas.filter(area => area.accuracy < 70).map(area => area.tag),
      assignments: assignmentSummaries,
      recentAttempts: attempts.slice(0, 6).map(attempt => ({ _id: attempt._id, puzzle: attempt.puzzleId?.title || 'Puzzle', accuracy: attempt.accuracy, durationSeconds: attempt.durationSeconds, mistakes: attempt.mistakes, createdAt: attempt.createdAt }))
    });
  } catch { res.status(500).json({ msg: 'Unable to load student progress' }); }
});

module.exports = router;
