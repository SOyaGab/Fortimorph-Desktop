const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class DatabaseService {
  constructor() {
    this.db = null;
    this.dbPath = path.join(app.getPath('userData'), 'fortimorph.db');
    this.saveTimer = null;
    this.saveDebounceMs = 1000; // Debounce database saves for 1 second
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
   * Save database to file (debounced for performance)
   */
  saveDatabase() {
    // Clear existing timer
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    
    // Debounce the save operation
    this.saveTimer = setTimeout(() => {
      try {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbPath, buffer);
      } catch (error) {
        console.error('Error saving database:', error);
      }
    }, this.saveDebounceMs);
  }

  /**
   * Force immediate database save (use sparingly)
   */
  saveDatabaseImmediate() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    
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
        level TEXT DEFAULT 'info',
        message TEXT NOT NULL,
        metadata TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    
    // Migrate existing logs table to add level column if it doesn't exist
    try {
      // Check if level column exists
      const checkStmt = this.db.prepare("PRAGMA table_info(logs)");
      let hasLevelColumn = false;
      let hasUserIdColumn = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'level') {
          hasLevelColumn = true;
        }
        if (row.name === 'user_id') {
          hasUserIdColumn = true;
        }
      }
      checkStmt.free();
      
      // Add level column if it doesn't exist
      if (!hasLevelColumn) {
        console.log('Migrating logs table: adding level column');
        this.db.exec(`ALTER TABLE logs ADD COLUMN level TEXT DEFAULT 'info'`);
      }
      
      // Add user_id column if it doesn't exist
      if (!hasUserIdColumn) {
        console.log('Migrating logs table: adding user_id column');
        this.db.exec(`ALTER TABLE logs ADD COLUMN user_id TEXT`);
      }
    } catch (error) {
      console.warn('Migration check for logs table:', error.message);
    }

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
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at)`);
    
    // Create Firebase users cache table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS firebase_users_cache (
        uid TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        display_name TEXT,
        photo_url TEXT,
        email_verified INTEGER DEFAULT 0,
        created_at INTEGER,
        last_login INTEGER,
        last_sync INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_firebase_users_email ON firebase_users_cache(email)`);
    
    // Create verification codes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        uid TEXT PRIMARY KEY,
        email TEXT,
        code TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        verified INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    
    // Add email column if it doesn't exist (migration for existing databases)
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(verification_codes)");
      let hasEmailColumn = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'email') {
          hasEmailColumn = true;
          break;
        }
      }
      checkStmt.free();
      
      if (!hasEmailColumn) {
        console.log('Adding email column to verification_codes table...');
        this.db.exec('ALTER TABLE verification_codes ADD COLUMN email TEXT');
      }
    } catch (error) {
      console.log('Email column migration check completed');
    }
    
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

  setVerificationCode(identifier, code, expiresAt) {
    // identifier can be email or uid
    // First, try to find user by email
    let user = this.getUserByEmail(identifier);
    
    if (!user) {
      // Try to get user from verification_codes table by uid
      const stmt = this.db.prepare('SELECT * FROM verification_codes WHERE uid = ?');
      stmt.bind([identifier]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        // Update verification_codes table
        const updateStmt = this.db.prepare(
          'UPDATE verification_codes SET code = ?, expires_at = ? WHERE uid = ?'
        );
        updateStmt.bind([code, expiresAt, identifier]);
        updateStmt.step();
        updateStmt.free();
        this.saveDatabase();
        return { success: true };
      }
      stmt.free();
    } else {
      // Update user table
      const stmt = this.db.prepare(
        'UPDATE user SET verification_code = ?, verification_expires = ? WHERE email = ?'
      );
      stmt.bind([code, expiresAt, identifier]);
      stmt.step();
      stmt.free();
      
      // Also insert/update in verification_codes table for consistency
      const checkStmt = this.db.prepare('SELECT * FROM verification_codes WHERE uid = ?');
      checkStmt.bind([identifier]);
      if (checkStmt.step()) {
        checkStmt.free();
        const updateStmt = this.db.prepare(
          'UPDATE verification_codes SET code = ?, expires_at = ? WHERE uid = ?'
        );
        updateStmt.bind([code, expiresAt, identifier]);
        updateStmt.step();
        updateStmt.free();
      } else {
        checkStmt.free();
        const insertStmt = this.db.prepare(
          'INSERT INTO verification_codes (uid, code, expires_at, verified) VALUES (?, ?, ?, 0)'
        );
        insertStmt.bind([identifier, code, expiresAt]);
        insertStmt.step();
        insertStmt.free();
      }
      
      this.saveDatabase();
      return { success: true };
    }
    
    return { success: false, error: 'User not found' };
  }

  setVerificationCodeForFirebase(uid, email, code, expiresAt) {
    // For Firebase users, directly insert/update in verification_codes table
    const checkStmt = this.db.prepare('SELECT * FROM verification_codes WHERE uid = ?');
    checkStmt.bind([uid]);
    
    if (checkStmt.step()) {
      // Update existing
      checkStmt.free();
      const updateStmt = this.db.prepare(
        'UPDATE verification_codes SET email = ?, code = ?, expires_at = ?, verified = 0 WHERE uid = ?'
      );
      updateStmt.bind([email, code, expiresAt, uid]);
      updateStmt.step();
      updateStmt.free();
    } else {
      // Insert new
      checkStmt.free();
      const insertStmt = this.db.prepare(
        'INSERT INTO verification_codes (uid, email, code, expires_at, verified) VALUES (?, ?, ?, ?, 0)'
      );
      insertStmt.bind([uid, email, code, expiresAt]);
      insertStmt.step();
      insertStmt.free();
    }
    
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

  getVerificationCode(identifier) {
    console.log(`🔍 Getting verification code for identifier: ${identifier}`);
    
    // Try to get from user table first (local mode uses email)
    const user = this.getUserByEmail(identifier);
    if (user && user.verification_code) {
      console.log('✓ Found in user table (local mode)');
      return {
        code: user.verification_code,
        expires_at: user.verification_expires,
        verified: user.verified
      };
    }
    
    // Try verification_codes table by uid (Firebase mode uses uid)
    let stmt = this.db.prepare('SELECT * FROM verification_codes WHERE uid = ?');
    stmt.bind([identifier]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      console.log('✓ Found in verification_codes table by UID');
      return row;
    }
    stmt.free();
    
    // Try verification_codes table by email (for Firebase users)
    // Get the NEWEST code by created_at timestamp
    stmt = this.db.prepare('SELECT * FROM verification_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1');
    stmt.bind([identifier]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      console.log('✓ Found in verification_codes table by EMAIL (newest)');
      return row;
    }
    stmt.free();
    
    console.log('✗ No verification code found');
    return null;
  }

  markEmailAsVerified(identifier) {
    console.log(`✅ Marking as verified for identifier: ${identifier}`);
    
    // Update user table (local mode)
    const user = this.getUserByEmail(identifier);
    if (user) {
      const stmt = this.db.prepare(
        'UPDATE user SET verified = 1, verification_code = NULL, verification_expires = NULL WHERE email = ?'
      );
      stmt.bind([identifier]);
      stmt.step();
      stmt.free();
      console.log('✓ Updated user table');
    }
    
    // Update verification_codes table by UID (Firebase mode)
    let stmt2 = this.db.prepare('UPDATE verification_codes SET verified = 1 WHERE uid = ?');
    stmt2.bind([identifier]);
    stmt2.step();
    stmt2.free();
    
    // Also try by email (Firebase mode)
    stmt2 = this.db.prepare('UPDATE verification_codes SET verified = 1 WHERE email = ?');
    stmt2.bind([identifier]);
    stmt2.step();
    stmt2.free();
    console.log('✓ Updated verification_codes table');
    
    this.saveDatabase();
    return { success: true };
  }

  isEmailVerified(identifier) {
    // Check user table first (local mode uses email)
    const user = this.getUserByEmail(identifier);
    if (user) {
      return user.verified === 1;
    }
    
    // Check verification_codes table (Firebase mode uses uid)
    const stmt = this.db.prepare('SELECT verified FROM verification_codes WHERE uid = ?');
    stmt.bind([identifier]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row.verified === 1;
    }
    stmt.free();
    // If no record found, assume not verified
    return false;
  }

  /**
   * Firebase Users Cache operations
   */
  syncFirebaseUserToLocal(firebaseUser) {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO firebase_users_cache 
        (uid, email, display_name, photo_url, email_verified, created_at, last_login, last_sync) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const now = Math.floor(Date.now() / 1000);
      const createdAt = firebaseUser.metadata?.creationTime 
        ? Math.floor(new Date(firebaseUser.metadata.creationTime).getTime() / 1000)
        : now;
      const lastLogin = firebaseUser.metadata?.lastSignInTime
        ? Math.floor(new Date(firebaseUser.metadata.lastSignInTime).getTime() / 1000)
        : now;
      
      stmt.bind([
        firebaseUser.uid,
        firebaseUser.email,
        firebaseUser.displayName || null,
        firebaseUser.photoURL || null,
        firebaseUser.emailVerified ? 1 : 0,
        createdAt,
        lastLogin,
        now
      ]);
      stmt.step();
      stmt.free();
      this.saveDatabase();
      
      console.log(`✅ Synced Firebase user to local cache: ${firebaseUser.email}`);
      return { success: true };
    } catch (error) {
      console.error('Error syncing Firebase user to local:', error);
      return { success: false, error: error.message };
    }
  }

  getFirebaseUserFromCache(uid) {
    const stmt = this.db.prepare('SELECT * FROM firebase_users_cache WHERE uid = ?');
    stmt.bind([uid]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  getFirebaseUserByEmail(email) {
    const stmt = this.db.prepare('SELECT * FROM firebase_users_cache WHERE email = ?');
    stmt.bind([email]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  getAllFirebaseUsers() {
    const users = [];
    const stmt = this.db.prepare('SELECT * FROM firebase_users_cache ORDER BY last_login DESC');
    while (stmt.step()) {
      users.push(stmt.getAsObject());
    }
    stmt.free();
    return users;
  }

  updateFirebaseUserLastLogin(uid) {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare('UPDATE firebase_users_cache SET last_login = ?, last_sync = ? WHERE uid = ?');
    stmt.bind([now, now, uid]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
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
   * Delete user data from local database
   * @param {String} uid - User ID (Firebase UID or local_XX)
   * @param {Object} options - Deletion options
   * @param {Boolean} options.deleteLogs - Whether to delete user's logs (default: true)
   * @param {Boolean} options.anonymizeLogs - Anonymize logs instead of deleting (default: false)
   */
  deleteUserData(uid, options = {}) {
    try {
      const { deleteLogs = true, anonymizeLogs = false } = options;
      
      console.log(`🗑️ Deleting user data for UID: ${uid}`);
      
      // Delete from firebase_users_cache
      let stmt = this.db.prepare('DELETE FROM firebase_users_cache WHERE uid = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted from firebase_users_cache');
      
      // Delete from verification_codes
      stmt = this.db.prepare('DELETE FROM verification_codes WHERE uid = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted from verification_codes');
      
      // Delete from local user table (if exists)
      const email = uid.startsWith('local_') ? this.getUserByLocalUid(uid)?.email : null;
      if (email) {
        stmt = this.db.prepare('DELETE FROM user WHERE email = ?');
        stmt.bind([email]);
        stmt.step();
        stmt.free();
        console.log('  ✓ Deleted from user table');
      }
      
      // Handle user logs
      if (deleteLogs) {
        // Option 1: Delete all user's logs
        stmt = this.db.prepare('DELETE FROM logs WHERE user_id = ?');
        stmt.bind([uid]);
        stmt.step();
        stmt.free();
        console.log('  ✓ Deleted user logs');
      } else if (anonymizeLogs) {
        // Option 2: Anonymize logs (recommended for audit trail)
        stmt = this.db.prepare('UPDATE logs SET user_id = NULL, metadata = NULL WHERE user_id = ?');
        stmt.bind([uid]);
        stmt.step();
        stmt.free();
        console.log('  ✓ Anonymized user logs (converted to system logs)');
      }
      // Option 3: Keep logs as-is (do nothing)
      
      this.saveDatabase();
      
      return { 
        success: true, 
        message: 'User data deleted successfully',
        deletedLogs: deleteLogs,
        anonymizedLogs: anonymizeLogs && !deleteLogs
      };
    } catch (error) {
      console.error('Error deleting user data:', error);
      return { success: false, error: error.message };
    }
  }

  getUserByLocalUid(localUid) {
    const id = localUid.replace('local_', '');
    const stmt = this.db.prepare('SELECT * FROM user WHERE id = ?');
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
  addLog(type, message, metadata = null, level = 'info', userId = null) {
    const stmt = this.db.prepare(
      'INSERT INTO logs (type, level, message, metadata, user_id) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.bind([type, level, message, metadata ? JSON.stringify(metadata) : null, userId]);
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
   * Get logs for a specific user
   * Returns user's logs + system logs (logs without user_id)
   * @param {String} userId - User ID to filter logs
   * @param {String} type - Optional log type filter
   * @param {Number} limit - Maximum number of logs to return
   */
  getLogsByUser(userId, type = null, limit = 100) {
    let query = 'SELECT * FROM logs WHERE (user_id = ? OR user_id IS NULL)';
    const params = [userId];

    if (type) {
      query += ' AND type = ?';
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
   * Enhanced logs filtering with pagination
   * @param {Object} filters - { level, type, searchText, startDate, endDate }
   * @param {Number} page - Page number (1-indexed)
   * @param {Number} pageSize - Items per page
   */
  getLogsFiltered(filters = {}, page = 1, pageSize = 50) {
    let query = 'SELECT * FROM logs WHERE 1=1';
    const params = [];

    // User filter - show user's logs + system logs
    if (filters.userId) {
      query += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(filters.userId);
    }

    // Level filter
    if (filters.level && filters.level !== 'all') {
      query += ' AND level = ?';
      params.push(filters.level);
    }

    // Type/Module filter
    if (filters.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    // Search text filter
    if (filters.searchText) {
      query += ' AND message LIKE ?';
      params.push(`%${filters.searchText}%`);
    }

    // Date range filters
    if (filters.startDate) {
      query += ' AND timestamp >= ?';
      params.push(Math.floor(filters.startDate / 1000));
    }

    if (filters.endDate) {
      query += ' AND timestamp <= ?';
      params.push(Math.floor(filters.endDate / 1000));
    }

    // Count total results
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countStmt = this.db.prepare(countQuery);
    countStmt.bind(params);
    let total = 0;
    if (countStmt.step()) {
      total = countStmt.getAsObject().total;
    }
    countStmt.free();

    // Add pagination
    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const stmt = this.db.prepare(query);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    return {
      logs: results,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };
  }

  /**
   * Get unique log types/modules
   */
  getLogTypes() {
    const query = 'SELECT DISTINCT type FROM logs ORDER BY type';
    const stmt = this.db.prepare(query);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject().type);
    }
    stmt.free();
    return results;
  }

  /**
   * Clean up old logs (retention policy)
   * @param {Number} retentionDays - Days to keep logs
   */
  cleanupOldLogs(retentionDays = 30) {
    const cutoffTimestamp = Math.floor((Date.now() - retentionDays * 24 * 60 * 60 * 1000) / 1000);
    const stmt = this.db.prepare('DELETE FROM logs WHERE timestamp < ?');
    stmt.bind([cutoffTimestamp]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    
    // Log the cleanup action
    this.addLog('system', `Cleaned up logs older than ${retentionDays} days`, null, 'info');
    return { success: true };
  }

  /**
   * Export logs to structured format
   * @param {Object} filters - Same as getLogsFiltered
   */
  exportLogs(filters = {}) {
    let query = 'SELECT * FROM logs WHERE 1=1';
    const params = [];

    if (filters.level && filters.level !== 'all') {
      query += ' AND level = ?';
      params.push(filters.level);
    }

    if (filters.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    if (filters.searchText) {
      query += ' AND message LIKE ?';
      params.push(`%${filters.searchText}%`);
    }

    if (filters.startDate) {
      query += ' AND timestamp >= ?';
      params.push(Math.floor(filters.startDate / 1000));
    }

    if (filters.endDate) {
      query += ' AND timestamp <= ?';
      params.push(Math.floor(filters.endDate / 1000));
    }

    query += ' ORDER BY timestamp DESC';

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
      // Force immediate save before closing
      this.saveDatabaseImmediate();
      this.db.close();
      console.log('Database connection closed');
    }
  }
}

// Export singleton instance
module.exports = new DatabaseService();
