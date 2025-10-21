const Database = require('better-sqlite3');
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
  initialize() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Create database connection
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL'); // Better performance

      // Create tables
      this.createTables();

      console.log('Database initialized successfully at:', this.dbPath);
      return true;
    } catch (error) {
      console.error('Database initialization failed:', error);
      throw error;
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
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_email ON user(email);
      CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at);
    `);
  }

  /**
   * User CRUD operations
   */
  createUser(email, passwordHash) {
    const stmt = this.db.prepare(
      'INSERT INTO user (email, password_hash) VALUES (?, ?)'
    );
    return stmt.run(email, passwordHash);
  }

  getUserByEmail(email) {
    const stmt = this.db.prepare('SELECT * FROM user WHERE email = ?');
    return stmt.get(email);
  }

  updateUserVerification(email, verified) {
    const stmt = this.db.prepare(
      'UPDATE user SET verified = ?, verification_code = NULL, verification_expires = NULL WHERE email = ?'
    );
    return stmt.run(verified, email);
  }

  setVerificationCode(email, code, expiresAt) {
    const stmt = this.db.prepare(
      'UPDATE user SET verification_code = ?, verification_expires = ? WHERE email = ?'
    );
    return stmt.run(code, expiresAt, email);
  }

  setResetCode(email, code, expiresAt) {
    const stmt = this.db.prepare(
      'UPDATE user SET reset_code = ?, reset_expires = ? WHERE email = ?'
    );
    return stmt.run(code, expiresAt, email);
  }

  updatePassword(email, passwordHash) {
    const stmt = this.db.prepare(
      'UPDATE user SET password_hash = ?, reset_code = NULL, reset_expires = NULL WHERE email = ?'
    );
    return stmt.run(passwordHash, email);
  }

  updateLastLogin(email) {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare('UPDATE user SET last_login = ?, login_attempts = 0 WHERE email = ?');
    return stmt.run(now, email);
  }

  incrementLoginAttempts(email) {
    const stmt = this.db.prepare(
      'UPDATE user SET login_attempts = login_attempts + 1 WHERE email = ?'
    );
    return stmt.run(email);
  }

  lockAccount(email, lockUntil) {
    const stmt = this.db.prepare('UPDATE user SET locked_until = ? WHERE email = ?');
    return stmt.run(lockUntil, email);
  }

  resetLoginAttempts(email) {
    const stmt = this.db.prepare('UPDATE user SET login_attempts = 0, locked_until = 0 WHERE email = ?');
    return stmt.run(email);
  }

  /**
   * Settings CRUD operations
   */
  getSetting(key) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key);
    return result ? result.value : null;
  }

  setSetting(key, value) {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = strftime("%s", "now")'
    );
    return stmt.run(key, value, value);
  }

  /**
   * Logs operations
   */
  addLog(type, message, metadata = null) {
    const stmt = this.db.prepare(
      'INSERT INTO logs (type, message, metadata) VALUES (?, ?, ?)'
    );
    return stmt.run(type, message, metadata ? JSON.stringify(metadata) : null);
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
    return stmt.all(...params);
  }

  /**
   * Backup operations
   */
  createBackup(data) {
    const stmt = this.db.prepare(
      'INSERT INTO backups (name, source_path, backup_path, size, file_count, encrypted, manifest) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    return stmt.run(
      data.name,
      data.sourcePath,
      data.backupPath,
      data.size,
      data.fileCount,
      data.encrypted ? 1 : 0,
      JSON.stringify(data.manifest)
    );
  }

  getBackups(limit = 50) {
    const stmt = this.db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT ?');
    return stmt.all(limit);
  }

  getBackupById(id) {
    const stmt = this.db.prepare('SELECT * FROM backups WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * Deletion manifest operations
   */
  addToQuarantine(originalPath, quarantinePath, size) {
    const stmt = this.db.prepare(
      'INSERT INTO deletion_manifest (original_path, quarantine_path, size) VALUES (?, ?, ?)'
    );
    return stmt.run(originalPath, quarantinePath, size);
  }

  getQuarantinedFiles(limit = 100) {
    const stmt = this.db.prepare(
      'SELECT * FROM deletion_manifest WHERE restored = 0 ORDER BY deleted_at DESC LIMIT ?'
    );
    return stmt.all(limit);
  }

  markAsRestored(id) {
    const stmt = this.db.prepare('UPDATE deletion_manifest SET restored = 1 WHERE id = ?');
    return stmt.run(id);
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      console.log('Database connection closed');
    }
  }
}

// Export singleton instance
module.exports = new DatabaseService();
