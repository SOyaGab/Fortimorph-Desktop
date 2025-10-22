const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// For development, we'll use a simple JSON-based database since better-sqlite3 needs Python
class DatabaseService {
  constructor() {
    this.db = null;
    this.dbPath = null;
    this.data = {
      users: [],
      settings: [],
      logs: [],
      backups: [],
      deletion_manifest: []
    };
  }

  /**
   * Initialize database connection and create tables
   */
  initialize() {
    try {
      // Use JSON file for now (simpler, no Python required)
      this.dbPath = path.join(app.getPath('userData'), 'fortimorph-data.json');
      console.log('Initializing database at:', this.dbPath);
      
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Load existing data or create new
      if (fs.existsSync(this.dbPath)) {
        const fileData = fs.readFileSync(this.dbPath, 'utf8');
        this.data = JSON.parse(fileData);
        console.log('Loaded existing database with', this.data.users.length, 'users');
      } else {
        this.saveData();
        console.log('Created new database file');
      }

      console.log('Database initialized successfully at:', this.dbPath);
      return true;
    } catch (error) {
      console.error('Database initialization failed:', error);
      throw error;
    }
  }

  /**
   * Save data to file
   */
  saveData() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save data:', error);
    }
  }

  /**
   * Create tables (not needed for JSON, but kept for compatibility)
   */
  createTables() {
    // No-op for JSON storage
    return true;
  }



  /**
   * User CRUD operations
   */
  createUser(email, passwordHash) {
    try {
      const user = {
        id: this.data.users.length + 1,
        email,
        password_hash: passwordHash,
        verified: 0,
        verification_code: null,
        verification_expires: null,
        reset_code: null,
        reset_expires: null,
        created_at: Math.floor(Date.now() / 1000),
        last_login: null,
        login_attempts: 0,
        locked_until: 0
      };
      this.data.users.push(user);
      this.saveData();
      console.log('User created:', email);
      return { changes: 1, lastInsertRowid: user.id };
    } catch (error) {
      console.error('Create user error:', error);
      throw error;
    }
  }

  getUserByEmail(email) {
    return this.data.users.find(u => u.email === email);
  }

  updateUserVerification(email, verified) {
    const user = this.getUserByEmail(email);
    if (user) {
      user.verified = verified;
      user.verification_code = null;
      user.verification_expires = null;
      this.saveData();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  setVerificationCode(email, code, expiresAt) {
    const user = this.getUserByEmail(email);
    if (user) {
      user.verification_code = code;
      user.verification_expires = expiresAt;
      this.saveData();
      console.log('Verification code set for', email, ':', code);
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  setResetCode(email, code, expiresAt) {
    const user = this.getUserByEmail(email);
    if (user) {
      user.reset_code = code;
      user.reset_expires = expiresAt;
      this.saveData();
      console.log('Reset code set for', email, ':', code);
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  updatePassword(email, passwordHash) {
    const user = this.getUserByEmail(email);
    if (user) {
      user.password_hash = passwordHash;
      user.reset_code = null;
      user.reset_expires = null;
      this.saveData();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  updateLastLogin(email) {
    const now = Math.floor(Date.now() / 1000);
    const user = this.getUserByEmail(email);
    if (user) {
      user.last_login = now;
      user.login_attempts = 0;
      this.saveData();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  incrementLoginAttempts(email) {
    const user = this.getUserByEmail(email);
    if (user) {
      user.login_attempts += 1;
      this.saveData();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  lockAccount(email, lockUntil) {
    const user = this.getUserByEmail(email);
    if (user) {
      user.locked_until = lockUntil;
      this.saveData();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  resetLoginAttempts(email) {
    const user = this.getUserByEmail(email);
    if (user) {
      user.login_attempts = 0;
      user.locked_until = 0;
      this.saveData();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  /**
   * Settings CRUD operations
   */
  getSetting(key) {
    const setting = this.data.settings.find(s => s.key === key);
    return setting ? setting.value : null;
  }

  setSetting(key, value) {
    const existing = this.data.settings.find(s => s.key === key);
    if (existing) {
      existing.value = value;
      existing.updated_at = Math.floor(Date.now() / 1000);
    } else {
      this.data.settings.push({
        id: this.data.settings.length + 1,
        key,
        value,
        updated_at: Math.floor(Date.now() / 1000)
      });
    }
    this.saveData();
    return { changes: 1 };
  }

  /**
   * Logs operations
   */
  addLog(type, message, metadata = null) {
    this.data.logs.push({
      id: this.data.logs.length + 1,
      type,
      message,
      metadata: metadata ? JSON.stringify(metadata) : null,
      timestamp: Math.floor(Date.now() / 1000)
    });
    this.saveData();
    return { changes: 1 };
  }

  getLogs(type = null, limit = 100) {
    let logs = this.data.logs;
    if (type) {
      logs = logs.filter(l => l.type === type);
    }
    return logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Backup operations
   */
  createBackup(data) {
    const backup = {
      id: this.data.backups.length + 1,
      name: data.name,
      source_path: data.sourcePath,
      backup_path: data.backupPath,
      size: data.size,
      file_count: data.fileCount,
      encrypted: data.encrypted ? 1 : 0,
      manifest: JSON.stringify(data.manifest),
      created_at: Math.floor(Date.now() / 1000)
    };
    this.data.backups.push(backup);
    this.saveData();
    return { changes: 1, lastInsertRowid: backup.id };
  }

  getBackups(limit = 50) {
    return this.data.backups
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit);
  }

  getBackupById(id) {
    return this.data.backups.find(b => b.id === id);
  }

  /**
   * Deletion manifest operations
   */
  addToQuarantine(originalPath, quarantinePath, size) {
    const item = {
      id: this.data.deletion_manifest.length + 1,
      original_path: originalPath,
      quarantine_path: quarantinePath,
      size,
      deleted_at: Math.floor(Date.now() / 1000),
      restored: 0
    };
    this.data.deletion_manifest.push(item);
    this.saveData();
    return { changes: 1, lastInsertRowid: item.id };
  }

  getQuarantinedFiles(limit = 100) {
    return this.data.deletion_manifest
      .filter(d => d.restored === 0)
      .sort((a, b) => b.deleted_at - a.deleted_at)
      .slice(0, limit);
  }

  markAsRestored(id) {
    const item = this.data.deletion_manifest.find(d => d.id === id);
    if (item) {
      item.restored = 1;
      this.saveData();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  /**
   * Close database connection
   */
  close() {
    this.saveData();
    console.log('Database saved and closed');
  }
}

// Export singleton instance
module.exports = new DatabaseService();
