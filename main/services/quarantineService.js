const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Quarantine Service
 * Manages secure file quarantine with encryption, retry queue, and restoration
 */
class QuarantineService {
  constructor(database, logsService) {
    this.db = database;
    this.logsService = logsService;
    this.quarantineDir = path.join(app.getPath('userData'), 'quarantine');
    this.retryQueue = new Map(); // Map of file paths to retry metadata
    this.retryInterval = null;
    this.encryptionKey = null;
    this.maxRetries = 5;
    this.retryDelay = 60000; // 1 minute between retries
  }

  /**
   * Initialize quarantine service
   */
  async initialize() {
    try {
      // Ensure quarantine directory exists
      if (!fs.existsSync(this.quarantineDir)) {
        fs.mkdirSync(this.quarantineDir, { recursive: true });
        console.log('Created quarantine directory:', this.quarantineDir);
      }

      // Initialize encryption key (derived from app salt + system UUID)
      this.encryptionKey = this.deriveEncryptionKey();

      // Update database schema for enhanced quarantine
      this.updateQuarantineSchema();

      // Start retry queue processor
      this.startRetryProcessor();

      this.log('info', 'Quarantine service initialized successfully');
      return true;
    } catch (error) {
      this.log('error', 'Failed to initialize quarantine service', { error: error.message });
      throw error;
    }
  }

  /**
   * Update quarantine database schema
   */
  updateQuarantineSchema() {
    try {
      // Create table if it doesn't exist
      this.db.db.exec(`
        CREATE TABLE IF NOT EXISTS quarantine_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_path TEXT NOT NULL,
          original_name TEXT NOT NULL,
          quarantine_path TEXT NOT NULL,
          file_hash TEXT NOT NULL,
          size INTEGER NOT NULL,
          encrypted INTEGER DEFAULT 1,
          reason TEXT,
          quarantined_at INTEGER DEFAULT (strftime('%s', 'now')),
          restored INTEGER DEFAULT 0,
          restored_at INTEGER,
          purged INTEGER DEFAULT 0,
          purged_at INTEGER,
          retry_count INTEGER DEFAULT 0,
          last_retry_at INTEGER,
          metadata TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_quarantine_original_path ON quarantine_files(original_path);
        CREATE INDEX IF NOT EXISTS idx_quarantine_hash ON quarantine_files(file_hash);
        CREATE INDEX IF NOT EXISTS idx_quarantine_restored ON quarantine_files(restored);
        CREATE INDEX IF NOT EXISTS idx_quarantine_purged ON quarantine_files(purged);
      `);

      this.db.saveDatabase();
      console.log('Quarantine schema initialized successfully');
    } catch (error) {
      console.error('Error initializing quarantine schema:', error);
    }
  }

  /**
   * Derive encryption key from app salt and system UUID
   */
  deriveEncryptionKey() {
    const appSalt = 'fortimorph-quarantine-salt-v1';
    const systemId = app.getPath('userData'); // Unique per installation
    const combined = appSalt + systemId;
    
    return crypto.createHash('sha256').update(combined).digest();
  }

