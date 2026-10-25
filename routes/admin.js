const express = require('express');
const uuid = require('uuid').v4;
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const db = global.db;

const RULES = {
  RESERVE_RATE: 0.25,
  MAX_LEND_RATE: 0.70,
  MAX_SINGLE_LOAN_PCT: 0.10,
  LOAN_MULTIPLIER: 2,
  MIN_SAVINGS_WEEKS: 12,
  PROCESSING_FEE_RATE: 0.01,
  WELFARE_LEVY: 300,
  PAUSE_FEE: 500,
  SAVINGS_LATE_FINE: 200,
  LOAN_LATE_FINE: 500,
  WEEKLY_MAX: 20000,
};

router.use(authenticate, requireAdmin);

// ============================================================
// HELPERS
// ============================================================
function getPoolStats() {
  const pool = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM savings WHERE status='approved'`).get();
  const lent = db.prepare(`SELECT COALESCE(SUM(amount_approved),0) as total FROM loans WHERE status IN ('approved','in_progress')`).get();
  const reserve = pool.total * RULES.RESERVE_RATE;
  const maxLendable = pool.total * RULES.MAX_LEND_RATE;
  const available = Math.max(0, maxLendable - lent.total);
  return { pool: pool.total, lent: lent.total, reserve, maxLendable, available };
}

// ============================================================
// DASHBOARD
// ============================================================
router.get('/dashboard', (req, res) => {
  const totalMembers = db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role='member'`).get();
  const approvedMembers = db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role='member' AND status='approved'`).get();
  const pendingMembers = db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role='member' AND status='pending'`).get();

  const totalSavings = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='weekly' THEN amount ELSE 0 END),0) as weekly,
      COALESCE(SUM(CASE WHEN type='special' THEN amount ELSE 0 END),0) as special,
      COALESCE(SUM(amount),0) as grand_total
    FROM savings WHERE status='approved'
  `).get();

  const pendingSavings = db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM savings WHERE status='pending'`).get();
  const pendingLoans = db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount_requested),0) as total FROM loans WHERE status='pending'`).get();
  const approvedLoans = db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount_approved),0) as total FROM loans WHERE status='approved'`).get();
  const inProgressLoans = db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount_approved),0) as total FROM loans WHERE status='in_progress'`).get();
  const rejectedLoans = db.prepare(`SELECT COUNT(*) as cnt FROM loans WHERE status='rejected'`).get();
  const completedLoans = db.prepare(`SELECT COUNT(*) as cnt FROM loans WHERE status='completed'`).get();
  const pendingRepayments = db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM loan_repayments WHERE status='pending'`).get();
  const pendingPauses = db.prepare(`SELECT COUNT(*) as cnt FROM savings_pauses WHERE status='pending'`).get();
  const outstandingFines = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM savings_fines WHERE paid=0`).get();
  const activeMeeting = db.prepare(`SELECT * FROM meetings WHERE is_active=1 ORDER BY created_at DESC LIMIT 1`).get();
  let meetingAttendance = 0;
  if (activeMeeting) {
    meetingAttendance = db.prepare(`SELECT COUNT(*) as cnt FROM meeting_attendance WHERE meeting_id=?`).get(activeMeeting.id).cnt;
  }

  const pool = getPoolStats();

  res.json({
    stats: {
      total_members: totalMembers.cnt,
      approved_members: approvedMembers.cnt,
      pending_members: pendingMembers.cnt,
      total_weekly_savings: totalSavings.weekly,
      total_voluntary_savings: totalSavings.special,
      grand_total_savings: totalSavings.grand_total,
      pool: pool.pool,
      reserve: pool.reserve,
      max_lendable: pool.maxLendable,
      available_funds: pool.available,
      amount_lent: pool.lent,
      pending_savings: pendingSavings.cnt,
      pending_savings_amount: pendingSavings.total,
      pending_loans: pendingLoans.cnt,
      pending_loans_amount: pendingLoans.total,
      approved_loans: approvedLoans.cnt,
      approved_loans_amount: approvedLoans.total,
      in_progress_loans: inProgressLoans.cnt,
      rejected_loans: rejectedLoans.cnt,
      completed_loans: completedLoans.cnt,
      pending_repayments: pendingRepayments.cnt,
      pending_repayments_amount: pendingRepayments.total,
      pending_pauses: pendingPauses.cnt,
      outstanding_fines: outstandingFines.total,
      active_meeting: activeMeeting,
      meeting_attendance: meetingAttendance
    }
  });
});

// ============================================================
// MEMBERS
// ============================================================
router.get('/members', (req, res) => {
  const members = db.prepare(`
    SELECT
      u.id, u.full_name, u.email, u.phone, u.address, u.occupation,
      u.bvn, u.credit_score, u.registration_fee_paid, u.weekly_savings_tier,
      u.status, u.loan_rights_suspended, u.created_at, u.next_of_kin,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id=u.id AND type='weekly' AND status='approved'),0) as weekly_savings,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id=u.id AND type='special' AND status='approved'),0) as voluntary_savings,
      COALESCE((SELECT COUNT(*) FROM savings WHERE user_id=u.id AND type='weekly' AND status='approved'),0) as weeks_saved,
      COALESCE((SELECT COUNT(*) FROM savings WHERE user_id=u.id AND status='pending'),0) as pending_savings,
      COALESCE((SELECT COUNT(*) FROM meeting_attendance WHERE user_id=u.id),0) as meetings_attended,
      COALESCE((SELECT SUM(amount) FROM savings_fines WHERE user_id=u.id AND paid=0),0) as outstanding_fines
    FROM users u WHERE u.role='member'
    ORDER BY u.created_at DESC
  `).all();
  res.json({ members });
});

router.get('/members/:id', (req, res) => {
  const member = db.prepare(`SELECT * FROM users WHERE id=? AND role='member'`).get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const savings = db.prepare(`SELECT * FROM savings WHERE user_id=? ORDER BY created_at DESC`).all(req.params.id);
  const loans = db.prepare(`SELECT * FROM loans WHERE user_id=? ORDER BY created_at DESC`).all(req.params.id);
  const repayments = db.prepare(`SELECT * FROM loan_repayments WHERE user_id=? ORDER BY created_at DESC`).all(req.params.id);
  const fines = db.prepare(`SELECT * FROM savings_fines WHERE user_id=? ORDER BY created_at DESC`).all(req.params.id);
  const loanFines = db.prepare(`SELECT * FROM loan_fines WHERE user_id=? ORDER BY created_at DESC`).all(req.params.id);
  const pauses = db.prepare(`SELECT * FROM savings_pauses WHERE user_id=? ORDER BY created_at DESC`).all(req.params.id);
  const welfare = db.prepare(`SELECT * FROM welfare_levies WHERE user_id=? ORDER BY created_at DESC`).all(req.params.id);
  const attendance = db.prepare(`
    SELECT ma.*, m.meeting_code, m.meeting_date
    FROM meeting_attendance ma JOIN meetings m ON ma.meeting_id=m.id
    WHERE ma.user_id=? ORDER BY ma.created_at DESC
  `).all(req.params.id);

  const weeklySavings = db.prepare(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as weeks FROM savings WHERE user_id=? AND type='weekly' AND status='approved'`).get(req.params.id);
  const voluntarySavings = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM savings WHERE user_id=? AND type='special' AND status='approved'`).get(req.params.id);
  const pendingSavings = db.prepare(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM savings WHERE user_id=? AND status='pending'`).get(req.params.id);
  const outstandingFines = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM savings_fines WHERE user_id=? AND paid=0`).get(req.params.id);
  const totalApproved = weeklySavings.total + voluntarySavings.total;
  const maxLoan = totalApproved * RULES.LOAN_MULTIPLIER;

  res.json({
    member: { ...member, registration_fee_paid: !!member.registration_fee_paid, loan_rights_suspended: !!member.loan_rights_suspended },
    savings, loans, repayments, fines, loanFines, pauses, welfare, attendance,
    savings_summary: {
      weekly_total: weeklySavings.total,
      weekly_weeks: weeklySavings.weeks,
      voluntary_total: voluntarySavings.total,
      total_approved: totalApproved,
      pending_total: pendingSavings.total,
      pending_count: pendingSavings.cnt,
      max_loan_eligible: maxLoan,
      meets_12_week_requirement: weeklySavings.weeks >= RULES.MIN_SAVINGS_WEEKS,
      outstanding_fines: outstandingFines.total
    }
  });
});

router.put('/members/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['pending','approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE users SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  res.json({ message: `Member status updated to ${status}` });
});

// Suspend/restore loan rights
router.put('/members/:id/loan-rights', (req, res) => {
  const { suspended, reason } = req.body;
  db.prepare(`UPDATE users SET loan_rights_suspended=?, updated_at=datetime('now') WHERE id=?`).run(suspended ? 1 : 0, req.params.id);
  res.json({ message: `Loan rights ${suspended ? 'suspended' : 'restored'} for member` });
});

// Add a savings fine
router.post('/members/:id/fine', (req, res) => {
  const { amount, reason } = req.body;
  const fineAmount = amount || RULES.SAVINGS_LATE_FINE;
  const id = uuid();
  db.prepare(`INSERT INTO savings_fines (id, user_id, amount, reason) VALUES (?,?,?,?)`).run(id, req.params.id, fineAmount, reason || 'Late savings fine');
  res.json({ message: `Fine of N${fineAmount} added for member` });
});

// Mark fine as paid
router.put('/fines/:id/paid', (req, res) => {
  db.prepare(`UPDATE savings_fines SET paid=1 WHERE id=?`).run(req.params.id);
  res.json({ message: 'Fine marked as paid' });
});

// ============================================================
// SAVINGS APPROVAL
// ============================================================
router.get('/savings/pending', (req, res) => {
  const savings = db.prepare(`
    SELECT s.*, u.full_name, u.phone, u.email
    FROM savings s JOIN users u ON s.user_id=u.id
    WHERE s.status='pending' ORDER BY s.created_at ASC
  `).all();
  res.json({ savings });
});

router.put('/savings/:id', (req, res) => {
  const { status, admin_comment } = req.body;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected' });

  const saving = db.prepare(`SELECT * FROM savings WHERE id=?`).get(req.params.id);
  if (!saving) return res.status(404).json({ error: 'Savings record not found' });
  if (saving.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

  db.prepare(`UPDATE savings SET status=?, admin_comment=?, approved_by=?, approved_at=datetime('now') WHERE id=?`)
    .run(status, admin_comment || null, req.user.id, req.params.id);

  res.json({ message: `Savings of N${Number(saving.amount).toLocaleString()} ${status}` });
});

// Bulk approve all pending for one member
router.put('/savings/bulk-approve', (req, res) => {
  const { user_id, status } = req.body;
  if (!user_id || !['approved','rejected'].includes(status)) return res.status(400).json({ error: 'user_id and valid status required' });
  const pending = db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM savings WHERE user_id=? AND status='pending'`).get(user_id);
  db.prepare(`UPDATE savings SET status=?, approved_by=?, approved_at=datetime('now') WHERE user_id=? AND status='pending'`)
    .run(status, req.user.id, user_id);
  res.json({ message: `${pending.cnt} savings (N${Number(pending.total).toLocaleString()}) ${status}`, count: pending.cnt });
});

