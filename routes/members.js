const express = require('express');
const uuid = require('uuid').v4;
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const db = global.db;

// ============================================================
// COOPERATIVE RULES (from Membership Agreement)
// ============================================================
const RULES = {
  WEEKLY_SAVINGS_MAX: 20000,          // Clause 3.2: max N20,000/week
  WEEKLY_SAVINGS_MIN: 1000,           // Clause 3.1: min N1,000/week
  REGISTRATION_FEE: 5000,             // Clause 2.3
  LOAN_MULTIPLIER: 2,                 // Clause 5.1: 2x total savings
  MIN_SAVINGS_WEEKS: 12,              // Clause 4.1: 12 consecutive weeks
  PROCESSING_FEE_RATE: 0.01,          // Clause 5.4: 1% of loan
  RESERVE_RATE: 0.25,                 // Clause 9.1: keep 25-30% as reserve
  MAX_LEND_RATE: 0.70,                // Clause 9.2: lend max 70-75%
  MAX_SINGLE_LOAN_PCT: 0.10,          // Clause 5.1: no loan > 10% of pool
  SAVINGS_LATE_FINE: 200,             // Clause 3.4
  LOAN_LATE_FINE: 500,                // Clause 8.1
  WELFARE_LEVY: 300,                  // Clause 12.1
  PAUSE_FEE: 500,                     // Clause 10.2
  MAX_PAUSE_WEEKS: 4,                 // Clause 10.2
  MAX_PAUSES_PER_YEAR: 2,             // Clause 10.2
  LOCK_PERIOD_WEEKS: 12,              // Clause 11.1: can't leave first 12 weeks
};

router.use(authenticate);

// ============================================================
// HELPERS
// ============================================================

// Get approved savings totals for a member (both types count for loans per 5.1)
function getMemberSavings(userId) {
  const weekly = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as weeks
    FROM savings WHERE user_id=? AND type='weekly' AND status='approved'
  `).get(userId);
  const voluntary = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total
    FROM savings WHERE user_id=? AND type='special' AND status='approved'
  `).get(userId);
  const pending = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt
    FROM savings WHERE user_id=? AND status='pending'
  `).get(userId);
  return {
    weekly_total: weekly.total,
    weekly_weeks: weekly.weeks,
    voluntary_total: voluntary.total,
    total_approved: weekly.total + voluntary.total,   // both count toward loan limit
    pending_total: pending.total,
    pending_count: pending.cnt
  };
}

// Get cooperative pool and available funds
function getPoolStats() {
  const pool = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total FROM savings WHERE status='approved'
  `).get();
  const lent = db.prepare(`
    SELECT COALESCE(SUM(amount_approved),0) as total
    FROM loans WHERE status IN ('approved','in_progress')
  `).get();
  const reserve = pool.total * RULES.RESERVE_RATE;
  const maxLendable = pool.total * RULES.MAX_LEND_RATE;
  const available = Math.max(0, maxLendable - lent.total);
  return { pool: pool.total, lent: lent.total, reserve, maxLendable, available };
}

// Check if member is in savings pause
function isOnPause(userId) {
  const today = new Date().toISOString().split('T')[0];
  const pause = db.prepare(`
    SELECT * FROM savings_pauses
    WHERE user_id=? AND status='approved' AND start_date<=? AND end_date>=?
  `).get(userId, today, today);
  return !!pause;
}

