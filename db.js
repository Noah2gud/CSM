const initSqlJs = require('sql.js');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_FILE = 'cooperative.db';

let dbInstance = null;
let SQL = null;

// Wrapper that mimics better-sqlite3 interface on top of sql.js
function wrapStatement(sqlJsStmt, db) {
  return {
    run(...params) {
      try {
        sqlJsStmt.bind(params);
        sqlJsStmt.step();
      } catch (e) {
        sqlJsStmt.reset();
        throw e;
      }
      sqlJsStmt.reset();
      saveDb();
      return { changes: 1 };
    },
    get(...params) {
      sqlJsStmt.bind(params);
      let result = undefined;
      if (sqlJsStmt.step()) {
        result = sqlJsStmt.getAsObject();
      }
      sqlJsStmt.reset();
      return result;
    },
    all(...params) {
      sqlJsStmt.bind(params);
      const results = [];
      while (sqlJsStmt.step()) {
        results.push(sqlJsStmt.getAsObject());
      }
      sqlJsStmt.reset();
      return results;
    }
  };
}

function wrapDb(sqlJsDb) {
  return {
    exec(sql) {
      sqlJsDb.exec(sql);
      saveDb();
    },
    prepare(sql) {
      const stmt = sqlJsDb.prepare(sql);
      return wrapStatement(stmt, sqlJsDb);
    },
    pragma() {
      // No-op for sql.js
    }
  };
}

function saveDb() {
  if (dbInstance) {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  }
}

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
    next_of_kin TEXT,
    next_of_kin_phone TEXT,
    bvn TEXT,
    credit_score INTEGER DEFAULT 0,
    credit_checked INTEGER DEFAULT 0,
    registration_fee_paid INTEGER DEFAULT 0,
    role TEXT DEFAULT 'member',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS savings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('weekly', 'special')),
    amount REAL NOT NULL,
    week_number INTEGER,
    year INTEGER,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount_requested REAL NOT NULL,
    purpose TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'in_progress', 'rejected')),
    admin_comment TEXT,
    reviewed_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    meeting_code TEXT NOT NULL,
    meeting_date TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meeting_attendance (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    payment_made INTEGER DEFAULT 0,
    payment_amount REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS loan_repayments (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
  );
`;

async function initDb() {
  const path = require('path');
  const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist');
  SQL = await initSqlJs({ locateFile: file => path.join(wasmPath, file) });

  if (fs.existsSync(DB_FILE)) {
    const buffer = fs.readFileSync(DB_FILE);
    dbInstance = new SQL.Database(buffer);
  } else {
    dbInstance = new SQL.Database();
  }

  // Create tables
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

  const wrappedDb = wrapDb(dbInstance);
  return wrappedDb;
}

module.exports = { initDb, saveDb };
