const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class DatabaseService {
  constructor() {
    this.db = null;
    this.dbPath = path.join(app.getPath('userData'), 'fortimorph.db');
  }

  /**
   * Initialize database connection and create tables
   */
  async initialize() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Initialize SQL.js
      const SQL = await initSqlJs();

      // Load existing database or create new one
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
        console.log('Loaded existing database from:', this.dbPath);
      } else {
        this.db = new SQL.Database();
        console.log('Created new database at:', this.dbPath);
      }

      // Create tables
      this.createTables();

      // Save database to file
      this.saveDatabase();

      console.log('Database initialized successfully at:', this.dbPath);
      return true;
    } catch (error) {
      console.error('Database initialization failed:', error);
      throw error;
    }
  }

  /**
   * Save database to file
   */
  saveDatabase() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      console.error('Error saving database:', error);
    }
  }

  /**
   * Create all required tables
   */
  createTables() {
    // User table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        verified INTEGER DEFAULT 0,
        verification_code TEXT,
        verification_expires INTEGER,
        reset_code TEXT,
        reset_expires INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_login INTEGER,
        login_attempts INTEGER DEFAULT 0,
        locked_until INTEGER DEFAULT 0
      )
    `);

    // Settings table (key-value store)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Backups table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source_path TEXT NOT NULL,
        backup_path TEXT NOT NULL,
        size INTEGER,
        file_count INTEGER,
        encrypted INTEGER DEFAULT 0,
        manifest TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Deletion manifest table (quarantine)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deletion_manifest (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_path TEXT NOT NULL,
        quarantine_path TEXT NOT NULL,
        size INTEGER,
        deleted_at INTEGER DEFAULT (strftime('%s', 'now')),
        restored INTEGER DEFAULT 0
      )
    `);

    // Create indexes for better performance
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_user_email ON user(email)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at)`);
    
    // Create verification codes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        uid TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        verified INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    
    this.saveDatabase();
  }

  /**
   * User CRUD operations
   */
  createUser(email, passwordHash) {
    const stmt = this.db.prepare('INSERT INTO user (email, password_hash) VALUES (?, ?)');
    stmt.bind([email, passwordHash]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  getUserByEmail(email) {
    const stmt = this.db.prepare('SELECT * FROM user WHERE email = ?');
    stmt.bind([email]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  updateUserVerification(email, verified) {
    const stmt = this.db.prepare(
      'UPDATE user SET verified = ?, verification_code = NULL, verification_expires = NULL WHERE email = ?'
    );
    stmt.bind([verified, email]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  setVerificationCode(email, code, expiresAt) {
    const stmt = this.db.prepare(
      'UPDATE user SET verification_code = ?, verification_expires = ? WHERE email = ?'
    );
    stmt.bind([code, expiresAt, email]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  setResetCode(email, code, expiresAt) {
    const stmt = this.db.prepare(
      'UPDATE user SET reset_code = ?, reset_expires = ? WHERE email = ?'
    );
    stmt.bind([code, expiresAt, email]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  updatePassword(email, passwordHash) {
    const stmt = this.db.prepare(
      'UPDATE user SET password_hash = ?, reset_code = NULL, reset_expires = NULL WHERE email = ?'
    );
    stmt.bind([passwordHash, email]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  updateLastLogin(email) {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare('UPDATE user SET last_login = ?, login_attempts = 0 WHERE email = ?');
    stmt.bind([now, email]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  incrementLoginAttempts(email) {
    const stmt = this.db.prepare(
      'UPDATE user SET login_attempts = login_attempts + 1 WHERE email = ?'
    );
    stmt.bind([email]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  lockAccount(email, lockUntil) {
    const stmt = this.db.prepare('UPDATE user SET locked_until = ? WHERE email = ?');
    stmt.bind([lockUntil, email]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  resetLoginAttempts(email) {
    const stmt = this.db.prepare('UPDATE user SET login_attempts = 0, locked_until = 0 WHERE email = ?');
    stmt.bind([email]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  /**
   * Verification code operations
   */
  setVerificationCodeByUid(uid, code, expiresAt) {
    // First try to update, if no rows affected, then insert
    const selectStmt = this.db.prepare('SELECT uid FROM verification_codes WHERE uid = ?');
    selectStmt.bind([uid]);
    const exists = selectStmt.step();
    selectStmt.free();

    if (exists) {
      const updateStmt = this.db.prepare(
        'UPDATE verification_codes SET code = ?, expires_at = ?, verified = 0 WHERE uid = ?'
      );
      updateStmt.bind([code, expiresAt, uid]);
      updateStmt.step();
      updateStmt.free();
    } else {
      const insertStmt = this.db.prepare(
        'INSERT INTO verification_codes (uid, code, expires_at) VALUES (?, ?, ?)'
      );
      insertStmt.bind([uid, code, expiresAt]);
      insertStmt.step();
      insertStmt.free();
    }
    
    this.saveDatabase();
    return { success: true };
  }

  getVerificationCode(uid) {
    const stmt = this.db.prepare('SELECT * FROM verification_codes WHERE uid = ?');
    stmt.bind([uid]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  markEmailAsVerified(uid) {
    const stmt = this.db.prepare('UPDATE verification_codes SET verified = 1 WHERE uid = ?');
    stmt.bind([uid]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  isEmailVerified(uid) {
    const stmt = this.db.prepare('SELECT verified FROM verification_codes WHERE uid = ?');
    stmt.bind([uid]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row.verified === 1;
    }
    stmt.free();
    // If no record found, assume not verified
    return false;
  }

  // Admin/Debug methods
  getAllUsers() {
    const users = [];
    const stmt = this.db.prepare('SELECT email, verified, created_at FROM user');
    while (stmt.step()) {
      users.push(stmt.getAsObject());
    }
    stmt.free();
    return users;
  }

  getAllVerificationCodes() {
    const codes = [];
    const stmt = this.db.prepare('SELECT uid, verified, created_at FROM verification_codes');
    while (stmt.step()) {
      codes.push(stmt.getAsObject());
    }
    stmt.free();
    return codes;
  }

  manuallyVerifyUser(uid) {
    try {
      // Update verification_codes table
      const selectStmt = this.db.prepare('SELECT uid FROM verification_codes WHERE uid = ?');
      selectStmt.bind([uid]);
      const exists = selectStmt.step();
      selectStmt.free();

      if (exists) {
        const updateStmt = this.db.prepare('UPDATE verification_codes SET verified = 1 WHERE uid = ?');
        updateStmt.bind([uid]);
        updateStmt.step();
        updateStmt.free();
      } else {
        // Create a verification record
        const insertStmt = this.db.prepare(
          'INSERT INTO verification_codes (uid, code, expires_at, verified) VALUES (?, ?, ?, 1)'
        );
        insertStmt.bind([uid, 'MANUAL', 0]);
        insertStmt.step();
        insertStmt.free();
      }

      this.saveDatabase();
      return { success: true, message: 'User manually verified' };
    } catch (error) {
      console.error('Error manually verifying user:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Settings CRUD operations
   */
  getSetting(key) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    stmt.bind([key]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row.value;
    }
    stmt.free();
    return null;
  }

  setSetting(key, value) {
    // First try to update, if no rows affected, then insert
    const selectStmt = this.db.prepare('SELECT key FROM settings WHERE key = ?');
    selectStmt.bind([key]);
    const exists = selectStmt.step();
    selectStmt.free();

    if (exists) {
      const updateStmt = this.db.prepare(
        'UPDATE settings SET value = ?, updated_at = strftime("%s", "now") WHERE key = ?'
      );
      updateStmt.bind([value, key]);
      updateStmt.step();
      updateStmt.free();
    } else {
      const insertStmt = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      insertStmt.bind([key, value]);
      insertStmt.step();
      insertStmt.free();
    }
    
    this.saveDatabase();
    return { success: true };
  }

  /**
   * Logs operations
   */
  addLog(type, message, metadata = null) {
    const stmt = this.db.prepare(
      'INSERT INTO logs (type, message, metadata) VALUES (?, ?, ?)'
    );
    stmt.bind([type, message, metadata ? JSON.stringify(metadata) : null]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  getLogs(type = null, limit = 100) {
    let query = 'SELECT * FROM logs';
    const params = [];

    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Backup operations
   */
  createBackup(data) {
    const stmt = this.db.prepare(
      'INSERT INTO backups (name, source_path, backup_path, size, file_count, encrypted, manifest) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    stmt.bind([
      data.name,
      data.sourcePath,
      data.backupPath,
      data.size,
      data.fileCount,
      data.encrypted ? 1 : 0,
      JSON.stringify(data.manifest)
    ]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  getBackups(limit = 50) {
    const stmt = this.db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT ?');
    stmt.bind([limit]);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  getBackupById(id) {
    const stmt = this.db.prepare('SELECT * FROM backups WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  /**
   * Deletion manifest operations
   */
  addToQuarantine(originalPath, quarantinePath, size) {
    const stmt = this.db.prepare(
      'INSERT INTO deletion_manifest (original_path, quarantine_path, size) VALUES (?, ?, ?)'
    );
    stmt.bind([originalPath, quarantinePath, size]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  getQuarantinedFiles(limit = 100) {
    const stmt = this.db.prepare(
      'SELECT * FROM deletion_manifest WHERE restored = 0 ORDER BY deleted_at DESC LIMIT ?'
    );
    stmt.bind([limit]);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  markAsRestored(id) {
    const stmt = this.db.prepare('UPDATE deletion_manifest SET restored = 1 WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.saveDatabase();
      this.db.close();
      console.log('Database connection closed');
    }
  }
}

// Export singleton instance
module.exports = new DatabaseService();
