const express = require('express');
const uuid = require('uuid').v4;
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const db = global.db;

// All routes require admin authentication
router.use(authenticate, requireAdmin);

// ============================================================
// DASHBOARD STATS
// ============================================================

// GET /api/admin/dashboard
router.get('/dashboard', (req, res) => {
  const totalMembers = db.prepare(`
    SELECT COUNT(*) as cnt FROM users WHERE role = 'member'
  `).get();

  const approvedMembers = db.prepare(`
    SELECT COUNT(*) as cnt FROM users WHERE role = 'member' AND status = 'approved'
  `).get();

  const pendingMembers = db.prepare(`
    SELECT COUNT(*) as cnt FROM users WHERE role = 'member' AND status = 'pending'
  `).get();

  const totalSavings = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'weekly' THEN amount ELSE 0 END), 0) as weekly,
      COALESCE(SUM(CASE WHEN type = 'special' THEN amount ELSE 0 END), 0) as special,
      COALESCE(SUM(amount), 0) as grand_total
    FROM savings
  `).get();

  const pendingLoans = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(amount_requested), 0) as total
    FROM loans WHERE status = 'pending'
  `).get();

  const approvedLoans = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(amount_requested), 0) as total
    FROM loans WHERE status = 'approved'
  `).get();

  const inProgressLoans = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(amount_requested), 0) as total
    FROM loans WHERE status = 'in_progress'
  `).get();

  const rejectedLoans = db.prepare(`
    SELECT COUNT(*) as cnt FROM loans WHERE status = 'rejected'
  `).get();

  const activeMeeting = db.prepare(`
    SELECT * FROM meetings WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1
  `).get();

  let meetingAttendanceCount = 0;
  if (activeMeeting) {
    meetingAttendanceCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM meeting_attendance WHERE meeting_id = ?
    `).get(activeMeeting.id).cnt;
  }

  // Available funds = total savings - approved loans amount
  const availableFunds = totalSavings.grand_total - approvedLoans.total - inProgressLoans.total;

  res.json({
    stats: {
      total_members: totalMembers.cnt,
      approved_members: approvedMembers.cnt,
      pending_members: pendingMembers.cnt,
      total_weekly_savings: totalSavings.weekly,
      total_special_savings: totalSavings.special,
      grand_total_savings: totalSavings.grand_total,
      available_funds: availableFunds,
      pending_loans: pendingLoans.cnt,
      pending_loans_amount: pendingLoans.total,
      approved_loans: approvedLoans.cnt,
      approved_loans_amount: approvedLoans.total,
      in_progress_loans: inProgressLoans.cnt,
      in_progress_loans_amount: inProgressLoans.total,
      rejected_loans: rejectedLoans.cnt,
      active_meeting: activeMeeting,
      meeting_attendance: meetingAttendanceCount
    }
  });
});

// ============================================================
// MEMBERS MANAGEMENT
// ============================================================

// GET /api/admin/members - All members
router.get('/members', (req, res) => {
  const members = db.prepare(`
    SELECT
      u.id, u.full_name, u.email, u.phone, u.address, u.date_of_birth,
      u.occupation, u.next_of_kin, u.next_of_kin_phone, u.bvn,
      u.credit_score, u.registration_fee_paid, u.role, u.status, u.created_at,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id = u.id AND type = 'weekly'), 0) as weekly_savings,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id = u.id AND type = 'special'), 0) as special_savings,
      COALESCE((SELECT COUNT(*) FROM savings WHERE user_id = u.id AND type = 'weekly'), 0) as weeks_saved,
      COALESCE((SELECT COUNT(*) FROM meeting_attendance WHERE user_id = u.id), 0) as meetings_attended,
      COALESCE((SELECT COUNT(*) FROM loans WHERE user_id = u.id AND status = 'rejected'), 0) as rejected_loans,
      COALESCE((SELECT COUNT(*) FROM loans WHERE user_id = u.id AND status IN ('approved', 'in_progress')), 0) as active_loans
    FROM users u
    WHERE u.role = 'member'
    ORDER BY u.created_at DESC
  `).all();

  res.json({ members });
});

// GET /api/admin/members/:id - Specific member with full details
router.get('/members/:id', (req, res) => {
  const member = db.prepare(`
    SELECT
      id, full_name, email, phone, address, date_of_birth,
      occupation, next_of_kin, next_of_kin_phone, bvn,
      credit_score, registration_fee_paid, role, status, created_at
    FROM users WHERE id = ? AND role = 'member'
  `).get(req.params.id);

  if (!member) {
    return res.status(404).json({ error: 'Member not found' });
  }

  const savings = db.prepare(`
    SELECT * FROM savings WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.params.id);

  const loans = db.prepare(`
    SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.params.id);

  const attendance = db.prepare(`
    SELECT ma.*, m.meeting_code, m.meeting_date
    FROM meeting_attendance ma
    JOIN meetings m ON ma.meeting_id = m.id
    WHERE ma.user_id = ?
    ORDER BY ma.created_at DESC
  `).all(req.params.id);

  const weeklySummary = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as weeks
    FROM savings WHERE user_id = ? AND type = 'weekly'
  `).get(req.params.id);

  const specialSummary = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM savings WHERE user_id = ? AND type = 'special'
  `).get(req.params.id);

  res.json({
    member: {
      ...member,
      registration_fee_paid: !!member.registration_fee_paid
    },
    savings,
    loans,
    attendance,
    savings_summary: {
      weekly_total: weeklySummary.total,
      weekly_weeks: weeklySummary.weeks,
      special_total: specialSummary.total,
      grand_total: weeklySummary.total + specialSummary.total,
      max_loan_eligible: weeklySummary.total * 2,
      meets_12_week_requirement: weeklySummary.weeks >= 12
    }
  });
});

// PUT /api/admin/members/:id/status - Update member status
router.put('/members/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, req.params.id);

  res.json({ message: `Member status updated to ${status}` });
});

// ============================================================
// LOAN MANAGEMENT
// ============================================================

// GET /api/admin/loans - All loan requests
router.get('/loans', (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT
      l.id, l.amount_requested, l.purpose, l.status, l.admin_comment,
      l.created_at, l.updated_at,
      u.id as user_id, u.full_name, u.phone, u.email,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id = u.id AND type = 'weekly'), 0) as weekly_savings,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id = u.id AND type = 'special'), 0) as special_savings,
      COALESCE((SELECT COUNT(*) FROM savings WHERE user_id = u.id AND type = 'weekly'), 0) as weeks_saved,
      COALESCE((SELECT COUNT(*) FROM meeting_attendance WHERE user_id = u.id), 0) as meetings_attended,
      COALESCE((SELECT COUNT(*) FROM loans WHERE user_id = u.id AND status = 'rejected'), 0) as rejected_loans_count,
      COALESCE((SELECT COUNT(*) FROM loans WHERE user_id = u.id AND status IN ('approved', 'in_progress')), 0) as completed_loans_count,
      u.credit_score
    FROM loans l
    JOIN users u ON l.user_id = u.id
  `;
  const params = [];
  if (status) {
    query += ` WHERE l.status = ?`;
    params.push(status);
  }
  query += ` ORDER BY l.created_at DESC`;

  const loans = db.prepare(query).all(...params);

  res.json({ loans });
});