// ============================================================
// PROFILE
// ============================================================
router.get('/profile', (req, res) => {
  const user = db.prepare(`
    SELECT id, full_name, email, phone, address, date_of_birth,
    occupation, monthly_income_range, next_of_kin, next_of_kin_phone,
    next_of_kin_relationship, bank_name, bank_account_number, bvn,
    credit_score, registration_fee_paid, weekly_savings_tier,
    role, status, loan_rights_suspended, created_at
    FROM users WHERE id=?
  `).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const savings = getMemberSavings(req.user.id);
  const maxLoan = savings.total_approved * RULES.LOAN_MULTIPLIER;
  const pool = getPoolStats();
  const maxSingleLoan = pool.pool * RULES.MAX_SINGLE_LOAN_PCT;

  // Outstanding fines
  const fines = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total FROM savings_fines
    WHERE user_id=? AND paid=0
  `).get(req.user.id);

  // Welfare levy status
  const currentMonth = new Date().toISOString().substring(0,7);
  const welfarePaid = db.prepare(`
    SELECT id FROM welfare_levies WHERE user_id=? AND month=? AND paid=1
  `).get(req.user.id, currentMonth);

  res.json({
    user: { ...user, registration_fee_paid: !!user.registration_fee_paid, loan_rights_suspended: !!user.loan_rights_suspended },
    savings_summary: {
      ...savings,
      max_loan_eligible: Math.min(maxLoan, maxSingleLoan),
      meets_12_week_requirement: savings.weekly_weeks >= RULES.MIN_SAVINGS_WEEKS
    },
    outstanding_fines: fines.total,
    welfare_levy_paid_this_month: !!welfarePaid,
    rules: RULES
  });
});

router.put('/profile', (req, res) => {
  const { address, date_of_birth, occupation, monthly_income_range,
          next_of_kin, next_of_kin_phone, next_of_kin_relationship,
          bank_name, bank_account_number, weekly_savings_tier } = req.body;

  // Validate savings tier
  if (weekly_savings_tier && (weekly_savings_tier < RULES.WEEKLY_SAVINGS_MIN || weekly_savings_tier > RULES.WEEKLY_SAVINGS_MAX)) {
    return res.status(400).json({
      error: `Weekly savings tier must be between N${RULES.WEEKLY_SAVINGS_MIN.toLocaleString()} and N${RULES.WEEKLY_SAVINGS_MAX.toLocaleString()}`
    });
  }

  db.prepare(`
    UPDATE users SET
      address=COALESCE(?,address), date_of_birth=COALESCE(?,date_of_birth),
      occupation=COALESCE(?,occupation), monthly_income_range=COALESCE(?,monthly_income_range),
      next_of_kin=COALESCE(?,next_of_kin), next_of_kin_phone=COALESCE(?,next_of_kin_phone),
      next_of_kin_relationship=COALESCE(?,next_of_kin_relationship),
      bank_name=COALESCE(?,bank_name), bank_account_number=COALESCE(?,bank_account_number),
      weekly_savings_tier=COALESCE(?,weekly_savings_tier), updated_at=datetime('now')
    WHERE id=?
  `).run(address, date_of_birth, occupation, monthly_income_range,
         next_of_kin, next_of_kin_phone, next_of_kin_relationship,
         bank_name, bank_account_number, weekly_savings_tier, req.user.id);

  res.json({ message: 'Profile updated successfully' });
});

// ============================================================
// SAVINGS
// ============================================================
router.get('/savings', (req, res) => {
  const savings = db.prepare(`SELECT * FROM savings WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id);
  const summary = getMemberSavings(req.user.id);
  const fines = db.prepare(`SELECT * FROM savings_fines WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id);
  const pauses = db.prepare(`SELECT * FROM savings_pauses WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id);
  res.json({ savings, summary, fines, pauses });
});

// POST /api/members/savings — submit a payment (pending admin approval)
router.post('/savings', (req, res) => {
  const { type, amount, note } = req.body;

  if (!type || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Savings type and a valid amount are required' });
  }
  if (type !== 'weekly' && type !== 'special') {
    return res.status(400).json({ error: 'Type must be "weekly" (Compulsory) or "special" (Voluntary)' });
  }

  // Clause 3.2: weekly max N20,000
  if (type === 'weekly' && amount > RULES.WEEKLY_SAVINGS_MAX) {
    return res.status(400).json({
      error: `Weekly savings cannot exceed N${RULES.WEEKLY_SAVINGS_MAX.toLocaleString()} (Clause 3.2)`
    });
  }
  if (type === 'weekly' && amount < RULES.WEEKLY_SAVINGS_MIN) {
    return res.status(400).json({
      error: `Weekly savings minimum is N${RULES.WEEKLY_SAVINGS_MIN.toLocaleString()} (Clause 3.1)`
    });
  }

  // Check if on approved pause — still can submit voluntary
  if (type === 'weekly' && isOnPause(req.user.id)) {
    return res.status(400).json({ error: 'Your weekly savings are currently paused (Clause 10.2). You can still add Voluntary savings.' });
  }

  let weekNumber = null;
  let year = null;
  if (type === 'weekly') {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM savings WHERE user_id=? AND type='weekly'`).get(req.user.id);
    weekNumber = count.cnt + 1;
    year = new Date().getFullYear();
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO savings (id, user_id, type, amount, week_number, year, note, status)
    VALUES (?,?,?,?,?,?,?,'pending')
  `).run(id, req.user.id, type, amount, weekNumber, year, note || null);

  res.status(201).json({
    message: `${type === 'weekly' ? 'Compulsory' : 'Voluntary'} savings of N${Number(amount).toLocaleString()} submitted. Awaiting admin approval.`,
    saving: { id, type, amount, week_number: weekNumber, year, note, status: 'pending' }
  });
});