  /**
   * Move file to quarantine with encryption
   * @param {string} filePath - Path to file to quarantine
   * @param {string} reason - Reason for quarantine
   * @returns {Promise<Object>} Quarantine result
   */
  async quarantineFile(filePath, reason = 'Manual quarantine') {
    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error('File does not exist');
      }

      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }

      // Calculate file hash
      const fileHash = await this.calculateFileHash(filePath);
      const originalName = path.basename(filePath);

      // Generate unique quarantine filename
      const timestamp = Date.now();
      const quarantineFilename = `${timestamp}_${crypto.randomBytes(8).toString('hex')}.qtn`;
      const quarantinePath = path.join(this.quarantineDir, quarantineFilename);

      // Encrypt and move file
      await this.encryptFile(filePath, quarantinePath);

      // Store metadata in database
      const stmt = this.db.db.prepare(`
        INSERT INTO quarantine_files 
        (original_path, original_name, quarantine_path, file_hash, size, encrypted, reason, metadata)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `);

      const metadata = JSON.stringify({
        originalDir: path.dirname(filePath),
        fileExt: path.extname(filePath),
        quarantinedBy: 'system',
        timestamp: timestamp
      });

      stmt.run([filePath, originalName, quarantinePath, fileHash, stats.size, reason, metadata]);
      stmt.free();

      const quarantineId = this.db.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];

      // Delete original file
      fs.unlinkSync(filePath);

      this.db.saveDatabase();
      this.log('info', `File quarantined: ${originalName}`, {
        id: quarantineId,
        originalPath: filePath,
        size: stats.size,
        reason
      });

      return {
        success: true,
        id: quarantineId,
        originalPath: filePath,
        quarantinePath: quarantinePath,
        hash: fileHash,
        size: stats.size
      };
    } catch (error) {
      // If file is locked, add to retry queue
      if (error.code === 'EBUSY' || error.code === 'EPERM') {
        this.addToRetryQueue(filePath, reason);
        this.log('warn', `File locked, added to retry queue: ${filePath}`, { error: error.message });
        return {
          success: false,
          queued: true,
          message: 'File is locked, added to retry queue',
          error: error.message
        };
      }

      this.log('error', `Failed to quarantine file: ${filePath}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Encrypt file with AES-256-CBC
   */
  async encryptFile(sourcePath, destPath) {
    return new Promise((resolve, reject) => {
      try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);

        const input = fs.createReadStream(sourcePath);
        const output = fs.createWriteStream(destPath);

        // Write IV at the beginning of the file
        output.write(iv);

        input.pipe(cipher).pipe(output);

        output.on('finish', () => resolve());
        output.on('error', reject);
        input.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Decrypt file
   */
  async decryptFile(sourcePath, destPath) {
    return new Promise((resolve, reject) => {
      let timeout;
      let input;
      let output;
      let decipher;
      let resolved = false;
      
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        try {
          if (input && !input.destroyed) {
            input.destroy();
          }
          if (output && !output.destroyed) {
            output.destroy();
          }
          if (decipher) {
            decipher.destroy();
          }
        } catch (err) {
          // Ignore cleanup errors
          console.error('Cleanup error:', err.message);
        }
      };
      
      const handleError = (err) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        
        // Clean up partial output file
        try {
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
        } catch (cleanupErr) {
          console.error('Failed to clean up partial file:', cleanupErr.message);
        }
        
        reject(err);
      };
      
      const handleSuccess = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve();
      };

      try {
        // Check if source file exists and is readable
        if (!fs.existsSync(sourcePath)) {
          return reject(new Error('Encrypted file not found'));
        }

        const stats = fs.statSync(sourcePath);
        if (stats.size < 16) {
          return reject(new Error('Invalid encrypted file - too small'));
        }

        // Calculate timeout based on file size: 30s base + 1s per MB
        const timeoutMs = Math.min(30000 + Math.floor(stats.size / (1024 * 1024)) * 1000, 60000);
        console.log(`Decrypting file (${stats.size} bytes) with ${timeoutMs}ms timeout`);
        
        timeout = setTimeout(() => {
          handleError(new Error(`Decryption timeout after ${timeoutMs}ms. The file may be corrupted or locked.`));
        }, timeoutMs);

        // Read IV from the beginning of the file
        const ivBuffer = Buffer.alloc(16);
        const fd = fs.openSync(sourcePath, 'r');
        const bytesRead = fs.readSync(fd, ivBuffer, 0, 16, 0);
        fs.closeSync(fd);

        if (bytesRead !== 16) {
          return reject(new Error('Invalid encrypted file - could not read IV'));
        }

        // Create decipher
        decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, ivBuffer);
        
        // Create streams (skip first 16 bytes for IV)
        input = fs.createReadStream(sourcePath, { start: 16 });
        output = fs.createWriteStream(destPath);

        // Set up error handlers
        decipher.on('error', (err) => {
          handleError(new Error(`Decryption failed: ${err.message}`));
        });
        
        input.on('error', (err) => {
          handleError(new Error(`Read error: ${err.message}`));
        });
        
        output.on('error', (err) => {
          handleError(new Error(`Write error: ${err.message}`));
        });
        
        output.on('finish', () => {
          // Verify the output file was created
          if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
            handleSuccess();
          } else {
            handleError(new Error('Decryption produced empty file'));
          }
        });

        // Pipe the streams
        input.pipe(decipher).pipe(output);
        
      } catch (error) {
        handleError(error);
      }
    });
  }

  /**
   * Calculate SHA-256 hash of file
   */
  async calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Restore file from quarantine
   * @param {number} quarantineId - Quarantine record ID
   * @param {string} restorePath - Optional custom restore path
   * @param {string} conflictMode - 'overwrite', 'rename', or 'skip'
   * @returns {Promise<Object>} Restore result
   */
  async restoreFile(quarantineId, restorePath = null, conflictMode = 'rename') {
    try {
      // Get quarantine record
      const stmt = this.db.db.prepare(`
        SELECT * FROM quarantine_files 
        WHERE id = ? AND restored = 0 AND purged = 0
      `);
      stmt.bind([quarantineId]);

      if (!stmt.step()) {
        stmt.free();
        throw new Error('Quarantine record not found or already restored/purged');
      }

      const record = stmt.getAsObject();
      stmt.free();

      const targetPath = restorePath || record.original_path;

      // Handle file conflicts
      let finalPath = targetPath;
      if (fs.existsSync(targetPath)) {
        if (conflictMode === 'skip') {
          return {
            success: false,
            skipped: true,
            message: 'File already exists, restore skipped'
          };
        } else if (conflictMode === 'rename') {
          finalPath = this.generateUniqueFilename(targetPath);
        }
        // overwrite mode: continue with targetPath
      }

      // Ensure target directory exists
      const targetDir = path.dirname(finalPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Decrypt and restore file
      await this.decryptFile(record.quarantine_path, finalPath);

      // Verify restored file hash
      const restoredHash = await this.calculateFileHash(finalPath);
      if (restoredHash !== record.file_hash) {
        // Hash mismatch - delete restored file and throw error
        fs.unlinkSync(finalPath);
        throw new Error('File hash verification failed after restore');
      }

      // Update database
      const updateStmt = this.db.db.prepare(`
        UPDATE quarantine_files 
        SET restored = 1, restored_at = strftime('%s', 'now')
        WHERE id = ?
      `);
      updateStmt.run([quarantineId]);
      updateStmt.free();

      // Delete quarantine file
      fs.unlinkSync(record.quarantine_path);

      this.db.saveDatabase();
      this.log('info', `File restored from quarantine: ${record.original_name}`, {
        id: quarantineId,
        originalPath: record.original_path,
        restoredPath: finalPath
      });

      return {
        success: true,
        id: quarantineId,
        originalPath: record.original_path,
        restoredPath: finalPath,
        hash: restoredHash
      };
    } catch (error) {
      this.log('error', `Failed to restore file from quarantine`, { 
        id: quarantineId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Generate unique filename for conflict resolution
   */
  generateUniqueFilename(filePath) {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);

    let counter = 1;
    let newPath = path.join(dir, `${basename} (${counter})${ext}`);

    while (fs.existsSync(newPath)) {
      counter++;
      newPath = path.join(dir, `${basename} (${counter})${ext}`);
    }

    return newPath;
  }

  /**
   * Purge file from quarantine permanently
   * @param {number} quarantineId - Quarantine record ID
   * @returns {Promise<Object>} Purge result
   */
  async purgeFile(quarantineId) {
    try {
      // Get quarantine record
      const stmt = this.db.db.prepare(`
        SELECT * FROM quarantine_files 
        WHERE id = ? AND purged = 0
      `);
      stmt.bind([quarantineId]);

      if (!stmt.step()) {
        stmt.free();
        throw new Error('Quarantine record not found or already purged');
      }

      const record = stmt.getAsObject();
      stmt.free();

      // Delete quarantine file if it exists
      if (fs.existsSync(record.quarantine_path)) {
        fs.unlinkSync(record.quarantine_path);
      }

      // Update database
      const updateStmt = this.db.db.prepare(`
        UPDATE quarantine_files 
        SET purged = 1, purged_at = strftime('%s', 'now')
        WHERE id = ?
      `);
      updateStmt.run([quarantineId]);
      updateStmt.free();

      this.db.saveDatabase();
      this.log('info', `File purged from quarantine: ${record.original_name}`, {
        id: quarantineId,
        originalPath: record.original_path
      });

      return {
        success: true,
        id: quarantineId,
        originalPath: record.original_path
      };
    } catch (error) {
      this.log('error', `Failed to purge file from quarantine`, { 
        id: quarantineId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get all quarantined files
   */
  getQuarantinedFiles(filters = {}) {
    try {
      let query = 'SELECT * FROM quarantine_files WHERE restored = 0 AND purged = 0';
      const params = [];

      if (filters.searchTerm) {
        query += ' AND original_name LIKE ?';
        params.push(`%${filters.searchTerm}%`);
      }

      if (filters.dateFrom) {
        query += ' AND quarantined_at >= ?';
        params.push(filters.dateFrom);
      }

      if (filters.dateTo) {
        query += ' AND quarantined_at <= ?';
        params.push(filters.dateTo);
      }

      query += ' ORDER BY quarantined_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      const stmt = this.db.db.prepare(query);
      if (params.length > 0) {
        stmt.bind(params);
      }

      const files = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        files.push({
          id: row.id,
          originalPath: row.original_path,
          originalName: row.original_name,
          size: row.size,
          hash: row.file_hash,
          reason: row.reason,
          quarantinedAt: row.quarantined_at,
          retryCount: row.retry_count,
          metadata: row.metadata ? JSON.parse(row.metadata) : {}
        });
      }
      stmt.free();

      return files;
    } catch (error) {
      this.log('error', 'Failed to get quarantined files', { error: error.message });
      throw error;
    }
  }

  /**
   * Get quarantine statistics
   */
  getQuarantineStats() {
    try {
      const stats = {
        totalFiles: 0,
        totalSize: 0,
        restoredFiles: 0,
        purgedFiles: 0,
        queuedFiles: this.retryQueue.size
      };

      // Total quarantined files (not restored/purged)
      const activeStmt = this.db.db.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as size 
        FROM quarantine_files 
        WHERE restored = 0 AND purged = 0
      `);
      activeStmt.step();
      const activeResult = activeStmt.getAsObject();
      stats.totalFiles = activeResult.count;
      stats.totalSize = activeResult.size;
      activeStmt.free();

      // Restored files count
      const restoredStmt = this.db.db.prepare(`
        SELECT COUNT(*) as count FROM quarantine_files WHERE restored = 1
      `);
      restoredStmt.step();
      stats.restoredFiles = restoredStmt.getAsObject().count;
      restoredStmt.free();

      // Purged files count
      const purgedStmt = this.db.db.prepare(`
        SELECT COUNT(*) as count FROM quarantine_files WHERE purged = 1
      `);
      purgedStmt.step();
      stats.purgedFiles = purgedStmt.getAsObject().count;
      purgedStmt.free();

      return stats;
    } catch (error) {
      this.log('error', 'Failed to get quarantine stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Add file to retry queue
   */
  addToRetryQueue(filePath, reason) {
    this.retryQueue.set(filePath, {
      filePath,
      reason,
      retryCount: 0,
      addedAt: Date.now(),
      lastRetryAt: null
    });
  }

  /**
   * Start retry queue processor
   */
  startRetryProcessor() {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
    }

    this.retryInterval = setInterval(async () => {
      if (this.retryQueue.size === 0) return;

      for (const [filePath, metadata] of this.retryQueue.entries()) {
        try {
          // Check if enough time has passed since last retry
          if (metadata.lastRetryAt && Date.now() - metadata.lastRetryAt < this.retryDelay) {
            continue;
          }

          // Check if file still exists
          if (!fs.existsSync(filePath)) {
            this.retryQueue.delete(filePath);
            this.log('info', `File no longer exists, removed from retry queue: ${filePath}`);
            continue;
          }

          // Attempt to quarantine
          const result = await this.quarantineFile(filePath, metadata.reason);
          
          if (result.success) {
            this.retryQueue.delete(filePath);
            this.log('info', `Successfully quarantined file from retry queue: ${filePath}`);
          } else if (!result.queued) {
            // Failed but not queued again - increment retry count
            metadata.retryCount++;
            metadata.lastRetryAt = Date.now();

            if (metadata.retryCount >= this.maxRetries) {
              this.retryQueue.delete(filePath);
              this.log('error', `Max retries reached for file: ${filePath}`, {
                retryCount: metadata.retryCount
              });
            }
          }
        } catch (error) {
          metadata.retryCount++;
          metadata.lastRetryAt = Date.now();

          if (metadata.retryCount >= this.maxRetries) {
            this.retryQueue.delete(filePath);
            this.log('error', `Max retries reached for file: ${filePath}`, {
              retryCount: metadata.retryCount,
              error: error.message
            });
          }
        }
      }
    }, this.retryDelay);
  }

  /**
   * Get retry queue status
   */
  getRetryQueue() {
    return Array.from(this.retryQueue.values());
  }

  /**
   * Stop retry processor
   */
  stopRetryProcessor() {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
  }

  /**
   * Log message
   */
  log(level, message, metadata = {}) {
    if (this.logsService && typeof this.logsService.log === 'function') {
      this.logsService.log('quarantine', level, message, metadata);
    } else {
      console.log(`[Quarantine][${level}]`, message, metadata);
    }
  }

  /**
   * Cleanup - stop retry processor
   */
  cleanup() {
    this.stopRetryProcessor();
  }

  /**
   * Get quarantine directory path
   * @returns {string} Quarantine directory path
   */
  getQuarantineDir() {
    return this.quarantineDir;
  }
}

module.exports = QuarantineService;
