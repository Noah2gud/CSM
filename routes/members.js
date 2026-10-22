const express = require('express');
const uuid = require('uuid').v4;
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const db = global.db;

// All routes require authentication
router.use(authenticate);

// ============================================================
// PROFILE
// ============================================================

// GET /api/members/profile
router.get('/profile', (req, res) => {
  const user = db.prepare(`
    SELECT id, full_name, email, phone, address, date_of_birth,
    occupation, next_of_kin, next_of_kin_phone, bvn, credit_score,
    registration_fee_paid, role, status, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Only APPROVED savings count toward totals and loan eligibility
  const weeklySavings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as weeks
    FROM savings WHERE user_id = ? AND type = 'weekly' AND status = 'approved'
  `).get(req.user.id);

  const specialSavings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM savings WHERE user_id = ? AND type = 'special' AND status = 'approved'
  `).get(req.user.id);

  // Pending savings (awaiting admin approval)
  const pendingSavings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt
    FROM savings WHERE user_id = ? AND status = 'pending'
  `).get(req.user.id);

  res.json({
    user: {
      ...user,
      registration_fee_paid: !!user.registration_fee_paid
    },
    savings_summary: {
      weekly_total: weeklySavings.total,
      weekly_weeks: weeklySavings.weeks,
      special_total: specialSavings.total,
      grand_total: weeklySavings.total + specialSavings.total,
      pending_total: pendingSavings.total,
      pending_count: pendingSavings.cnt
    }
  });
});

// PUT /api/members/profile
router.put('/profile', (req, res) => {
  const { address, date_of_birth, occupation, next_of_kin, next_of_kin_phone } = req.body;

  db.prepare(`
    UPDATE users SET
      address = COALESCE(?, address),
      date_of_birth = COALESCE(?, date_of_birth),
      occupation = COALESCE(?, occupation),
      next_of_kin = COALESCE(?, next_of_kin),
      next_of_kin_phone = COALESCE(?, next_of_kin_phone),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(address, date_of_birth, occupation, next_of_kin, next_of_kin_phone, req.user.id);

  res.json({ message: 'Profile updated successfully' });
});

// ============================================================
// SAVINGS
// ============================================================

// GET /api/members/savings
router.get('/savings', (req, res) => {
  const savings = db.prepare(`
    SELECT * FROM savings WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.user.id);

  // Only APPROVED savings count
  const weeklyTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as weeks
    FROM savings WHERE user_id = ? AND type = 'weekly' AND status = 'approved'
  `).get(req.user.id);

  const specialTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM savings WHERE user_id = ? AND type = 'special' AND status = 'approved'
  `).get(req.user.id);

  const pendingTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt
    FROM savings WHERE user_id = ? AND status = 'pending'
  `).get(req.user.id);

  res.json({
    savings,
    summary: {
      weekly_total: weeklyTotal.total,
      weekly_weeks: weeklyTotal.weeks,
      special_total: specialTotal.total,
      grand_total: weeklyTotal.total + specialTotal.total,
      pending_total: pendingTotal.total,
      pending_count: pendingTotal.cnt
    }
  });
});

// POST /api/members/savings — member SUGGESTS a payment (status = pending)
router.post('/savings', (req, res) => {
  const { type, amount, note } = req.body;

  if (!type || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Savings type and a valid amount are required' });
  }

  if (type !== 'weekly' && type !== 'special') {
    return res.status(400).json({ error: 'Savings type must be "weekly" or "special"' });
  }

  // Week number assigned at submission time (based on approved savings count + pending)
  let weekNumber = null;
  let year = null;

  if (type === 'weekly') {
    const count = db.prepare(`
      SELECT COUNT(*) as cnt FROM savings
      WHERE user_id = ? AND type = 'weekly'
    `).get(req.user.id);
    weekNumber = count.cnt + 1;
    year = new Date().getFullYear();
  }

  const id = uuid();
  // Status starts as 'pending' — admin must approve before it counts
  db.prepare(`
    INSERT INTO savings (id, user_id, type, amount, week_number, year, note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(id, req.user.id, type, amount, weekNumber, year, note || null);

  res.status(201).json({
    message: `Payment of N${Number(amount).toLocaleString()} submitted successfully. Awaiting admin approval before it counts.`,
    saving: { id, type, amount, week_number: weekNumber, year, note, status: 'pending' }
  });
});

// ============================================================
// LOANS
// ============================================================

