const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const uuid = require('uuid').v4;
const { authenticate, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const db = global.db;

// Simulated credit score check
// In production, this would call a credit bureau API (e.g., CRC, CreditRegistry in Nigeria)
function checkCreditScore(bvn, phone) {
  // Simulate a credit score between 300 and 850
  // Use a hash-like approach based on BVN for consistency
  let hash = 0;
  const str = bvn + phone;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & 0xffff;
  }
  const score = 300 + (Math.abs(hash) % 551); // 300-850 range
  return score;
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const {
    full_name, email, phone, password, address,
    date_of_birth, occupation, next_of_kin, next_of_kin_phone, bvn
  } = req.body;

  // Validate required fields
  if (!full_name || !email || !phone || !password || !bvn) {
    return res.status(400).json({ error: 'Full name, email, phone, password, and BVN are required' });
  }

  // Check if email already exists
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  // Check credit score
  const creditScore = checkCreditScore(bvn, phone);
  const creditChecked = 1;

  // Determine eligibility based on credit score
  // Score >= 550 is eligible to join
  const MINIMUM_CREDIT_SCORE = 550;
  const isEligible = creditScore >= MINIMUM_CREDIT_SCORE;

  const hashedPassword = bcrypt.hashSync(password, 10);
  const id = uuid();

  // If not eligible, still create account but mark as rejected
  const status = isEligible ? 'pending' : 'rejected';

  db.prepare(`
    INSERT INTO users (
      id, full_name, email, phone, password, address, date_of_birth,
      occupation, next_of_kin, next_of_kin_phone, bvn,
      credit_score, credit_checked, status, role
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'member')
  `).run(
    id, full_name, email, phone, hashedPassword, address || null,
    date_of_birth || null, occupation || null, next_of_kin || null,
    next_of_kin_phone || null, bvn, creditScore, creditChecked, status
  );

  if (!isEligible) {
    return res.status(403).json({
      error: 'Registration declined',
      message: `Your credit score is ${creditScore}, which is below the minimum requirement of ${MINIMUM_CREDIT_SCORE}. You are not eligible to join the cooperative at this time.`,
      credit_score: creditScore,
      eligible: false
    });
  }

  // Generate token
  const token = jwt.sign(
    { id, email, role: 'member' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    message: 'Registration successful! Please pay the N5,000 registration fee to complete your membership.',
    token,
    user: {
      id, full_name, email, phone, role: 'member',
      credit_score: creditScore, status,
      registration_fee_paid: 0
    },
    credit_score: creditScore,
    eligible: true,
    registration_fee: 5000
  });
});

// POST /api/auth/pay-registration
router.post('/pay-registration', authenticate, (req, res) => {
  const { payment_ref } = req.body;
  const user = db.prepare('SELECT registration_fee_paid, status FROM users WHERE id = ?').get(req.user.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.registration_fee_paid) {
    return res.json({ message: 'Registration fee already paid' });
  }

  // Mark fee as paid and approve the account
  db.prepare(`
    UPDATE users SET registration_fee_paid = 1, status = 'approved', updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id);

  res.json({
    message: 'Registration fee of N5,000 paid successfully. Your account is now approved!',
    registration_fee_paid: true,
    status: 'approved'
  });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (user.status === 'rejected') {
    return res.status(403).json({
      error: 'Account rejected',
      message: 'Your registration was declined due to credit score. Please contact the cooperative office.'
    });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      registration_fee_paid: !!user.registration_fee_paid,
      credit_score: user.credit_score
    }
  });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare(`
    SELECT id, full_name, email, phone, address, date_of_birth,
    occupation, next_of_kin, next_of_kin_phone, bvn, credit_score,
    registration_fee_paid, role, status, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user });
});

module.exports = router;
