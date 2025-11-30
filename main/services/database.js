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
        user_id TEXT,
        key TEXT NOT NULL,
        value TEXT,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    
    // Add user_id column to settings if it doesn't exist
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(settings)");
      let hasUserId = false;
      let hasUniqueConstraint = true; // Check if key column still has UNIQUE constraint
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'user_id') {
          hasUserId = true;
        }
      }
      checkStmt.free();
      
      if (!hasUserId) {
        console.log('Migrating settings table: adding user_id column');
        this.db.exec(`ALTER TABLE settings ADD COLUMN user_id TEXT`);
        
        // Drop the UNIQUE constraint on key by recreating the table
        console.log('Migrating settings table: removing UNIQUE constraint on key to allow per-user settings');
        this.db.exec(`
          CREATE TABLE settings_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            key TEXT NOT NULL,
            value TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
          );
          
          INSERT INTO settings_new (id, user_id, key, value, updated_at)
          SELECT id, user_id, key, value, updated_at FROM settings;
          
          DROP TABLE settings;
          
          ALTER TABLE settings_new RENAME TO settings;
          
          CREATE INDEX idx_settings_user_key ON settings(user_id, key);
        `);
      }
    } catch (error) {
      console.warn('Migration check for settings table:', error.message);
    }

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
        user_id TEXT,
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
    
    // Add user_id column to backups if it doesn't exist
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(backups)");
      let hasUserId = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'user_id') {
          hasUserId = true;
          break;
        }
      }
      checkStmt.free();
      
      if (!hasUserId) {
        console.log('Migrating backups table: adding user_id column');
        this.db.exec(`ALTER TABLE backups ADD COLUMN user_id TEXT`);
      }
    } catch (error) {
      console.warn('Migration check for backups table:', error.message);
    }

    // Deletion manifest table (quarantine)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deletion_manifest (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        original_path TEXT NOT NULL,
        quarantine_path TEXT NOT NULL,
        size INTEGER,
        deleted_at INTEGER DEFAULT (strftime('%s', 'now')),
        restored INTEGER DEFAULT 0
      )
    `);
    
    // Add user_id column to deletion_manifest if it doesn't exist
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(deletion_manifest)");
      let hasUserId = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'user_id') {
          hasUserId = true;
          break;
        }
      }
      checkStmt.free();
      
      if (!hasUserId) {
        console.log('Migrating deletion_manifest table: adding user_id column');
        this.db.exec(`ALTER TABLE deletion_manifest ADD COLUMN user_id TEXT`);
      }
    } catch (error) {
      console.warn('Migration check for deletion_manifest table:', error.message);
    }

    // Deleted files tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        original_path TEXT NOT NULL,
        trash_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT,
        size INTEGER,
        is_directory INTEGER DEFAULT 0,
        deleted_at INTEGER,
        restored INTEGER DEFAULT 0,
        restored_at INTEGER,
        restored_path TEXT,
        permanently_deleted INTEGER DEFAULT 0,
        permanently_deleted_at INTEGER
      )
    `);
    
    // Add user_id column to deleted_files if it doesn't exist
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(deleted_files)");
      let hasUserId = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'user_id') {
          hasUserId = true;
          break;
        }
      }
      checkStmt.free();
      
      if (!hasUserId) {
        console.log('Migrating deleted_files table: adding user_id column');
        this.db.exec(`ALTER TABLE deleted_files ADD COLUMN user_id TEXT`);
      }
    } catch (error) {
      console.warn('Migration check for deleted_files table:', error.message);
    }

    // Duplicate files scans table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS duplicate_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        total_scanned INTEGER,
        duplicate_groups INTEGER,
        total_duplicates INTEGER,
        wasted_space INTEGER,
        scan_results TEXT,
        scanned_at INTEGER
      )
    `);
    
    // Add user_id column to duplicate_scans if it doesn't exist
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(duplicate_scans)");
      let hasUserId = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'user_id') {
          hasUserId = true;
          break;
        }
      }
      checkStmt.free();
      
      if (!hasUserId) {
        console.log('Migrating duplicate_scans table: adding user_id column');
        this.db.exec(`ALTER TABLE duplicate_scans ADD COLUMN user_id TEXT`);
      }
    } catch (error) {
      console.warn('Migration check for duplicate_scans table:', error.message);
    }

    // Create indexes for better performance
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_user_email ON user(email)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_backups_user_id ON backups(user_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_deleted_files_date ON deleted_files(deleted_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_deleted_files_type ON deleted_files(file_type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_deleted_files_user_id ON deleted_files(user_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_duplicate_scans_date ON duplicate_scans(scanned_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_duplicate_scans_user_id ON duplicate_scans(user_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_deletion_manifest_user_id ON deletion_manifest(user_id)`);
    
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

    // Battery App Usage History Table - stores per-app battery usage metrics
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_usage_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        app_name TEXT NOT NULL,
        app_command TEXT,
        pid INTEGER,
        session_id TEXT,
        cpu_percent REAL DEFAULT 0,
        memory_percent REAL DEFAULT 0,
        battery_impact REAL DEFAULT 0,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        date_key TEXT NOT NULL
      )
    `);
    
    // Add user_id column to app_usage_history if it doesn't exist
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(app_usage_history)");
      let hasUserId = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'user_id') {
          hasUserId = true;
          break;
        }
      }
      checkStmt.free();
      
      if (!hasUserId) {
        console.log('Migrating app_usage_history table: adding user_id column');
        this.db.exec(`ALTER TABLE app_usage_history ADD COLUMN user_id TEXT`);
      }
    } catch (error) {
      console.warn('Migration check for app_usage_history table:', error.message);
    }
    
    // Battery App Usage Sessions - tracks when apps start/stop
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_usage_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        session_id TEXT UNIQUE NOT NULL,
        app_name TEXT NOT NULL,
        app_command TEXT,
        pid INTEGER,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        total_cpu REAL DEFAULT 0,
        total_memory REAL DEFAULT 0,
        total_battery_impact REAL DEFAULT 0,
        samples_count INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
      )
    `);
    
    // Add user_id column to app_usage_sessions if it doesn't exist
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(app_usage_sessions)");
      let hasUserId = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'user_id') {
          hasUserId = true;
          break;
        }
      }
      checkStmt.free();
      
      if (!hasUserId) {
        console.log('Migrating app_usage_sessions table: adding user_id column');
        this.db.exec(`ALTER TABLE app_usage_sessions ADD COLUMN user_id TEXT`);
      }
    } catch (error) {
      console.warn('Migration check for app_usage_sessions table:', error.message);
    }

    // Create indexes for better query performance
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_app_usage_history_timestamp ON app_usage_history(timestamp)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_app_usage_history_date_key ON app_usage_history(date_key)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_app_usage_history_app_name ON app_usage_history(app_name)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_app_usage_history_user_id ON app_usage_history(user_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_session_id ON app_usage_sessions(session_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_app_name ON app_usage_sessions(app_name)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_start_time ON app_usage_sessions(start_time)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_is_active ON app_usage_sessions(is_active)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_user_id ON app_usage_sessions(user_id)`);

    // Create conversions table for file conversion tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        input_path TEXT NOT NULL,
        output_path TEXT NOT NULL,
        input_format TEXT NOT NULL,
        output_format TEXT NOT NULL,
        input_size INTEGER,
        output_size INTEGER,
        hash_before TEXT,
        hash_after TEXT,
        encrypted INTEGER DEFAULT 0,
        compressed INTEGER DEFAULT 0,
        duration INTEGER,
        status TEXT NOT NULL,
        error TEXT,
        timestamp TEXT NOT NULL
      )
    `);
    
    // Add user_id column to conversions if it doesn't exist
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(conversions)");
      let hasUserId = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'user_id') {
          hasUserId = true;
          break;
        }
      }
      checkStmt.free();
      
      if (!hasUserId) {
        console.log('Migrating conversions table: adding user_id column');
        this.db.exec(`ALTER TABLE conversions ADD COLUMN user_id TEXT`);
      }
    } catch (error) {
      console.warn('Migration check for conversions table:', error.message);
    }
    
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conversions_timestamp ON conversions(timestamp DESC)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conversions_status ON conversions(status)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conversions_user_id ON conversions(user_id)`);
    
    // Create app_settings table for persistent configuration
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Create verification_tokens table for QR-based verification
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verification_tokens (
        token_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        resource_name TEXT,
        system_id TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER,
        ttl INTEGER,
        one_time_use INTEGER DEFAULT 0,
        used INTEGER DEFAULT 0,
        used_at INTEGER,
        metadata TEXT,
        signature TEXT NOT NULL,
        file_path TEXT,
        file_hash TEXT
      )
    `);
    
    // Migrate existing verification_tokens table
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(verification_tokens)");
      let hasFilePath = false;
      let hasFileHash = false;
      let hasTTL = false;
      let expiresAtNotNull = false;
      
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'file_path') hasFilePath = true;
        if (row.name === 'file_hash') hasFileHash = true;
        if (row.name === 'ttl') hasTTL = true;
        if (row.name === 'expires_at' && row.notnull === 1) {
          expiresAtNotNull = true;
        }
      }
      checkStmt.free();
      
      // FIX: If expires_at has NOT NULL constraint, we need to migrate the table
      if (expiresAtNotNull) {
        console.log('MIGRATING: Removing NOT NULL constraint from expires_at column...');
        
        // Check if there are any existing tokens
        let tokenCount = 0;
        try {
          const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM verification_tokens');
          if (countStmt.step()) {
            tokenCount = countStmt.getAsObject().count;
          }
          countStmt.free();
          console.log(`Found ${tokenCount} existing tokens in database`);
        } catch (e) {
          console.log('Could not count tokens:', e.message);
        }
        
        // If there are existing tokens that may not have signature, delete them
        // (They're likely expired or invalid anyway since they're from old schema)
        if (tokenCount > 0) {
          console.log('Deleting old tokens before migration (old schema incompatible)...');
          this.db.exec('DELETE FROM verification_tokens');
        }
        
        // Drop any leftover migration table from previous failed attempts
        try {
          this.db.exec('DROP TABLE IF EXISTS verification_tokens_new');
        } catch (e) {
          console.log('No leftover migration table to clean up');
        }
        
        // Now we can safely recreate the table
        // 1. Create new table with correct schema
        this.db.exec(`
          CREATE TABLE verification_tokens_new (
            token_id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            resource_name TEXT,
            system_id TEXT NOT NULL,
            issued_at INTEGER NOT NULL,
            expires_at INTEGER,
            ttl INTEGER,
            one_time_use INTEGER DEFAULT 0,
            used INTEGER DEFAULT 0,
            used_at INTEGER,
            metadata TEXT,
            signature TEXT NOT NULL,
            file_path TEXT,
            file_hash TEXT
          )
        `);
        
        // 2. Drop old table
        this.db.exec('DROP TABLE verification_tokens');
        
        // 3. Rename new table to original name
        this.db.exec('ALTER TABLE verification_tokens_new RENAME TO verification_tokens');
        
        console.log('✓ Migration complete: expires_at now allows NULL values');
        
        // Save immediately after migration
        this.saveDatabaseImmediate();
      }
      
      if (!hasFilePath) {
        console.log('Adding file_path column to verification_tokens table...');
        this.db.exec('ALTER TABLE verification_tokens ADD COLUMN file_path TEXT');
      }
      if (!hasFileHash) {
        console.log('Adding file_hash column to verification_tokens table...');
        this.db.exec('ALTER TABLE verification_tokens ADD COLUMN file_hash TEXT');
      }
      if (!hasTTL) {
        console.log('Adding ttl column to verification_tokens table...');
        this.db.exec('ALTER TABLE verification_tokens ADD COLUMN ttl INTEGER');
      }
    } catch (error) {
      console.warn('Migration check for verification_tokens table:', error.message);
    }
    
    // Add user_id column to verification_tokens if it doesn't exist
    try {
      const checkStmt = this.db.prepare("PRAGMA table_info(verification_tokens)");
      let hasUserId = false;
      while (checkStmt.step()) {
        const row = checkStmt.getAsObject();
        if (row.name === 'user_id') {
          hasUserId = true;
          break;
        }
      }
      checkStmt.free();
      
      if (!hasUserId) {
        console.log('Migrating verification_tokens table: adding user_id column');
        this.db.exec(`ALTER TABLE verification_tokens ADD COLUMN user_id TEXT`);
      }
    } catch (error) {
      console.warn('Migration check for verification_tokens user_id:', error.message);
    }
    
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_verification_tokens_resource ON verification_tokens(resource_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_verification_tokens_type ON verification_tokens(type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_verification_tokens_expires ON verification_tokens(expires_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_verification_tokens_user_id ON verification_tokens(user_id)`);
    
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
  /**
   * COMPLETE USER DATA DELETION
   * Removes ALL traces of the user from the database
   * This ensures complete data isolation and privacy
   */
  deleteUserData(uid, options = {}) {
    try {
      console.log(`🗑️ COMPLETE DATA DELETION for UID: ${uid}`);
      
      let deletedCount = 0;
      let stmt;
      
      // 1. Delete from firebase_users_cache
      stmt = this.db.prepare('DELETE FROM firebase_users_cache WHERE uid = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted from firebase_users_cache');
      deletedCount++;
      
      // 2. Delete from verification_codes
      stmt = this.db.prepare('DELETE FROM verification_codes WHERE uid = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted from verification_codes');
      deletedCount++;
      
      // 3. Delete from local user table (if exists)
      const email = uid.startsWith('local_') ? this.getUserByLocalUid(uid)?.email : null;
      if (email) {
        stmt = this.db.prepare('DELETE FROM user WHERE email = ?');
        stmt.bind([email]);
        stmt.step();
        stmt.free();
        console.log('  ✓ Deleted from user table');
        deletedCount++;
      }
      
      // 4. DELETE ALL USER LOGS - complete removal
      stmt = this.db.prepare('DELETE FROM logs WHERE user_id = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ DELETED ALL user logs');
      deletedCount++;
      
      // 5. Delete user-specific settings
      stmt = this.db.prepare('DELETE FROM settings WHERE user_id = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted user settings');
      deletedCount++;
      
      // 6. Delete user's backups
      stmt = this.db.prepare('DELETE FROM backups WHERE user_id = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted user backups');
      deletedCount++;
      
      // 7. Delete user's verification tokens
      stmt = this.db.prepare('DELETE FROM verification_tokens WHERE user_id = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted user verification tokens');
      deletedCount++;
      
      // 8. Delete user's deleted files records
      stmt = this.db.prepare('DELETE FROM deleted_files WHERE user_id = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted user deleted files records');
      deletedCount++;
      
      // 9. Delete user's duplicate scan results
      stmt = this.db.prepare('DELETE FROM duplicate_scans WHERE user_id = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted user duplicate scan results');
      deletedCount++;
      
      // 10. Delete user's conversions
      stmt = this.db.prepare('DELETE FROM conversions WHERE user_id = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted user conversions');
      deletedCount++;
      
      // 11. Delete user's quarantine items (if table exists)
      try {
        stmt = this.db.prepare('DELETE FROM quarantine WHERE user_id = ?');
        stmt.bind([uid]);
        stmt.step();
        stmt.free();
        console.log('  ✓ Deleted user quarantine items');
        deletedCount++;
      } catch (e) {
        if (!e.message.includes('no such table')) throw e;
      }
      
      // 12. Delete user's app usage history
      stmt = this.db.prepare('DELETE FROM app_usage_history WHERE user_id = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted user app usage history');
      deletedCount++;
      
      // 13. Delete user's app usage sessions
      stmt = this.db.prepare('DELETE FROM app_usage_sessions WHERE user_id = ?');
      stmt.bind([uid]);
      stmt.step();
      stmt.free();
      console.log('  ✓ Deleted user app usage sessions');
      deletedCount++;
      
      this.saveDatabase();
      
      console.log(`🎯 COMPLETE DELETION SUCCESS: Removed ${deletedCount} data categories for user ${uid}`);
      
      return { 
        success: true, 
        message: 'All user data completely deleted',
        deletedCount,
        uid
      };
    } catch (error) {
      console.error('❌ Error deleting user data:', error);
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
   * Settings are now user-specific for proper data isolation
   */
  getSetting(key, userId = null) {
    let query = 'SELECT value FROM settings WHERE key = ?';
    const params = [key];
    
    // USER ISOLATION: Get setting for specific user or global (NULL)
    if (userId) {
      query += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(userId);
      query += ' ORDER BY user_id DESC LIMIT 1'; // Prioritize user-specific over global
    } else {
      query += ' AND user_id IS NULL'; // Only global settings when not logged in
    }
    
    const stmt = this.db.prepare(query);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row.value;
    }
    stmt.free();
    return null;
  }

  setSetting(key, value, userId = null) {
    // USER ISOLATION: Check if user-specific setting exists
    let selectQuery = 'SELECT id FROM settings WHERE key = ?';
    const selectParams = [key];
    
    if (userId) {
      selectQuery += ' AND user_id = ?';
      selectParams.push(userId);
    } else {
      selectQuery += ' AND user_id IS NULL';
    }
    
    const selectStmt = this.db.prepare(selectQuery);
    selectStmt.bind(selectParams);
    const exists = selectStmt.step();
    const existingId = exists ? selectStmt.getAsObject().id : null;
    selectStmt.free();

    if (exists && existingId) {
      // Update existing setting
      const updateStmt = this.db.prepare(
        'UPDATE settings SET value = ?, updated_at = strftime("%s", "now") WHERE id = ?'
      );
      updateStmt.bind([value, existingId]);
      updateStmt.step();
      updateStmt.free();
    } else {
      // Insert new setting
      const insertStmt = this.db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)');
      insertStmt.bind([userId, key, value]);
      insertStmt.step();
      insertStmt.free();
    }
    
    this.saveDatabase();
    return { success: true };
  }

  /**
   * Add log entry - REQUIRES user_id for complete data isolation
   * Logs without a user_id will be REJECTED to ensure complete user data isolation
   * Each user must have their own isolated logs from the moment they create their account
   */
  addLog(type, message, metadata = null, level = 'info', userId = null) {
    // STRICT ENFORCEMENT: Reject logs without user_id
    if (!userId) {
      // Silently skip - don't log errors to avoid infinite loops
      // This ensures no "orphan" logs exist in the database
      return { success: false, reason: 'No user_id provided - log rejected for data isolation' };
    }
    
    const stmt = this.db.prepare(
      'INSERT INTO logs (type, level, message, metadata, user_id) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.bind([type, level, message, metadata ? JSON.stringify(metadata) : null, userId]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  /**
   * Verification Token operations
   */
  addVerificationToken(tokenId, type, resourceId, resourceName, systemId, issuedAt, expiresAt, ttl, oneTimeUse, metadata, signature, filePath = null, fileHash = null, userId = null) {
    let stmt = null;
    try {
      console.log('[Database] Adding verification token with RAW inputs:', {
        tokenId: typeof tokenId + ' = ' + tokenId,
        type: typeof type + ' = ' + type,
        resourceId: typeof resourceId + ' = ' + resourceId,
        expiresAt: typeof expiresAt + ' = ' + expiresAt,
        ttl: typeof ttl + ' = ' + ttl,
        isPermanent: ttl === null,
        expiresAtIsNull: expiresAt === null,
        oneTimeUse: typeof oneTimeUse + ' = ' + oneTimeUse,
        userId: userId
      });

      // Ensure database is initialized
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      // Check table schema first to ensure it matches expectations
      try {
        const schemaStmt = this.db.prepare("PRAGMA table_info(verification_tokens)");
        const columns = [];
        while (schemaStmt.step()) {
          const col = schemaStmt.getAsObject();
          columns.push(`${col.name} (${col.type}${col.notnull ? ' NOT NULL' : ''})`);
        }
        schemaStmt.free();
        console.log('[Database] Table schema:', columns.join(', '));
      } catch (schemaError) {
        console.error('[Database] Could not read schema:', schemaError.message);
      }

      // Coerce and sanitize bind parameters to avoid undefined values
      const issuedAtNum = issuedAt ? Number(issuedAt) : Math.floor(Date.now());
      const expiresAtNum = (expiresAt === null || expiresAt === undefined) ? null : Number(expiresAt);
      const ttlNum = (ttl === null || ttl === undefined) ? null : Number(ttl);
      const oneTimeFlag = oneTimeUse ? 1 : 0;
      const metadataStr = metadata ? JSON.stringify(metadata) : null;

      const bindParams = [
        tokenId,                              // 1: token_id
        type,                                 // 2: type
        resourceId,                           // 3: resource_id
        resourceName || resourceId,           // 4: resource_name
        systemId,                             // 5: system_id
        issuedAtNum,                          // 6: issued_at
        expiresAtNum,                         // 7: expires_at (can be NULL)
        ttlNum,                               // 8: ttl (can be NULL)
        oneTimeFlag,                          // 9: one_time_use
        0,                                    // 10: used (always 0 for new tokens)
        metadataStr,                          // 11: metadata
        signature,                            // 12: signature
        filePath || null,                     // 13: file_path (can be NULL)
        fileHash || null,                     // 14: file_hash (can be NULL)
        userId || null                        // 15: user_id (can be NULL)
      ];

      console.log('[Database] Bind parameters TYPES:', bindParams.map((p, i) => `${i + 1}: ${p === null ? 'NULL' : typeof p + ' = ' + p}`));

      stmt = this.db.prepare(
        `INSERT INTO verification_tokens 
         (token_id, type, resource_id, resource_name, system_id, issued_at, expires_at, ttl, one_time_use, used, metadata, signature, file_path, file_hash, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // Replace any undefined with null to satisfy SQL.js binding
      const sanitizedParams = bindParams.map(p => (p === undefined ? null : p));

      console.log('[Database] About to bind sanitized params');
      try {
        stmt.bind(sanitizedParams);
        console.log('[Database] Bind successful');
      } catch (bindError) {
        console.error('[Database] BIND FAILED:', bindError.message);
        throw bindError;
      }

      console.log('[Database] About to execute statement');
      try {
        // Execute the statement
        const stepResult = stmt.step();
        console.log('[Database] Step result:', stepResult);
      } catch (stepError) {
        console.error('[Database] STEP FAILED:', stepError.message);
        console.error('[Database] This usually means a constraint violation or data type mismatch');
        throw stepError;
      }

      // Free statement before saving
      stmt.free();
      stmt = null;

      console.log('[Database] About to save database');
      // Force immediate save for verification tokens (critical data)
      this.saveDatabaseImmediate();

      console.log('[Database] Token added and saved successfully');
      return true;
    } catch (error) {
      console.error('[Database] CRITICAL ERROR adding verification token:', error);
      console.error('[Database] Error name:', error.name);
      console.error('[Database] Error message:', error.message);
      console.error('[Database] Error stack:', error.stack);
      console.error('[Database] Input parameters that caused error:', {
        tokenId, type, resourceId, resourceName, systemId, 
        issuedAt, expiresAt, ttl, oneTimeUse, metadata, signature, filePath, fileHash
      });
      
      // Clean up statement if error occurred
      if (stmt) {
        try {
          stmt.free();
        } catch (e) {
          console.error('[Database] Error freeing statement:', e);
        }
      }
      
      return false;
    }
  }

  getVerificationToken(tokenId) {
    try {
      const stmt = this.db.prepare(
        'SELECT * FROM verification_tokens WHERE token_id = ?'
      );
      stmt.bind([tokenId]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return null;
    } catch (error) {
      console.error('Failed to get verification token:', error);
      return null;
    }
  }

  markTokenAsUsed(tokenId) {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(
        'UPDATE verification_tokens SET used = 1, used_at = ? WHERE token_id = ?'
      );
      stmt.bind([now, tokenId]);
      stmt.step();
      stmt.free();
      this.saveDatabase();
      return true;
    } catch (error) {
      console.error('Failed to mark token as used:', error);
      return false;
    }
  }

  getAllVerificationTokens(filters = {}) {
    try {
      let query = 'SELECT * FROM verification_tokens WHERE 1=1';
      const params = [];

      // Filter by userId - ONLY show user's tokens (no system tokens for verification)
      if (filters.userId) {
        query += ' AND user_id = ?';
        params.push(filters.userId);
      } else {
        // If no userId provided, don't return any tokens (security)
        query += ' AND 0 = 1';
      }

      if (filters.type) {
        query += ' AND type = ?';
        params.push(filters.type);
      }

      if (filters.resourceId) {
        query += ' AND resource_id = ?';
        params.push(filters.resourceId);
      }

      if (filters.used !== undefined) {
        query += ' AND used = ?';
        params.push(filters.used ? 1 : 0);
      }

      query += ' ORDER BY issued_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      const stmt = this.db.prepare(query);
      stmt.bind(params);

      const tokens = [];
      while (stmt.step()) {
        tokens.push(stmt.getAsObject());
      }
      stmt.free();

      return tokens;
    } catch (error) {
      console.error('Failed to get verification tokens:', error);
      return [];
    }
  }

  deleteExpiredTokens() {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(
        'DELETE FROM verification_tokens WHERE expires_at IS NOT NULL AND expires_at < ?'
      );
      stmt.bind([now]);
      stmt.step();
      stmt.free();
      this.saveDatabase();
      return true;
    } catch (error) {
      console.error('Failed to delete expired tokens:', error);
      return false;
    }
  }

  /**
   * Delete a specific verification token by ID
   * @param {string} tokenId - Token ID to delete
   * @returns {boolean} Success status
   */
  deleteVerificationToken(tokenId) {
    try {
      const stmt = this.db.prepare(
        'DELETE FROM verification_tokens WHERE token_id = ?'
      );
      stmt.bind([tokenId]);
      stmt.step();
      stmt.free();
      this.saveDatabase();
      console.log(`[Database] Deleted verification token: ${tokenId}`);
      return true;
    } catch (error) {
      console.error('Failed to delete verification token:', error);
      return false;
    }
  }

  /**
   * Get logs with optional type filtering
   * USER ISOLATION: Returns ONLY user's logs (no system logs to prevent data leakage)
   */
  getLogs(type = null, limit = 100, userId = null) {
    let query = 'SELECT * FROM logs WHERE 1=1';
    const params = [];

    // USER ISOLATION - ONLY show user's logs
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    } else {
      // If no userId, return empty (security)
      query += ' AND 0 = 1';
    }

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

    // STRICT USER ISOLATION: Show ONLY the user's own logs
    // No sharing of logs between users - complete data isolation
    if (filters.userId) {
      query += ' AND user_id = ?';
      params.push(filters.userId);
    } else {
      // No user logged in - return empty results for security
      query += ' AND 1 = 0';
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
   * Get unique log types/modules for CURRENT USER ONLY
   * STRICT USER ISOLATION: Only returns log types from the user's own logs
   * Each user has their own isolated log types based on their activities
   */
  getLogTypes(userId = null) {
    if (!userId) {
      // No user logged in - return empty array
      return [];
    }
    
    // Return ONLY the user's log types for strict isolation
    const query = 'SELECT DISTINCT type FROM logs WHERE user_id = ? ORDER BY type';
    
    const stmt = this.db.prepare(query);
    stmt.bind([userId]);
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
   * STRICT USER ISOLATION: Only exports the user's own logs
   * @param {Object} filters - Same as getLogsFiltered
   */
  exportLogs(filters = {}) {
    let query = 'SELECT * FROM logs WHERE 1=1';
    const params = [];

    // STRICT USER ISOLATION: Only export user's own logs
    if (filters.userId) {
      query += ' AND user_id = ?';
      params.push(filters.userId);
    } else {
      // No user logged in - return empty for security
      query += ' AND 1 = 0';
    }

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
  
  /**
   * Add a new backup record to database
   * @param {Object} data - Backup data (name, source_path, backup_path, size, file_count, encrypted, manifest)
   * @param {String} userId - User ID who created the backup
   */
  addBackup(data, userId = null) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO backups (user_id, name, source_path, backup_path, size, file_count, encrypted, manifest)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.bind([
        userId,
        data.name,
        data.source_path,
        data.backup_path,
        data.size || 0,
        data.file_count || 0,
        data.encrypted || 0,
        data.manifest || null
      ]);
      
      stmt.step();
      const lastId = this.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
      stmt.free();
      this.saveDatabase();
      
      return { success: true, id: lastId };
    } catch (error) {
      console.error('Failed to add backup:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get backups with filtering and pagination
   * @param {Object} filters - Filter options
   * @param {Number} limit - Maximum number of results
   * @param {String} userId - User ID to filter by
   */
  getBackups(filters = {}, limit = 50, userId = null) {
    try {
      let query = 'SELECT * FROM backups';
      const params = [];
      const conditions = [];
      
      // USER ISOLATION: Only show user's backups
      if (userId) {
        conditions.push('user_id = ?');
        params.push(userId);
      } else {
        // Not logged in - show only NULL user_id (legacy data)
        conditions.push('user_id IS NULL');
      }
      
      // Add name filter if provided
      if (filters.name) {
        conditions.push('name LIKE ?');
        params.push(`%${filters.name}%`);
      }
      
      // Add encrypted filter if provided
      if (filters.encrypted !== undefined) {
        conditions.push('encrypted = ?');
        params.push(filters.encrypted ? 1 : 0);
      }
      
      // Add WHERE clause if there are conditions
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      
      const stmt = this.db.prepare(query);
      stmt.bind(params);
      
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      
      return results;
    } catch (error) {
      console.error('Failed to get backups:', error);
      return [];
    }
  }

  /**
   * Alias for addBackup for backward compatibility
   */
  createBackup(data, userId = null) {
    return this.addBackup(data, userId);
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

  deleteBackup(id) {
    const stmt = this.db.prepare('DELETE FROM backups WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  /**
   * Deletion manifest operations
   */
  addToQuarantine(originalPath, quarantinePath, size, userId = null) {
    const stmt = this.db.prepare(
      'INSERT INTO deletion_manifest (user_id, original_path, quarantine_path, size) VALUES (?, ?, ?, ?)'
    );
    stmt.bind([userId, originalPath, quarantinePath, size]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  getQuarantinedFiles(limit = 100, userId = null) {
    let query = 'SELECT * FROM deletion_manifest WHERE restored = 0';
    const params = [];
    
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    
    query += ' ORDER BY deleted_at DESC LIMIT ?';
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

  markAsRestored(id) {
    const stmt = this.db.prepare('UPDATE deletion_manifest SET restored = 1 WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  /**
   * Conversion operations
   */
  logConversion(data, userId = null) {
    const stmt = this.db.prepare(`
      INSERT INTO conversions (
        user_id, input_path, output_path, input_format, output_format, 
        input_size, output_size, hash_before, hash_after, 
        encrypted, compressed, duration, status, error, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.bind([
      userId,
      data.input_path,
      data.output_path,
      data.input_format,
      data.output_format,
      data.input_size || null,
      data.output_size || null,
      data.hash_before || null,
      data.hash_after || null,
      data.encrypted ? 1 : 0,
      data.compressed ? 1 : 0,
      data.duration || null,
      data.status,
      data.error || null,
      data.timestamp
    ]);
    
    stmt.step();
    const lastId = this.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    stmt.free();
    this.saveDatabase();
    return { success: true, id: lastId };
  }

  getConversions(limit = 50, userId = null) {
    let query = 'SELECT * FROM conversions';
    const params = [];
    
    if (userId) {
      query += ' WHERE user_id = ?';
      params.push(userId);
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

  getConversionById(id) {
    const stmt = this.db.prepare('SELECT * FROM conversions WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  getConversionStats(userId = null) {
    let query = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(input_size) as total_input_size,
        SUM(output_size) as total_output_size
      FROM conversions
    `;
    
    const params = [];
    if (userId) {
      query += ' WHERE user_id = ?';
      params.push(userId);
    }
    
    const stmt = this.db.prepare(query);
    stmt.bind(params);
    
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return { total: 0, completed: 0, failed: 0, total_input_size: 0, total_output_size: 0 };
  }

  deleteConversion(id) {
    const stmt = this.db.prepare('DELETE FROM conversions WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    stmt.free();
    this.saveDatabase();
    return { success: true };
  }

  /**
   * Get all backups for resource selection
   * @returns {Array} List of backups with id, name, size, created_at
   */
  getBackupsForSelection(userId = null) {
    try {
      let query = 'SELECT id, name, source_path, backup_path, size, file_count, encrypted, created_at FROM backups';
      const params = [];
      
      if (userId) {
        query += ' WHERE user_id = ?';
        params.push(userId);
      }
      
      query += ' ORDER BY created_at DESC';
      
      const stmt = this.db.prepare(query);
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error('Failed to get backups for selection:', error);
      return [];
    }
  }

  /**
   * Get conversion history for resource selection
   * @param {String} userId - Optional user ID to filter conversions
   * @returns {Array} List of converted files
   */
  getConversionHistoryForSelection(userId = null) {
    try {
      let query = `SELECT id, input_path, output_path, input_format, output_format, 
         input_size, output_size, hash_after, timestamp, status 
         FROM conversions 
         WHERE status = 'completed'`;
      
      const params = [];
      if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
      }
      
      query += ' ORDER BY timestamp DESC LIMIT 100';
      
      const stmt = this.db.prepare(query);
      if (params.length > 0) {
        stmt.bind(params);
      }
      
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error('Failed to get conversion history:', error);
      return [];
    }
  }

  /**
   * Get diagnostic reports for resource selection
   * NOTE: Diagnostic reports are stored as logs. This fetches diagnostic-type logs.
   * @param {String} userId - Optional user ID to filter reports
   * @returns {Array} List of diagnostic reports
   */
  getDiagnosticReportsForSelection(userId = null) {
    try {
      let query = `SELECT id, type, message, metadata, timestamp 
         FROM logs 
         WHERE (type LIKE '%diagnostic%' OR type LIKE '%system%' OR type LIKE '%health%')`;
      
      const params = [];
      if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
      } else {
        // No userId - return empty
        query += ' AND 0 = 1';
      }
      
      query += ' ORDER BY timestamp DESC LIMIT 50';
      
      const stmt = this.db.prepare(query);
      if (params.length > 0) {
        stmt.bind(params);
      }
      
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error('Failed to get diagnostic reports:', error);
      return [];
    }
  }

  /**
   * Battery Usage History Methods
   */
  
  /**
   * Record app usage snapshot for battery tracking
   */
  recordAppUsage(appName, appCommand, pid, sessionId, cpuPercent, memoryPercent, batteryImpact, userId = null) {
    try {
      const now = Date.now();
      const dateKey = new Date(now).toISOString().split('T')[0]; // YYYY-MM-DD format
      
      const stmt = this.db.prepare(
        `INSERT INTO app_usage_history 
        (user_id, app_name, app_command, pid, session_id, cpu_percent, memory_percent, battery_impact, timestamp, date_key) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run([userId, appName, appCommand, pid, sessionId, cpuPercent, memoryPercent, batteryImpact, Math.floor(now / 1000), dateKey]);
      stmt.free();
      
      this.saveDatabase();
      return true;
    } catch (error) {
      console.error('Failed to record app usage:', error);
      return false;
    }
  }

  /**
   * Start a new app usage session
   */
  startAppSession(sessionId, appName, appCommand, pid, userId = null) {
    try {
      const now = Math.floor(Date.now() / 1000);
      
      const stmt = this.db.prepare(
        `INSERT INTO app_usage_sessions 
        (user_id, session_id, app_name, app_command, pid, start_time, is_active) 
        VALUES (?, ?, ?, ?, ?, ?, 1)`
      );
      stmt.run([userId, sessionId, appName, appCommand, pid, now]);
      stmt.free();
      
      this.saveDatabase();
      return true;
    } catch (error) {
      console.error('Failed to start app session:', error);
      return false;
    }
  }

  /**
   * Update app session with usage metrics
   */
  updateAppSession(sessionId, cpuDelta, memoryDelta, batteryImpactDelta) {
    try {
      const stmt = this.db.prepare(
        `UPDATE app_usage_sessions 
        SET total_cpu = total_cpu + ?, 
            total_memory = total_memory + ?, 
            total_battery_impact = total_battery_impact + ?,
            samples_count = samples_count + 1
        WHERE session_id = ? AND is_active = 1`
      );
      stmt.run([cpuDelta, memoryDelta, batteryImpactDelta, sessionId]);
      stmt.free();
      
      this.saveDatabase();
      return true;
    } catch (error) {
      console.error('Failed to update app session:', error);
      return false;
    }
  }

  /**
   * End an app usage session
   */
  endAppSession(sessionId) {
    try {
      const now = Math.floor(Date.now() / 1000);
      
      const stmt = this.db.prepare(
        `UPDATE app_usage_sessions 
        SET end_time = ?, is_active = 0 
        WHERE session_id = ? AND is_active = 1`
      );
      stmt.run([now, sessionId]);
      stmt.free();
      
      this.saveDatabase();
      return true;
    } catch (error) {
      console.error('Failed to end app session:', error);
      return false;
    }
  }

  /**
   * Get historical app usage for a timeframe
   * @param {string} timeframe - 'today', 'yesterday', 'last_week', 'last_month'
   * @param {string} userId - User ID for filtering
   * @returns {Array} App usage data grouped by app
   */
  getHistoricalAppUsage(timeframe, userId = null) {
    try {
      const now = new Date();
      let startTime, endTime;
      
      switch (timeframe) {
        case 'today':
          // TODAY: From midnight today to RIGHT NOW
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(todayStart.getTime() / 1000);
          endTime = Math.floor(Date.now() / 1000);
          console.log(`[Timeframe: TODAY] ${todayStart.toLocaleString()} to NOW`);
          break;
          
        case 'yesterday':
          // YESTERDAY: From midnight yesterday to midnight today (EXCLUDES today)
          const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
          const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(yesterdayStart.getTime() / 1000);
          endTime = Math.floor(yesterdayEnd.getTime() / 1000);
          console.log(`[Timeframe: YESTERDAY] ${yesterdayStart.toLocaleString()} to ${yesterdayEnd.toLocaleString()}`);
          break;
          
        case 'last_week':
          // LAST WEEK: From 7 days ago midnight to YESTERDAY END (EXCLUDES today)
          // This shows the past 7 days NOT including current day
          const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
          const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0); // Midnight today
          startTime = Math.floor(weekStart.getTime() / 1000);
          endTime = Math.floor(weekEnd.getTime() / 1000);
          console.log(`[Timeframe: LAST WEEK] ${weekStart.toLocaleString()} to ${weekEnd.toLocaleString()} (7 days, excludes today)`);
          break;
          
        case 'last_month':
          // LAST MONTH: From 30 days ago midnight to YESTERDAY END (EXCLUDES today)
          // This shows the past 30 days NOT including current day
          const monthStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);
          const monthEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0); // Midnight today
          startTime = Math.floor(monthStart.getTime() / 1000);
          endTime = Math.floor(monthEnd.getTime() / 1000);
          console.log(`[Timeframe: LAST MONTH] ${monthStart.toLocaleString()} to ${monthEnd.toLocaleString()} (30 days, excludes today)`);
          break;
          
        default:
          // Default to today
          const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(defaultStart.getTime() / 1000);
          endTime = Math.floor(Date.now() / 1000);
          console.log(`[Timeframe: DEFAULT/TODAY] ${defaultStart.toLocaleString()} to NOW`);
      }
      
      return this.getHistoricalAppUsageRange(startTime, endTime, userId);
    } catch (error) {
      console.error('Failed to get historical app usage:', error);
      return [];
    }
  }

  /**
   * Get historical app usage for a specific time range
   */
  getHistoricalAppUsageRange(startTime, endTime, userId = null) {
    try {
      const startDate = new Date(startTime * 1000);
      const endDate = new Date(endTime * 1000);
      console.log(`[DB Query] getHistoricalAppUsageRange: ${startDate.toLocaleString()} to ${endDate.toLocaleString()}`);
      
      let query = `SELECT 
          app_name,
          app_command,
          COUNT(*) as samples,
          AVG(cpu_percent) as avg_cpu,
          AVG(memory_percent) as avg_memory,
          SUM(battery_impact) as total_battery_impact,
          MAX(battery_impact) as peak_battery_impact
        FROM app_usage_history
        WHERE timestamp >= ? AND timestamp < ?`;
      
      const params = [startTime, endTime];
      
      // USER ISOLATION: Show ONLY user's data (no shared data)
      if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
      } else {
        // Not logged in - return empty
        query += ' AND 0 = 1';
      }
      
      query += ` GROUP BY app_name
        ORDER BY total_battery_impact DESC`;
      // No LIMIT - return all tracked apps for accurate display
      
      const stmt = this.db.prepare(query);
      stmt.bind(params);
      
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      
      console.log(`[DB Query] Found ${results.length} apps for ${new Date(startTime * 1000).toLocaleString()} to ${new Date(endTime * 1000).toLocaleString()}`);
      
      // Debug: Log total rows and date range in table
      if (results.length === 0) {
        const countStmt = this.db.prepare('SELECT COUNT(*) as total FROM app_usage_history');
        if (countStmt.step()) {
          const total = countStmt.getAsObject().total;
          console.log(`[DB Query] ⚠️ No apps in range, but database has ${total} total records`);
        }
        countStmt.free();
        
        // Check date range of existing data
        const rangeStmt = this.db.prepare('SELECT MIN(timestamp) as min_time, MAX(timestamp) as max_time FROM app_usage_history');
        if (rangeStmt.step()) {
          const range = rangeStmt.getAsObject();
          if (range.min_time && range.max_time) {
            console.log(`[DB Query] Database data range: ${new Date(range.min_time * 1000).toLocaleString()} to ${new Date(range.max_time * 1000).toLocaleString()}`);
          }
        }
        rangeStmt.free();
      } else if (results.length > 0) {
        // Log first few results for debugging
        console.log(`[DB Query] Top 3 apps: ${results.slice(0, 3).map(r => `${r.app_name}(impact:${Math.round(r.total_battery_impact)})`).join(', ')}`);
      }
      
      return results;
    } catch (error) {
      console.error('Failed to get historical app usage range:', error);
      return [];
    }
  }

  /**
   * Get total battery impact for a timeframe (for percentage calculations)
   * @param {string} timeframe - 'today', 'yesterday', 'last_week', 'last_month'
   * @param {number} userId - Optional user ID for filtering
   */
  getTotalBatteryImpact(timeframe, userId = null) {
    try {
      const now = new Date();
      let startTime, endTime;
      
      switch (timeframe) {
        case 'today':
          // TODAY: From midnight today to RIGHT NOW
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(todayStart.getTime() / 1000);
          endTime = Math.floor(Date.now() / 1000);
          break;
          
        case 'yesterday':
          // YESTERDAY: From midnight yesterday to midnight today (EXCLUDES today)
          const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
          const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(yesterdayStart.getTime() / 1000);
          endTime = Math.floor(yesterdayEnd.getTime() / 1000);
          break;
          
        case 'last_week':
          // LAST WEEK: From 7 days ago to YESTERDAY END (EXCLUDES today)
          const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
          const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(weekStart.getTime() / 1000);
          endTime = Math.floor(weekEnd.getTime() / 1000);
          break;
          
        case 'last_month':
          // LAST MONTH: From 30 days ago to YESTERDAY END (EXCLUDES today)
          const monthStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);
          const monthEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(monthStart.getTime() / 1000);
          endTime = Math.floor(monthEnd.getTime() / 1000);
          break;
          
        default:
          // Default to today
          const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(defaultStart.getTime() / 1000);
          endTime = Math.floor(Date.now() / 1000);
      }
      
      return this.getTotalBatteryImpactRange(startTime, endTime, userId);
    } catch (error) {
      console.error('Failed to get total battery impact:', error);
      return 0;
    }
  }

  /**
   * Get total battery impact for a specific time range
   * @param {number} startTime - Start timestamp in seconds
   * @param {number} endTime - End timestamp in seconds
   * @param {number} userId - Optional user ID for filtering
   */
  getTotalBatteryImpactRange(startTime, endTime, userId = null) {
    try {
      let query = `SELECT SUM(battery_impact) as total 
        FROM app_usage_history 
        WHERE timestamp >= ? AND timestamp < ?`;
      
      const params = [startTime, endTime];
      
      // USER ISOLATION: Only count impact from user's own processes
      if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
      } else {
        // Not logged in - return 0
        query += ' AND 0 = 1';
      }
      
      const stmt = this.db.prepare(query);
      stmt.bind(params);
      
      let total = 0;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        total = row.total || 0;
      }
      stmt.free();
      
      return total;
    } catch (error) {
      console.error('Failed to get total battery impact range:', error);
      return 0;
    }
  }

  /**
   * Clean up old app usage data (older than 30 days)
   */
  cleanupOldAppUsageData() {
    try {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
      
      // Clean up history
      const stmtHistory = this.db.prepare(
        'DELETE FROM app_usage_history WHERE timestamp < ?'
      );
      stmtHistory.run([thirtyDaysAgo]);
      stmtHistory.free();
      
      // Clean up inactive sessions
      const stmtSessions = this.db.prepare(
        'DELETE FROM app_usage_sessions WHERE start_time < ? AND is_active = 0'
      );
      stmtSessions.run([thirtyDaysAgo]);
      stmtSessions.free();
      
      this.saveDatabase();
      console.log('Cleaned up app usage data older than 30 days');
      return true;
    } catch (error) {
      console.error('Failed to cleanup old app usage data:', error);
      return false;
    }
  }

  /**
   * Get active app sessions count (all timeframes)
   * @param {string} userId - Optional user ID for filtering
   */
  getActiveSessionsCount(userId = null) {
    try {
      let query = 'SELECT COUNT(*) as count FROM app_usage_sessions WHERE is_active = 1';
      const params = [];
      
      if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
      } else {
        // Not logged in - return 0
        query += ' AND 0 = 1';
      }
      
      const stmt = this.db.prepare(query);
      if (params.length > 0) {
        stmt.bind(params);
      }
      
      let count = 0;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        count = row.count || 0;
      }
      stmt.free();
      
      return count;
    } catch (error) {
      console.error('Failed to get active sessions count:', error);
      return 0;
    }
  }

  /**
   * Get session count for specific timeframe
   * @param {string} timeframe - 'today', 'yesterday', 'last_week', 'last_month'
   * @param {string} userId - Optional user ID for filtering
   * @returns {number} Count of sessions in timeframe
   */
  getActiveSessionsCountForTimeframe(timeframe, userId = null) {
    try {
      const now = new Date();
      let startTime, endTime;
      
      switch (timeframe) {
        case 'today':
          // TODAY: From midnight today to RIGHT NOW
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(todayStart.getTime() / 1000);
          endTime = Math.floor(Date.now() / 1000);
          break;
          
        case 'yesterday':
          // YESTERDAY: From midnight yesterday to midnight today (EXCLUDES today)
          const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
          const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(yesterdayStart.getTime() / 1000);
          endTime = Math.floor(yesterdayEnd.getTime() / 1000);
          break;
          
        case 'last_week':
          // LAST WEEK: From 7 days ago to YESTERDAY END (EXCLUDES today)
          const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
          const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(weekStart.getTime() / 1000);
          endTime = Math.floor(weekEnd.getTime() / 1000);
          break;
          
        case 'last_month':
          // LAST MONTH: From 30 days ago to YESTERDAY END (EXCLUDES today)
          const monthStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);
          const monthEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(monthStart.getTime() / 1000);
          endTime = Math.floor(monthEnd.getTime() / 1000);
          break;
          
        default:
          const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          startTime = Math.floor(defaultStart.getTime() / 1000);
          endTime = Math.floor(Date.now() / 1000);
      }
      
      let query = 'SELECT COUNT(DISTINCT session_id) as count FROM app_usage_sessions WHERE start_time >= ? AND start_time < ?';
      const params = [startTime, endTime];
      
      if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
      } else {
        // Not logged in - return 0
        query += ' AND 0 = 1';
      }
      
      const stmt = this.db.prepare(query);
      stmt.bind(params);
      
      let count = 0;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        count = row.count || 0;
      }
      stmt.free();
      
      return count;
    } catch (error) {
      console.error('Failed to get active sessions count for timeframe:', error);
      return 0;
    }
  }

  /**
   * Close database and cleanup
   */
  close() {
    if (this.db) {
      this.saveDatabaseImmediate();
      this.db.close();
      this.db = null;
    }
  }
}

// Export singleton instance
module.exports = new DatabaseService();