// POST /api/members/savings/pause — request savings pause (Clause 10.2)
router.post('/savings/pause', (req, res) => {
  const { weeks } = req.body;
  if (!weeks || weeks < 1 || weeks > RULES.MAX_PAUSE_WEEKS) {
    return res.status(400).json({ error: `Pause must be 1-${RULES.MAX_PAUSE_WEEKS} weeks (Clause 10.2)` });
  }

  // Check active loan — can't pause if on a loan
  const activeLoan = db.prepare(`SELECT id FROM loans WHERE user_id=? AND status IN ('approved','in_progress')`).get(req.user.id);
  if (activeLoan) {
    return res.status(400).json({ error: 'Cannot pause savings while you have an active loan (Clause 10.2)' });
  }

  // Check pauses used this year
  const year = new Date().getFullYear();
  const usedPauses = db.prepare(`
    SELECT COUNT(*) as cnt FROM savings_pauses
    WHERE user_id=? AND status='approved' AND strftime('%Y', created_at)=?
  `).get(req.user.id, year.toString());

  if (usedPauses.cnt >= RULES.MAX_PAUSES_PER_YEAR) {
    return res.status(400).json({ error: `You have used all ${RULES.MAX_PAUSES_PER_YEAR} pause allowances for this year (Clause 10.2)` });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO savings_pauses (id, user_id, weeks, fee_paid, status)
    VALUES (?,?,?,?,'pending')
  `).run(id, req.user.id, weeks, RULES.PAUSE_FEE);

  res.status(201).json({
    message: `Pause request for ${weeks} week(s) submitted. Admin will review. A fee of N${RULES.PAUSE_FEE} applies (Clause 10.2).`,
    pause: { id, weeks, fee: RULES.PAUSE_FEE, status: 'pending' }
  });
});

// ============================================================
// LOANS
// ============================================================
router.get('/loans', (req, res) => {
  const loans = db.prepare(`SELECT * FROM loans WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id);
  // Add repayment summary for each loan
  const loansWithRepayments = loans.map(l => {
    const repaid = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as total FROM loan_repayments
      WHERE loan_id=? AND status='approved'
    `).get(l.id);
    const outstanding = (l.amount_approved || l.amount_requested) - repaid.total;
    return { ...l, amount_repaid: repaid.total, outstanding_balance: Math.max(0, outstanding) };
  });
  res.json({ loans: loansWithRepayments });
});

// POST /api/members/loans — apply for a loan
router.post('/loans', (req, res) => {
  const { amount_requested, purpose, guarantor1_id, guarantor2_id, repayment_months } = req.body;

  if (!amount_requested || amount_requested <= 0) {
    return res.status(400).json({ error: 'A valid loan amount is required' });
  }

  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);

  // Clause 4.1: Must have paid registration fee
  if (!user.registration_fee_paid) {
    return res.status(400).json({ error: 'Registration fee must be paid before applying for a loan (Clause 4.1)' });
  }

  // Clause 4.1: 12 weeks of compulsory savings
  const savings = getMemberSavings(req.user.id);
  if (savings.weekly_weeks < RULES.MIN_SAVINGS_WEEKS) {
    return res.status(400).json({
      error: `You need at least ${RULES.MIN_SAVINGS_WEEKS} weeks of approved compulsory savings. You have ${savings.weekly_weeks} weeks. (Clause 4.1)`,
      weekly_weeks: savings.weekly_weeks, required_weeks: RULES.MIN_SAVINGS_WEEKS
    });
  }

  // Clause 4.2: No outstanding fines
  const fines = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM savings_fines WHERE user_id=? AND paid=0`).get(req.user.id);
  if (fines.total > 0) {
    return res.status(400).json({ error: `You have outstanding fines of N${fines.total.toLocaleString()} that must be cleared first (Clause 4.2)` });
  }

  // Clause 4.3: No other active loan
  const activeLoan = db.prepare(`SELECT id FROM loans WHERE user_id=? AND status IN ('pending','approved','in_progress')`).get(req.user.id);
  if (activeLoan) {
    return res.status(400).json({ error: 'You already have an active loan. Complete it before applying for another (Clause 5.6)' });
  }

  // Clause 4: Loan rights not suspended
  if (user.loan_rights_suspended) {
    return res.status(400).json({ error: 'Your loan rights are currently suspended. Please contact admin.' });
  }

  // Clause 5.1: Max 2x total savings (compulsory + voluntary)
  const maxLoanBySavings = savings.total_approved * RULES.LOAN_MULTIPLIER;

  // Clause 5.1: Max 10% of pool
  const pool = getPoolStats();
  const maxSingleLoan = pool.pool * RULES.MAX_SINGLE_LOAN_PCT;
  const maxLoan = Math.min(maxLoanBySavings, maxSingleLoan);

  if (amount_requested > maxLoan) {
    return res.status(400).json({
      error: `Maximum loan is N${Math.floor(maxLoan).toLocaleString()} (2x your savings of N${savings.total_approved.toLocaleString()}, capped at 10% of pool). You requested N${Number(amount_requested).toLocaleString()}. (Clause 5.1)`,
      max_loan: maxLoan
    });
  }

  // Clause 9.2: Enough available funds (reserve & lending cap)
  if (amount_requested > pool.available) {
    return res.status(400).json({
      error: `Insufficient cooperative funds. Available for lending: N${Math.floor(pool.available).toLocaleString()} (after 25% reserve, Clause 9). Your request is on the waiting list.`,
      available: pool.available
    });
  }

  // Clause 4.4: Two guarantors required
  if (!guarantor1_id || !guarantor2_id) {
    return res.status(400).json({ error: 'Two guarantors are required for a loan application (Clause 4.4 & 7.1)' });
  }
  if (guarantor1_id === guarantor2_id) {
    return res.status(400).json({ error: 'Guarantors must be two different members' });
  }
  if (guarantor1_id === req.user.id || guarantor2_id === req.user.id) {
    return res.status(400).json({ error: 'You cannot be your own guarantor' });
  }

  // Validate each guarantor
  for (const gId of [guarantor1_id, guarantor2_id]) {
    const g = db.prepare(`SELECT * FROM users WHERE id=? AND role='member' AND status='approved'`).get(gId);
    if (!g) return res.status(400).json({ error: `Guarantor ${gId} is not a valid approved member` });
    // Guarantor must not be on a loan (Clause 7.1)
    const gLoan = db.prepare(`SELECT id FROM loans WHERE user_id=? AND status IN ('approved','in_progress')`).get(gId);
    if (gLoan) return res.status(400).json({ error: `Guarantor ${g.full_name} currently has an active loan and cannot guarantee (Clause 7.1)` });
    // Guarantor must not already be guaranteeing (Clause 7.1)
    const gGuaranteeing = db.prepare(`
      SELECT id FROM loans WHERE (guarantor1_id=? OR guarantor2_id=?) AND status IN ('pending','approved','in_progress')
    `).get(gId, gId);
    if (gGuaranteeing) return res.status(400).json({ error: `Guarantor ${g.full_name} is already guaranteeing another member (Clause 7.1)` });
    // Guarantor must have been member for 12+ weeks (savings record)
    const gWeeks = db.prepare(`SELECT COUNT(*) as weeks FROM savings WHERE user_id=? AND type='weekly' AND status='approved'`).get(gId);
    if (gWeeks.weeks < RULES.MIN_SAVINGS_WEEKS) return res.status(400).json({ error: `Guarantor ${g.full_name} has not saved for 12 weeks yet (Clause 7.1)` });
  }

  // Calculate processing fee (1%) and net disbursement
  const processingFee = amount_requested * RULES.PROCESSING_FEE_RATE;
  const amountDisbursed = amount_requested - processingFee;
  const months = repayment_months && [3,4,5,6].includes(parseInt(repayment_months)) ? parseInt(repayment_months) : 3;
  const instalment = amount_requested / months;

  const id = uuid();
  db.prepare(`
    INSERT INTO loans (id, user_id, amount_requested, processing_fee, amount_disbursed,
    purpose, guarantor1_id, guarantor2_id, repayment_months, repayment_instalment, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,'pending')
  `).run(id, req.user.id, amount_requested, processingFee, amountDisbursed,
         purpose || null, guarantor1_id, guarantor2_id, months, instalment);

  res.status(201).json({
    message: `Loan application for N${Number(amount_requested).toLocaleString()} submitted. Processing fee: N${processingFee.toLocaleString()}. Net disbursement if approved: N${amountDisbursed.toLocaleString()}. Admin will verify within 1-2 weeks (Clause 5.2).`,
    loan: { id, amount_requested, processing_fee: processingFee, amount_disbursed: amountDisbursed, status: 'pending', repayment_months: months, repayment_instalment: instalment }
  });
});

// POST /api/members/loans/:id/repayment — submit a loan repayment
router.post('/loans/:id/repayment', (req, res) => {
  const { amount, note } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid repayment amount required' });

  const loan = db.prepare(`SELECT * FROM loans WHERE id=? AND user_id=?`).get(req.params.id, req.user.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (!['approved','in_progress'].includes(loan.status)) {
    return res.status(400).json({ error: 'This loan is not active' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO loan_repayments (id, loan_id, user_id, amount, note, status)
    VALUES (?,?,?,?,?,'pending')
  `).run(id, loan.id, req.user.id, amount, note || null);

  res.status(201).json({
    message: `Repayment of N${Number(amount).toLocaleString()} submitted for admin approval.`,
    repayment: { id, amount, status: 'pending' }
  });
});

// ============================================================
// WELFARE LEVY
// ============================================================
router.post('/welfare', (req, res) => {
  const currentMonth = new Date().toISOString().substring(0,7);
  const existing = db.prepare(`SELECT id FROM welfare_levies WHERE user_id=? AND month=?`).get(req.user.id, currentMonth);
  if (existing) return res.status(400).json({ error: 'Welfare levy already recorded for this month' });

  const id = uuid();
  db.prepare(`INSERT INTO welfare_levies (id, user_id, amount, month, paid) VALUES (?,?,?,?,1)`)
    .run(id, req.user.id, RULES.WELFARE_LEVY, currentMonth);

  res.json({ message: `Welfare levy of N${RULES.WELFARE_LEVY} recorded for ${currentMonth}` });
});

// GET /api/members/welfare — welfare history
router.get('/welfare', (req, res) => {
  const levies = db.prepare(`SELECT * FROM welfare_levies WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id);
  res.json({ levies });
});

// ============================================================
// ELIGIBLE GUARANTORS list
// ============================================================
router.get('/eligible-guarantors', (req, res) => {
  const guarantors = db.prepare(`
    SELECT u.id, u.full_name, u.phone,
      (SELECT COUNT(*) FROM savings WHERE user_id=u.id AND type='weekly' AND status='approved') as weeks_saved
    FROM users u
    WHERE u.role='member' AND u.status='approved' AND u.id != ?
    AND u.id NOT IN (
      SELECT user_id FROM loans WHERE status IN ('approved','in_progress')
    )
    AND u.id NOT IN (
      SELECT guarantor1_id FROM loans WHERE status IN ('pending','approved','in_progress')
      UNION
      SELECT guarantor2_id FROM loans WHERE status IN ('pending','approved','in_progress')
    )
  `).all(req.user.id);

  const eligible = guarantors.filter(g => g.weeks_saved >= 12);
  res.json({ guarantors: eligible });
});

// ============================================================
// SUNDAY MEETING CHECK-IN
// ============================================================
router.get('/meetings', (req, res) => {
  const activeMeeting = db.prepare(`SELECT * FROM meetings WHERE is_active=1 ORDER BY created_at DESC LIMIT 1`).get();
  let attendance = null;
  if (activeMeeting) {
    attendance = db.prepare(`SELECT * FROM meeting_attendance WHERE meeting_id=? AND user_id=?`).get(activeMeeting.id, req.user.id);
  }
  const history = db.prepare(`
    SELECT ma.*, m.meeting_code, m.meeting_date
    FROM meeting_attendance ma JOIN meetings m ON ma.meeting_id=m.id
    WHERE ma.user_id=? ORDER BY ma.created_at DESC
  `).all(req.user.id);
  res.json({ active_meeting: activeMeeting, has_checked_in: !!attendance, attendance, history });
});

router.post('/checkin', (req, res) => {
  const { meeting_code, payment_amount } = req.body;
  if (!meeting_code) return res.status(400).json({ error: 'Meeting code is required' });

  const meeting = db.prepare(`SELECT * FROM meetings WHERE meeting_code=? AND is_active=1`).get(meeting_code);
  if (!meeting) return res.status(400).json({ error: 'Invalid or expired meeting code' });

  const existing = db.prepare(`SELECT id FROM meeting_attendance WHERE meeting_id=? AND user_id=?`).get(meeting.id, req.user.id);
  if (existing) return res.status(400).json({ error: 'Already checked in for this meeting' });

  const id = uuid();
  const amount = parseFloat(payment_amount) || 0;
  db.prepare(`INSERT INTO meeting_attendance (id, meeting_id, user_id, payment_made, payment_amount) VALUES (?,?,?,?,?)`)
    .run(id, meeting.id, req.user.id, amount > 0 ? 1 : 0, amount);

  res.json({
    message: 'Meeting check-in successful!',
    attendance: { meeting_code: meeting.meeting_code, meeting_date: meeting.meeting_date, payment_amount: amount }
  });
});

module.exports = router;