// ============================================================
// SAVINGS PAUSE MANAGEMENT
// ============================================================
router.get('/pauses/pending', (req, res) => {
  const pauses = db.prepare(`
    SELECT sp.*, u.full_name, u.phone
    FROM savings_pauses sp JOIN users u ON sp.user_id=u.id
    WHERE sp.status='pending' ORDER BY sp.created_at ASC
  `).all();
  res.json({ pauses });
});

router.put('/pauses/:id', (req, res) => {
  const { status } = req.body;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const pause = db.prepare(`SELECT * FROM savings_pauses WHERE id=?`).get(req.params.id);
  if (!pause) return res.status(404).json({ error: 'Pause not found' });

  if (status === 'approved') {
    const startDate = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + pause.weeks * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    db.prepare(`UPDATE savings_pauses SET status='approved', start_date=?, end_date=? WHERE id=?`).run(startDate, endDate, req.params.id);
    res.json({ message: `Pause approved: ${pause.weeks} weeks from ${startDate} to ${endDate}` });
  } else {
    db.prepare(`UPDATE savings_pauses SET status='rejected' WHERE id=?`).run(req.params.id);
    res.json({ message: 'Pause request rejected' });
  }
});

// ============================================================
// LOAN MANAGEMENT
// ============================================================
router.get('/loans', (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT l.*, u.full_name, u.phone, u.email, u.credit_score,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id=u.id AND type='weekly' AND status='approved'),0) as weekly_savings,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id=u.id AND type='special' AND status='approved'),0) as voluntary_savings,
      COALESCE((SELECT COUNT(*) FROM savings WHERE user_id=u.id AND type='weekly' AND status='approved'),0) as weeks_saved,
      COALESCE((SELECT COUNT(*) FROM meeting_attendance WHERE user_id=u.id),0) as meetings_attended,
      COALESCE((SELECT COUNT(*) FROM loans WHERE user_id=u.id AND status='rejected'),0) as rejected_loans_count,
      (SELECT full_name FROM users WHERE id=l.guarantor1_id) as guarantor1_name,
      (SELECT full_name FROM users WHERE id=l.guarantor2_id) as guarantor2_name,
      COALESCE((SELECT SUM(amount) FROM loan_repayments WHERE loan_id=l.id AND status='approved'),0) as amount_repaid
    FROM loans l JOIN users u ON l.user_id=u.id
  `;
  const params = [];
  if (status) { query += ` WHERE l.status=?`; params.push(status); }
  query += ` ORDER BY l.created_at DESC`;
  const loans = db.prepare(query).all(...params);
  res.json({ loans });
});

router.put('/loans/:id', (req, res) => {
  const { status, admin_comment, amount_approved, repayment_months } = req.body;
  if (!['pending','approved','in_progress','rejected','completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid loan status' });
  }

  const loan = db.prepare(`SELECT * FROM loans WHERE id=?`).get(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const approved = amount_approved || loan.amount_requested;
  const processingFee = approved * RULES.PROCESSING_FEE_RATE;
  const disbursed = approved - processingFee;
  const months = repayment_months || loan.repayment_months || 3;
  const instalment = approved / months;

  let disbursedAt = loan.disbursed_at;
  if (status === 'approved' && !disbursedAt) disbursedAt = new Date().toISOString();

  db.prepare(`
    UPDATE loans SET status=?, admin_comment=COALESCE(?,admin_comment), reviewed_by=?,
    amount_approved=?, processing_fee=?, amount_disbursed=?, repayment_months=?,
    repayment_instalment=?, disbursed_at=?, updated_at=datetime('now')
    WHERE id=?
  `).run(status, admin_comment, req.user.id, approved, processingFee, disbursed, months, instalment, disbursedAt, req.params.id);

  // Auto-complete if fully repaid
  if (status === 'in_progress') {
    const repaid = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM loan_repayments WHERE loan_id=? AND status='approved'`).get(req.params.id);
    if (repaid.total >= approved) {
      db.prepare(`UPDATE loans SET status='completed', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
    }
  }

  res.json({ message: `Loan status updated to ${status}. Processing fee: N${processingFee.toLocaleString()}. Net disbursement: N${disbursed.toLocaleString()}.` });
});

// ============================================================
// LOAN REPAYMENTS APPROVAL
// ============================================================
router.get('/repayments/pending', (req, res) => {
  const repayments = db.prepare(`
    SELECT r.*, u.full_name, u.phone,
      l.amount_approved, l.amount_disbursed,
      COALESCE((SELECT SUM(amount) FROM loan_repayments WHERE loan_id=l.id AND status='approved'),0) as already_repaid
    FROM loan_repayments r
    JOIN users u ON r.user_id=u.id
    JOIN loans l ON r.loan_id=l.id
    WHERE r.status='pending' ORDER BY r.created_at ASC
  `).all();
  res.json({ repayments });
});

router.put('/repayments/:id', (req, res) => {
  const { status } = req.body;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const repayment = db.prepare(`SELECT * FROM loan_repayments WHERE id=?`).get(req.params.id);
  if (!repayment) return res.status(404).json({ error: 'Repayment not found' });

  db.prepare(`UPDATE loan_repayments SET status=?, approved_by=? WHERE id=?`).run(status, req.user.id, req.params.id);

  // Check if loan is now fully repaid
  if (status === 'approved') {
    const loan = db.prepare(`SELECT * FROM loans WHERE id=?`).get(repayment.loan_id);
    const totalRepaid = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM loan_repayments WHERE loan_id=? AND status='approved'`).get(repayment.loan_id);
    if (loan && loan.amount_approved && totalRepaid.total >= loan.amount_approved) {
      db.prepare(`UPDATE loans SET status='completed', updated_at=datetime('now') WHERE id=?`).run(repayment.loan_id);
    }
  }

  res.json({ message: `Repayment of N${Number(repayment.amount).toLocaleString()} ${status}` });
});