// PUT /api/admin/loans/:id - Update loan status and comment
router.put('/loans/:id', (req, res) => {
  const { status, admin_comment } = req.body;

  if (!['pending', 'approved', 'in_progress', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid loan status' });
  }

  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(req.params.id);
  if (!loan) {
    return res.status(404).json({ error: 'Loan not found' });
  }

  db.prepare(`
    UPDATE loans SET
      status = ?,
      admin_comment = COALESCE(?, admin_comment),
      reviewed_by = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(status, admin_comment, req.user.id, req.params.id);

  res.json({
    message: `Loan status updated to ${status}`,
    loan: { id: req.params.id, status, admin_comment }
  });
});

// ============================================================
// LOAN SUGGESTION SYSTEM
// ============================================================

// GET /api/admin/loans/:id/suggestion - AI-assisted loan suggestion
router.get('/loans/:id/suggestion', (req, res) => {
  const loan = db.prepare(`
    SELECT l.*, u.full_name, u.credit_score
    FROM loans l
    JOIN users u ON l.user_id = u.id
    WHERE l.id = ?
  `).get(req.params.id);

  if (!loan) {
    return res.status(404).json({ error: 'Loan not found' });
  }

  // Gather member performance data
  const weeklySavings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as weeks
    FROM savings WHERE user_id = ? AND type = 'weekly'
  `).get(loan.user_id);

  const meetingsAttended = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(payment_amount), 0) as total_paid
    FROM meeting_attendance WHERE user_id = ?
  `).get(loan.user_id);

  const totalMeetings = db.prepare(`SELECT COUNT(*) as cnt FROM meetings`).get();
  const attendanceRate = totalMeetings.cnt > 0
    ? (meetingsAttended.cnt / totalMeetings.cnt) * 100
    : 0;

  const rejectedLoans = db.prepare(`
    SELECT COUNT(*) as cnt FROM loans WHERE user_id = ? AND status = 'rejected'
  `).get(loan.user_id);

  const completedLoans = db.prepare(`
    SELECT COUNT(*) as cnt FROM loans WHERE user_id = ? AND status IN ('approved', 'in_progress')
  `).get(loan.user_id);

  // Cooperative available funds
  const cooperativeFunds = db.prepare(`
    SELECT
      COALESCE(SUM(s.amount), 0) as total_savings,
      COALESCE((SELECT SUM(amount_requested) FROM loans WHERE status IN ('approved', 'in_progress')), 0) as outstanding_loans
    FROM savings s
  `).get();

  const availableFunds = cooperativeFunds.total_savings - cooperativeFunds.outstanding_loans;

  // Calculate suggestion score (0-100)
  let score = 0;
  const factors = [];

  // Factor 1: Credit score (max 25 points)
  const creditScorePoints = Math.min((loan.credit_score / 850) * 25, 25);
  score += creditScorePoints;
  factors.push({
    factor: 'Credit Score',
    detail: `Score: ${loan.credit_score}/850`,
    points: creditScorePoints.toFixed(1),
    max_points: 25
  });

  // Factor 2: Savings consistency - weeks saved (max 20 points)
  const weeksPoints = Math.min((weeklySavings.weeks / 24) * 20, 20); // 24+ weeks = full marks
  score += weeksPoints;
  factors.push({
    factor: 'Savings Consistency',
    detail: `${weeklySavings.weeks} weeks of weekly savings`,
    points: weeksPoints.toFixed(1),
    max_points: 20
  });

  // Factor 3: Loan-to-savings ratio (max 20 points)
  const maxLoan = weeklySavings.total * 2;
  const loanRatio = maxLoan > 0 ? loan.amount_requested / maxLoan : 1;
  // Lower ratio = better (asking for less relative to max = safer)
  const ratioPoints = Math.max(0, 20 - (loanRatio * 20));
  score += ratioPoints;
  factors.push({
    factor: 'Loan-to-Savings Ratio',
    detail: `Requesting N${loan.amount_requested.toLocaleString()} of max N${maxLoan.toLocaleString()} (${(loanRatio * 100).toFixed(1)}%)`,
    points: ratioPoints.toFixed(1),
    max_points: 20
  });

  // Factor 4: Meeting attendance (max 15 points)
  const attendancePoints = (attendanceRate / 100) * 15;
  score += attendancePoints;
  factors.push({
    factor: 'Meeting Attendance',
    detail: `${meetingsAttended.cnt}/${totalMeetings.cnt} meetings (${attendanceRate.toFixed(1)}%)`,
    points: attendancePoints.toFixed(1),
    max_points: 15
  });

  // Factor 5: Loan history (max 10 points)
  let loanHistoryPoints = 10;
  if (rejectedLoans.cnt > 0) {
    loanHistoryPoints = Math.max(0, 10 - (rejectedLoans.cnt * 5));
  }
  if (completedLoans.cnt > 0) {
    loanHistoryPoints = Math.min(10, loanHistoryPoints + (completedLoans.cnt * 2));
  }
  score += loanHistoryPoints;
  factors.push({
    factor: 'Loan History',
    detail: `${completedLoans.cnt} completed, ${rejectedLoans.cnt} rejected`,
    points: loanHistoryPoints.toFixed(1),
    max_points: 10
  });

  // Factor 6: Cooperative available funds (max 10 points)
  let fundsPoints = 0;
  if (availableFunds >= loan.amount_requested * 2) {
    fundsPoints = 10; // Plenty of funds
  } else if (availableFunds >= loan.amount_requested) {
    fundsPoints = 6; // Enough for this loan
  } else if (availableFunds >= loan.amount_requested * 0.5) {
    fundsPoints = 3; // Tight
  } else {
    fundsPoints = 0; // Insufficient
  }
  score += fundsPoints;
  factors.push({
    factor: 'Cooperative Available Funds',
    detail: `N${availableFunds.toLocaleString()} available, loan requests N${loan.amount_requested.toLocaleString()}`,
    points: fundsPoints.toFixed(1),
    max_points: 10
  });

  const totalScore = Math.round(score);

  // Generate recommendation
  let recommendation = '';
  let recommendationLevel = '';
  let canAfford = availableFunds >= loan.amount_requested;

  if (!canAfford) {
    recommendation = `REJECT: The cooperative does not have sufficient funds (N${availableFunds.toLocaleString()} available) to cover this loan of N${loan.amount_requested.toLocaleString()}.`;
    recommendationLevel = 'reject';
  } else if (totalScore >= 75) {
    recommendation = `STRONGLY ACCEPT: This member shows excellent financial behavior with a score of ${totalScore}/100. Credit score is good, savings are consistent, and attendance is regular. The cooperative has sufficient funds to approve this loan.`;
    recommendationLevel = 'accept';
  } else if (totalScore >= 60) {
    recommendation = `ACCEPT: This member has a good score of ${totalScore}/100. The loan is reasonable relative to savings and the cooperative can afford it. Consider approving with monitoring.`;
    recommendationLevel = 'accept';
  } else if (totalScore >= 45) {
    recommendation = `IN PROGRESS: This member has a moderate score of ${totalScore}/100. There are some concerns. Consider requesting additional information or collateral before approval. The loan could be placed in progress for further review.`;
    recommendationLevel = 'in_progress';
  } else {
    recommendation = `REJECT: This member has a low score of ${totalScore}/100. Concerns include poor credit score, insufficient savings, irregular attendance, or bad loan history. The cooperative should not approve this loan at this time.`;
    recommendationLevel = 'reject';
  }

  // Batch suggestion: how many of all pending loans can be accepted
  const allPendingLoans = db.prepare(`
    SELECT l.id, l.amount_requested, l.user_id, u.credit_score
    FROM loans l
    JOIN users u ON l.user_id = u.id
    WHERE l.status = 'pending'
    ORDER BY l.created_at ASC
  `).all();

  // Simulate evaluating all pending loans to suggest how many can be accepted
  let remainingFunds = availableFunds;
  const batchSuggestion = {
    total_pending: allPendingLoans.length,
    can_accept: 0,
    should_reject: 0,
    should_hold: 0,
    total_acceptable_amount: 0,
    details: []
  };

  for (const pl of allPendingLoans) {
    const plWeeklySavings = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as weeks
      FROM savings WHERE user_id = ? AND type = 'weekly'
    `).get(pl.user_id);

    const plAttendance = db.prepare(`
      SELECT COUNT(*) as cnt FROM meeting_attendance WHERE user_id = ?
    `).get(pl.user_id);

    const plRejected = db.prepare(`
      SELECT COUNT(*) as cnt FROM loans WHERE user_id = ? AND status = 'rejected'
    `).get(pl.user_id);

    // Quick score for batch
    let quickScore = 0;
    quickScore += Math.min((pl.credit_score / 850) * 30, 30);
    quickScore += Math.min((plWeeklySavings.weeks / 24) * 25, 25);
    quickScore += plWeeklySavings.weeks >= 12 ? 15 : 0;
    quickScore += (plAttendance.cnt / Math.max(totalMeetings.cnt, 1)) * 15;
    quickScore += plRejected.cnt === 0 ? 15 : Math.max(0, 15 - plRejected.cnt * 5);
    quickScore = Math.round(quickScore);

    if (quickScore >= 60 && remainingFunds >= pl.amount_requested) {
      batchSuggestion.can_accept++;
      batchSuggestion.total_acceptable_amount += pl.amount_requested;
      remainingFunds -= pl.amount_requested;
      batchSuggestion.details.push({
        loan_id: pl.id,
        score: quickScore,
        action: 'accept',
        amount: pl.amount_requested
      });
    } else if (quickScore < 45) {
      batchSuggestion.should_reject++;
      batchSuggestion.details.push({
        loan_id: pl.id,
        score: quickScore,
        action: 'reject',
        amount: pl.amount_requested
      });
    } else {
      batchSuggestion.should_hold++;
      batchSuggestion.details.push({
        loan_id: pl.id,
        score: quickScore,
        action: 'hold',
        amount: pl.amount_requested
      });
    }
  }

  res.json({
    loan: {
      id: loan.id,
      member: loan.full_name,
      amount_requested: loan.amount_requested,
      purpose: loan.purpose,
      created_at: loan.created_at
    },
    suggestion: {
      total_score: totalScore,
      max_score: 100,
      recommendation,
      recommendation_level: recommendationLevel,
      can_afford: canAfford,
      factors: factors,
      member_performance: {
        credit_score: loan.credit_score,
        weekly_savings_total: weeklySavings.total,
        weeks_saved: weeklySavings.weeks,
        max_loan_eligible: weeklySavings.total * 2,
        meetings_attended: meetingsAttended.cnt,
        total_meetings: totalMeetings.cnt,
        attendance_rate: attendanceRate.toFixed(1) + '%',
        rejected_loans: rejectedLoans.cnt,
        completed_loans: completedLoans.cnt
      },
      cooperative_funds: {
        total_savings: cooperativeFunds.total_savings,
        outstanding_loans: cooperativeFunds.outstanding_loans,
        available_funds: availableFunds
      }
    },
    batch_suggestion: batchSuggestion
  });
});

