const initSqlJs = require('sql.js');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_FILE = 'cooperative.db';
let dbInstance = null;
let SQL = null;

function wrapStatement(sqlJsStmt) {
  return {
    run(...params) {
      try { sqlJsStmt.bind(params); sqlJsStmt.step(); }
      catch (e) { sqlJsStmt.reset(); throw e; }
      sqlJsStmt.reset();
      saveDb();
      return { changes: 1 };
    },
    get(...params) {
      sqlJsStmt.bind(params);
      let result;
      if (sqlJsStmt.step()) result = sqlJsStmt.getAsObject();
      sqlJsStmt.reset();
      return result;
    },
    all(...params) {
      sqlJsStmt.bind(params);
      const results = [];
      while (sqlJsStmt.step()) results.push(sqlJsStmt.getAsObject());
      sqlJsStmt.reset();
      return results;
    }
  };
}

function wrapDb(sqlJsDb) {
  return {
    exec(sql) { sqlJsDb.exec(sql); saveDb(); },
    prepare(sql) { return wrapStatement(sqlJsDb.prepare(sql)); },
    pragma() {}
  };
}

function saveDb() {
  if (dbInstance) {
    fs.writeFileSync(DB_FILE, Buffer.from(dbInstance.export()));
  }
}

// ============================================================
// SCHEMA — fully aligned with Membership Agreement
// ============================================================
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    password TEXT NOT NULL,
    address TEXT,
    date_of_birth TEXT,
    occupation TEXT,
    monthly_income_range TEXT,
    next_of_kin TEXT,
    next_of_kin_phone TEXT,
    next_of_kin_relationship TEXT,
    bank_name TEXT,
    bank_account_number TEXT,
    bvn TEXT,
    credit_score INTEGER DEFAULT 0,
    credit_checked INTEGER DEFAULT 0,
    registration_fee_paid INTEGER DEFAULT 0,
    weekly_savings_tier REAL DEFAULT 1000,
    role TEXT DEFAULT 'member',
    status TEXT DEFAULT 'pending',
    loan_rights_suspended INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Compulsory (weekly) and Voluntary (special) savings
  -- Both count toward loan limit
  -- Only approved entries count
  CREATE TABLE IF NOT EXISTS savings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('weekly', 'special')),
    amount REAL NOT NULL,
    week_number INTEGER,
    year INTEGER,
    note TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    admin_comment TEXT,
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Late savings fines tracker (N200 per late week)
  CREATE TABLE IF NOT EXISTS savings_fines (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 200,
    reason TEXT,
    paid INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Savings pause requests (up to 4 weeks, N500 fee, twice/year)
  CREATE TABLE IF NOT EXISTS savings_pauses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    weeks INTEGER NOT NULL DEFAULT 1,
    fee_paid REAL DEFAULT 500,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Loans — includes processing fee (1%), repayment schedule, guarantors
  CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount_requested REAL NOT NULL,
    amount_approved REAL,
    processing_fee REAL DEFAULT 0,
    amount_disbursed REAL,
    purpose TEXT,
    guarantor1_id TEXT,
    guarantor1_confirmed INTEGER DEFAULT 0,
    guarantor2_id TEXT,
    guarantor2_confirmed INTEGER DEFAULT 0,
    repayment_months INTEGER DEFAULT 3,
    repayment_instalment REAL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'in_progress', 'rejected', 'completed')),
    admin_comment TEXT,
    reviewed_by TEXT,
    disbursed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Loan repayments (weekly or monthly instalments)
  CREATE TABLE IF NOT EXISTS loan_repayments (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    approved_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Late loan fines (N500 per late instalment)
  CREATE TABLE IF NOT EXISTS loan_fines (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 500,
    reason TEXT,
    paid INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Welfare levy (N300/month per member)
  CREATE TABLE IF NOT EXISTS welfare_levies (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 300,
    month TEXT NOT NULL,
    paid INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Sunday meetings
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    meeting_code TEXT NOT NULL,
    meeting_date TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Meeting attendance
  CREATE TABLE IF NOT EXISTS meeting_attendance (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    payment_made INTEGER DEFAULT 0,
    payment_amount REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(meeting_id, user_id)
  );
`;

async function initDb() {
  const path = require('path');
  const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist');
  SQL = await initSqlJs({ locateFile: file => path.join(wasmPath, file) });

  if (fs.existsSync(DB_FILE)) {
    dbInstance = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    dbInstance = new SQL.Database();
  }

  dbInstance.exec(SCHEMA);

  // Create default admin if not exists
  const adminResult = dbInstance.exec("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const adminExists = adminResult && adminResult.length > 0 && adminResult[0].values.length > 0;

  if (!adminExists) {
    const id = uuidv4();
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    const stmt = dbInstance.prepare(`
      INSERT INTO users (id, full_name, email, phone, password, role, status, registration_fee_paid, credit_score, credit_checked)
      VALUES (?, 'System Admin', 'admin@cooperative.ng', '+2348032180923', ?, 'admin', 'approved', 1, 850, 1)
    `);
    stmt.bind([id, hashedPassword]);
    stmt.step();
    stmt.free();
    saveDb();
    console.log('Default admin created: admin@cooperative.ng / admin123');
  }

  return wrapDb(dbInstance);
}

module.exports = { initDb, saveDb };