// ============================================================
// LOAN SUGGESTION (AI-assisted)
// ============================================================
router.get('/loans/:id/suggestion', (req, res) => {
  const loan = db.prepare(`SELECT l.*, u.full_name, u.credit_score FROM loans l JOIN users u ON l.user_id=u.id WHERE l.id=?`).get(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });

  const weeklySavings = db.prepare(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as weeks FROM savings WHERE user_id=? AND type='weekly' AND status='approved'`).get(loan.user_id);
  const voluntarySavings = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM savings WHERE user_id=? AND type='special' AND status='approved'`).get(loan.user_id);
  const totalSavings = weeklySavings.total + voluntarySavings.total;
  const meetingsAttended = db.prepare(`SELECT COUNT(*) as cnt FROM meeting_attendance WHERE user_id=?`).get(loan.user_id);
  const totalMeetings = db.prepare(`SELECT COUNT(*) as cnt FROM meetings`).get();
  const attendanceRate = totalMeetings.cnt > 0 ? (meetingsAttended.cnt / totalMeetings.cnt) * 100 : 0;
  const rejectedLoans = db.prepare(`SELECT COUNT(*) as cnt FROM loans WHERE user_id=? AND status='rejected'`).get(loan.user_id);
  const completedLoans = db.prepare(`SELECT COUNT(*) as cnt FROM loans WHERE user_id=? AND status='completed'`).get(loan.user_id);
  const outstandingFines = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM savings_fines WHERE user_id=? AND paid=0`).get(loan.user_id);
  const pool = getPoolStats();

  let score = 0;
  const factors = [];

  const c1 = Math.min((loan.credit_score / 850) * 25, 25);
  score += c1;
  factors.push({ factor: 'Credit Score', detail: `${loan.credit_score}/850`, points: c1.toFixed(1), max_points: 25 });

  const c2 = Math.min((weeklySavings.weeks / 24) * 20, 20);
  score += c2;
  factors.push({ factor: 'Savings Consistency', detail: `${weeklySavings.weeks} compulsory weeks`, points: c2.toFixed(1), max_points: 20 });

  const maxLoan = totalSavings * RULES.LOAN_MULTIPLIER;
  const ratio = maxLoan > 0 ? loan.amount_requested / maxLoan : 1;
  const c3 = Math.max(0, 20 - ratio * 20);
  score += c3;
  factors.push({ factor: 'Loan-to-Savings Ratio', detail: `Requesting N${loan.amount_requested.toLocaleString()} of max N${maxLoan.toLocaleString()} (${(ratio*100).toFixed(1)}%)`, points: c3.toFixed(1), max_points: 20 });

  const c4 = (attendanceRate / 100) * 15;
  score += c4;
  factors.push({ factor: 'Meeting Attendance', detail: `${meetingsAttended.cnt}/${totalMeetings.cnt} meetings`, points: c4.toFixed(1), max_points: 15 });

  let c5 = 10 + completedLoans.cnt * 2 - rejectedLoans.cnt * 5 - (outstandingFines.total > 0 ? 10 : 0);
  c5 = Math.min(10, Math.max(0, c5));
  score += c5;
  factors.push({ factor: 'Loan & Fine History', detail: `${completedLoans.cnt} completed, ${rejectedLoans.cnt} rejected, fines: N${outstandingFines.total}`, points: c5.toFixed(1), max_points: 10 });

  let c6 = pool.available >= loan.amount_requested * 2 ? 10 : pool.available >= loan.amount_requested ? 6 : pool.available > 0 ? 3 : 0;
  score += c6;
  factors.push({ factor: 'Cooperative Funds', detail: `N${Math.floor(pool.available).toLocaleString()} available (70% lending cap maintained)`, points: c6.toFixed(1), max_points: 10 });

  const totalScore = Math.round(score);
  const canAfford = pool.available >= loan.amount_requested;
  const hasFines = outstandingFines.total > 0;
  const enoughWeeks = weeklySavings.weeks >= RULES.MIN_SAVINGS_WEEKS;

  let recommendation, level;
  if (!enoughWeeks) {
    recommendation = `REJECT: Member has only ${weeklySavings.weeks} compulsory weeks — 12 required`;
    level = 'reject';
  } else if (hasFines) {
    recommendation = `REJECT: Member has outstanding fines of N${outstandingFines.total} — must be cleared before a loan can be approved`;
    level = 'reject';
  } else if (!canAfford) {
    recommendation = `HOLD: Insufficient funds (N${Math.floor(pool.available).toLocaleString()} available). Place on waiting list`;
    level = 'in_progress';
  } else if (totalScore >= 75) {
    recommendation = `STRONGLY APPROVE: Excellent score ${totalScore}/100 — clean record, strong savings, regular attendance`;
    level = 'accept';
  } else if (totalScore >= 60) {
    recommendation = `APPROVE: Good score ${totalScore}/100 — meets all requirements`;
    level = 'accept';
  } else if (totalScore >= 45) {
    recommendation = `REVIEW: Moderate score ${totalScore}/100 — verify guarantors and consider reduced amount`;
    level = 'in_progress';
  } else {
    recommendation = `REJECT: Low score ${totalScore}/100 — poor history, irregular savings or attendance`;
    level = 'reject';
  }

  res.json({
    loan: { id: loan.id, member: loan.full_name, amount_requested: loan.amount_requested, purpose: loan.purpose, created_at: loan.created_at },
    suggestion: {
      total_score: totalScore, max_score: 100, recommendation, recommendation_level: level,
      can_afford: canAfford, factors,
      member_performance: {
        credit_score: loan.credit_score, weekly_savings: weeklySavings.total,
        voluntary_savings: voluntarySavings.total, total_savings: totalSavings,
        weeks_saved: weeklySavings.weeks, max_loan_eligible: maxLoan,
        meetings_attended: meetingsAttended.cnt, attendance_rate: attendanceRate.toFixed(1) + '%',
        rejected_loans: rejectedLoans.cnt, completed_loans: completedLoans.cnt, outstanding_fines: outstandingFines.total
      },
      cooperative_funds: { pool: pool.pool, reserve: pool.reserve, max_lendable: pool.maxLendable, lent: pool.lent, available: pool.available }
    }
  });
});

// Batch suggestions
router.get('/loans/suggestions/all', (req, res) => {
  const pending = db.prepare(`
    SELECT l.id, l.amount_requested, l.purpose, l.created_at,
      u.id as user_id, u.full_name, u.credit_score,
      COALESCE((SELECT SUM(amount) FROM savings WHERE user_id=u.id AND status='approved'),0) as total_savings,
      COALESCE((SELECT COUNT(*) FROM savings WHERE user_id=u.id AND type='weekly' AND status='approved'),0) as weeks_saved,
      COALESCE((SELECT COUNT(*) FROM meeting_attendance WHERE user_id=u.id),0) as meetings_attended,
      COALESCE((SELECT COUNT(*) FROM loans WHERE user_id=u.id AND status='rejected'),0) as rejected_count,
      COALESCE((SELECT SUM(amount) FROM savings_fines WHERE user_id=u.id AND paid=0),0) as fines
    FROM loans l JOIN users u ON l.user_id=u.id
    WHERE l.status='pending' ORDER BY l.created_at ASC
  `).all();

  const pool = getPoolStats();
  const totalMeetings = db.prepare(`SELECT COUNT(*) as cnt FROM meetings`).get();
  let remaining = pool.available;

  const suggestions = pending.map(l => {
    let s = Math.min((l.credit_score/850)*25,25) + Math.min((l.weeks_saved/24)*20,20) +
            (l.meetings_attended/Math.max(totalMeetings.cnt,1))*15 +
            Math.max(0, 10 - l.rejected_count*5) + (l.fines > 0 ? 0 : 5);
    s = Math.round(s + (remaining >= l.amount_requested ? 10 : 0) + (l.weeks_saved >= 12 ? 15 : 0));
    let action = l.fines > 0 || l.weeks_saved < 12 ? 'reject' : (s >= 60 && remaining >= l.amount_requested) ? 'accept' : s >= 45 ? 'hold' : 'reject';
    if (action === 'accept') remaining -= l.amount_requested;
    return { loan_id: l.id, member_name: l.full_name, amount: l.amount_requested, score: s, action, can_afford: remaining >= 0, weeks_saved: l.weeks_saved, total_savings: l.total_savings, outstanding_fines: l.fines };
  });

  res.json({
    suggestions,
    summary: {
      total_pending: pending.length,
      accept: suggestions.filter(s=>s.action==='accept').length,
      hold: suggestions.filter(s=>s.action==='hold').length,
      reject: suggestions.filter(s=>s.action==='reject').length,
      total_acceptable_amount: suggestions.filter(s=>s.action==='accept').reduce((sum,s)=>sum+s.amount,0),
      available_funds: pool.available, remaining_after_acceptance: remaining
    }
  });
});

// ============================================================
// MEETINGS
// ============================================================
router.post('/meetings', (req, res) => {
  const { meeting_date } = req.body;
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  db.prepare(`UPDATE meetings SET is_active=0`).run();
  const id = uuid();
  db.prepare(`INSERT INTO meetings (id, meeting_code, meeting_date) VALUES (?,?,?)`).run(id, code, meeting_date || new Date().toISOString().split('T')[0]);
  res.status(201).json({ message: 'Meeting created. Code: ' + code, meeting: { id, meeting_code: code, meeting_date, is_active: 1 } });
});

router.get('/meetings', (req, res) => {
  const meetings = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM meeting_attendance WHERE meeting_id=m.id) as attendance_count,
      (SELECT COALESCE(SUM(payment_amount),0) FROM meeting_attendance WHERE meeting_id=m.id) as total_payments
    FROM meetings m ORDER BY m.created_at DESC
  `).all();
  res.json({ meetings });
});

router.get('/meetings/:id/attendance', (req, res) => {
  const attendance = db.prepare(`
    SELECT ma.*, u.full_name, u.phone
    FROM meeting_attendance ma JOIN users u ON ma.user_id=u.id
    WHERE ma.meeting_id=? ORDER BY ma.created_at ASC
  `).all(req.params.id);
  res.json({ attendance });
});

module.exports = router;