// GET /api/members/loans
router.get('/loans', (req, res) => {
  const loans = db.prepare(`
    SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.user.id);

  res.json({ loans });
});

// POST /api/members/loans - Apply for a loan
router.post('/loans', (req, res) => {
  const { amount_requested, purpose } = req.body;

  if (!amount_requested || amount_requested <= 0) {
    return res.status(400).json({ error: 'A valid loan amount is required' });
  }

  // Only APPROVED weekly savings count for loan eligibility
  const weeklySavings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as weeks
    FROM savings WHERE user_id = ? AND type = 'weekly' AND status = 'approved'
  `).get(req.user.id);

  if (weeklySavings.weeks < 12) {
    return res.status(400).json({
      error: 'Loan requirement not met',
      message: `You need at least 12 weeks of approved weekly savings. You currently have ${weeklySavings.weeks} approved weeks.`,
      weekly_weeks: weeklySavings.weeks,
      required_weeks: 12
    });
  }

  const maxLoanAmount = weeklySavings.total * 2;
  if (amount_requested > maxLoanAmount) {
    return res.status(400).json({
      error: 'Loan amount exceeds limit',
      message: `Maximum loan is 2x your approved weekly savings (N${maxLoanAmount.toLocaleString()}). You requested N${Number(amount_requested).toLocaleString()}.`,
      max_loan: maxLoanAmount,
      weekly_savings_total: weeklySavings.total
    });
  }

  const activeLoans = db.prepare(`
    SELECT COUNT(*) as cnt FROM loans
    WHERE user_id = ? AND status IN ('pending', 'approved', 'in_progress')
  `).get(req.user.id);

  if (activeLoans.cnt > 0) {
    return res.status(400).json({
      error: 'Active loan exists',
      message: 'You already have a pending or active loan. Please complete it before applying for another.'
    });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO loans (id, user_id, amount_requested, purpose)
    VALUES (?, ?, ?, ?)
  `).run(id, req.user.id, amount_requested, purpose || null);

  res.status(201).json({
    message: 'Loan application submitted successfully. An admin will review your request.',
    loan: { id, amount_requested, purpose, status: 'pending' },
    loan_eligibility: {
      weekly_savings_total: weeklySavings.total,
      weekly_weeks: weeklySavings.weeks,
      max_loan_amount: maxLoanAmount
    }
  });
});

// ============================================================
// SUNDAY MEETING CHECK-IN
// ============================================================

// GET /api/members/meetings
router.get('/meetings', (req, res) => {
  const activeMeeting = db.prepare(`
    SELECT * FROM meetings WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1
  `).get();

  let attendance = null;
  if (activeMeeting) {
    attendance = db.prepare(`
      SELECT * FROM meeting_attendance WHERE meeting_id = ? AND user_id = ?
    `).get(activeMeeting.id, req.user.id);
  }

  const history = db.prepare(`
    SELECT ma.*, m.meeting_code, m.meeting_date
    FROM meeting_attendance ma
    JOIN meetings m ON ma.meeting_id = m.id
    WHERE ma.user_id = ?
    ORDER BY ma.created_at DESC
  `).all(req.user.id);

  res.json({
    active_meeting: activeMeeting,
    has_checked_in: !!attendance,
    attendance: attendance,
    history: history
  });
});

// POST /api/members/checkin - Sunday meeting check-in
router.post('/checkin', (req, res) => {
  const { meeting_code, payment_amount } = req.body;

  if (!meeting_code) {
    return res.status(400).json({ error: 'Meeting code is required' });
  }

  const meeting = db.prepare(`
    SELECT * FROM meetings WHERE meeting_code = ? AND is_active = 1
  `).get(meeting_code);

  if (!meeting) {
    return res.status(400).json({ error: 'Invalid or expired meeting code' });
  }

  const existing = db.prepare(`
    SELECT id FROM meeting_attendance WHERE meeting_id = ? AND user_id = ?
  `).get(meeting.id, req.user.id);

  if (existing) {
    return res.status(400).json({ error: 'You have already checked in for this meeting' });
  }

  const id = uuid();
  const amount = payment_amount || 0;
  const paymentMade = amount > 0 ? 1 : 0;

  db.prepare(`
    INSERT INTO meeting_attendance (id, meeting_id, user_id, payment_made, payment_amount)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, meeting.id, req.user.id, paymentMade, amount);

  res.json({
    message: 'Meeting check-in successful!',
    attendance: {
      meeting_code: meeting.meeting_code,
      meeting_date: meeting.meeting_date,
      payment_made: !!paymentMade,
      payment_amount: amount
    }
  });
});

module.exports = router;