// ============================================================
// MEETING MANAGEMENT
// ============================================================

// POST /api/admin/meetings - Create a new Sunday meeting
router.post('/meetings', (req, res) => {
  const { meeting_date } = req.body;

  // Generate a random 6-character meeting code
  const meetingCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  // Deactivate previous meetings
  db.prepare(`UPDATE meetings SET is_active = 0`).run();

  const id = uuid();
  db.prepare(`
    INSERT INTO meetings (id, meeting_code, meeting_date)
    VALUES (?, ?, ?)
  `).run(id, meetingCode, meeting_date || new Date().toISOString().split('T')[0]);

  res.status(201).json({
    message: 'Meeting created successfully. Share the meeting code with members.',
    meeting: {
      id, meeting_code: meetingCode, meeting_date: meeting_date, is_active: 1
    }
  });
});

// GET /api/admin/meetings - List all meetings
router.get('/meetings', (req, res) => {
  const meetings = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM meeting_attendance WHERE meeting_id = m.id) as attendance_count,
      (SELECT COALESCE(SUM(payment_amount), 0) FROM meeting_attendance WHERE meeting_id = m.id) as total_payments
    FROM meetings m
    ORDER BY m.created_at DESC
  `).all();

  res.json({ meetings });
});

// GET /api/admin/meetings/:id/attendance
router.get('/meetings/:id/attendance', (req, res) => {
  const attendance = db.prepare(`
    SELECT ma.*, u.full_name, u.phone, u.email
    FROM meeting_attendance ma
    JOIN users u ON ma.user_id = u.id
    WHERE ma.meeting_id = ?
    ORDER BY ma.created_at ASC
  `).all(req.params.id);

  res.json({ attendance });
});

// GET /api/admin/loans/suggestions/all - Get batch suggestions for all pending loans
router.get('/loans/suggestions/all', (req, res) => {
  const pendingLoans = db.prepare(`
    SELECT l.id, l.amount_requested, l.purpose, l.created_at,
      u.id as user_id, u.full_name, u.phone, u.email, u.credit_score,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id = u.id AND type = 'weekly'), 0) as weekly_savings,
      COALESCE((SELECT COUNT(*) FROM savings WHERE user_id = u.id AND type = 'weekly'), 0) as weeks_saved,
      COALESCE((SELECT COUNT(*) FROM meeting_attendance WHERE user_id = u.id), 0) as meetings_attended,
      COALESCE((SELECT COUNT(*) FROM loans WHERE user_id = u.id AND status = 'rejected'), 0) as rejected_loans_count,
      COALESCE((SELECT COUNT(*) FROM loans WHERE user_id = u.id AND status IN ('approved', 'in_progress')), 0) as completed_loans_count
    FROM loans l
    JOIN users u ON l.user_id = u.id
    WHERE l.status = 'pending'
    ORDER BY l.created_at ASC
  `).all();

  const cooperativeFunds = db.prepare(`
    SELECT
      COALESCE(SUM(s.amount), 0) as total_savings,
      COALESCE((SELECT SUM(amount_requested) FROM loans WHERE status IN ('approved', 'in_progress')), 0) as outstanding_loans
    FROM savings s
  `).get();

  const availableFunds = cooperativeFunds.total_savings - cooperativeFunds.outstanding_loans;
  const totalMeetings = db.prepare(`SELECT COUNT(*) as cnt FROM meetings`).get();

  let remainingFunds = availableFunds;
  const suggestions = pendingLoans.map(loan => {
    let quickScore = 0;
    quickScore += Math.min((loan.credit_score / 850) * 30, 30);
    quickScore += Math.min((loan.weeks_saved / 24) * 25, 25);
    quickScore += loan.weeks_saved >= 12 ? 15 : 0;
    quickScore += (loan.meetings_attended / Math.max(totalMeetings.cnt, 1)) * 15;
    quickScore += loan.rejected_loans_count === 0 ? 15 : Math.max(0, 15 - loan.rejected_loans_count * 5);
    quickScore = Math.round(quickScore);

    let action = 'reject';
    let canAfford = remainingFunds >= loan.amount_requested;

    if (quickScore >= 60 && canAfford) {
      action = 'accept';
      remainingFunds -= loan.amount_requested;
    } else if (quickScore >= 45) {
      action = 'hold';
    }

    return {
      loan_id: loan.id,
      member_name: loan.full_name,
      amount: loan.amount_requested,
      score: quickScore,
      action,
      can_afford: canAfford,
      weeks_saved: loan.weeks_saved,
      weekly_savings: loan.weekly_savings,
      credit_score: loan.credit_score,
      max_loan: loan.weekly_savings * 2
    };
  });

  const summary = {
    total_pending: pendingLoans.length,
    accept: suggestions.filter(s => s.action === 'accept').length,
    hold: suggestions.filter(s => s.action === 'hold').length,
    reject: suggestions.filter(s => s.action === 'reject').length,
    total_acceptable_amount: suggestions.filter(s => s.action === 'accept').reduce((sum, s) => sum + s.amount, 0),
    available_funds: availableFunds,
    remaining_after_acceptance: remainingFunds
  };

  res.json({ suggestions, summary });
});

module.exports = router;
