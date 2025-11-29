const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const stream = require('stream');
const antivirusService = require('./antivirusService');

const pipeline = promisify(stream.pipeline);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

/**
 * BackupService - Handles encrypted incremental backups
 * Features:
 * - Incremental backup (only changed files)
 * - AES-256 encryption with optional recovery key
 * - Chunk-based streaming for large files
 * - Compression support
 * - Manifest-based integrity verification
 */
class BackupService {
  constructor(database) {
    this.db = database;
    this.algorithm = 'aes-256-cbc';
    this.chunkSize = 64 * 1024; // 64KB chunks
    this.backupStorePath = null;
    this.encryptionKey = null;
    this.recoveryKey = null;
    this.getUserId = null; // Function to get current user ID
    this.encryptionKeys = new Map(); // Per-user encryption keys cache
  }
  
  /**
   * Set function to get current user ID
   */
  setUserIdProvider(getUserIdFn) {
    this.getUserId = getUserIdFn;
  }

  /**
   * Initialize backup service and storage paths
   */
  async initialize(backupBasePath) {
    try {
      this.backupStorePath = backupBasePath;
      
      // Ensure backup directory exists
      if (!fs.existsSync(this.backupStorePath)) {
        await mkdir(this.backupStorePath, { recursive: true });
      }

      // Generate or load encryption key
      await this.initializeEncryptionKey();

      console.log('Backup service initialized at:', this.backupStorePath);
      return true;
    } catch (error) {
      console.error('Failed to initialize backup service:', error);
      throw error;
    }
  }

  /**
   * Initialize encryption key from database or generate new one
   * NOTE: This is now per-user. Called on demand when backup is created.
   */
  async initializeEncryptionKey(userId = null) {
    try {
      // USER ISOLATION: Each user has their own encryption key
      const settingKey = 'backup_encryption_key';
      
      // Check cache first
      const cacheKey = userId || 'global';
      if (this.encryptionKeys.has(cacheKey)) {
        this.encryptionKey = this.encryptionKeys.get(cacheKey);
        return true;
      }
      
      // Try to get existing key from database (user-specific)
      const keyRecord = this.db.getSetting(settingKey, userId);
      
      if (keyRecord) {
        this.encryptionKey = Buffer.from(keyRecord, 'hex');
        this.encryptionKeys.set(cacheKey, this.encryptionKey);
      } else {
        // Generate new encryption key for this user
        this.encryptionKey = crypto.randomBytes(32);
        
        // Save key to database (user-specific)
        this.db.setSetting(settingKey, this.encryptionKey.toString('hex'), userId);
        this.encryptionKeys.set(cacheKey, this.encryptionKey);
        
        console.log(`Generated new backup encryption key for user: ${userId || 'global'}`);
      }

      return true;
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
      throw error;
    }
  }

  /**
   * Generate recovery key for backup encryption
   * USER ISOLATION: Recovery keys are per-user
   */
  generateRecoveryKey(userId = null) {
    const recoveryKey = crypto.randomBytes(32);
    const recoveryKeyString = recoveryKey.toString('base64');
    
    // Store recovery key info in database (user-specific)
    this.db.setSetting('backup_recovery_key_generated', Date.now().toString(), userId);
    
    return recoveryKeyString;
  }

  /**
   * Pre-flight checks before starting backup
   */
  async preflightChecks(sourcePath, estimatedSize = 0) {
    const checks = {
      sourceExists: false,
      sourceAccessible: false,
      sufficientSpace: false,
      targetWritable: false,
      errors: []
    };

    try {
      // Check if source exists
      if (fs.existsSync(sourcePath)) {
        checks.sourceExists = true;
      } else {
        checks.errors.push('Source path does not exist');
        return checks;
      }

      // Check if source is accessible
      try {
        await stat(sourcePath);
        checks.sourceAccessible = true;
      } catch (error) {
        checks.errors.push(`Source path not accessible: ${error.message}`);
      }

      // Check available disk space
      // Note: This is a simple check, more sophisticated checks could use OS-specific commands
      try {
        const testFile = path.join(this.backupStorePath, '.space-check');
        await writeFile(testFile, 'test');
        fs.unlinkSync(testFile);
        checks.targetWritable = true;
        
        // Simplified space check - in production, use disk-space or similar package
        checks.sufficientSpace = true;
      } catch (error) {
        checks.errors.push(`Target location not writable: ${error.message}`);
      }

    } catch (error) {
      checks.errors.push(`Preflight check failed: ${error.message}`);
    }

    return checks;
  }

  /**
   * Calculate file hash (SHA-256)
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
   * Get all files recursively from a directory or return file info for a single file
   */
  async getAllFiles(inputPath, arrayOfFiles = []) {
    try {
      const stats = await stat(inputPath);
      
      // If it's a single file, add it directly
      if (stats.isFile()) {
        arrayOfFiles.push({
          path: inputPath,
          size: stats.size,
          modified: stats.mtime.getTime()
        });
        return arrayOfFiles;
      }
      
      // If it's a directory, scan recursively
      if (stats.isDirectory()) {
        const files = await readdir(inputPath);

        for (const file of files) {
          const filePath = path.join(inputPath, file);
          
          try {
            const fileStats = await stat(filePath);
            
            if (fileStats.isDirectory()) {
              arrayOfFiles = await this.getAllFiles(filePath, arrayOfFiles);
            } else {
              arrayOfFiles.push({
                path: filePath,
                size: fileStats.size,
                modified: fileStats.mtime.getTime()
              });
            }
          } catch (error) {
            console.warn(`Skipping file ${filePath}: ${error.message}`);
          }
        }
      }

      return arrayOfFiles;
    } catch (error) {
      console.error(`Error reading path ${inputPath}:`, error);
      return arrayOfFiles;
    }
  }

  /**
   * Detect files that need backup (new or changed)
   * @param {string} sourcePath - Source path (file or directory)
   * @param {Object} previousManifest - Previous backup manifest for incremental check
   */
  async detectIncrementalChanges(sourcePath, previousManifest = null) {
    const currentFiles = await this.getAllFiles(sourcePath);
    const filesToBackup = [];
    const unchangedFiles = [];
    
    // Check if source is a single file
    const sourceStats = await stat(sourcePath);
    const isFile = sourceStats.isFile();

    for (const file of currentFiles) {
      // For single files, use just the filename; for directories, use relative path
      let relativePath;
      if (isFile) {
        relativePath = path.basename(file.path);
      } else {
        relativePath = path.relative(sourcePath, file.path);
        // Handle case where file.path equals sourcePath
        if (!relativePath || relativePath === '.') {
          relativePath = path.basename(file.path);
        }
      }
      
      // If no previous manifest, backup everything
      if (!previousManifest) {
        filesToBackup.push({ ...file, relativePath });
        continue;
      }

      // Check if file exists in previous manifest
      const previousFile = previousManifest.files.find(
        f => f.relativePath === relativePath
      );

      if (!previousFile) {
        // New file
        filesToBackup.push({ ...file, relativePath, reason: 'new' });
      } else if (file.size !== previousFile.size || file.modified > previousFile.modified) {
        // Changed file (size or modified time different)
        filesToBackup.push({ ...file, relativePath, reason: 'modified' });
      } else {
        // File appears unchanged (could add hash check for extra safety)
        unchangedFiles.push({ ...file, relativePath });
      }
    }

    return {
      filesToBackup,
      unchangedFiles,
      totalFiles: currentFiles.length
    };
  }

  /**
   * Encrypt and compress file
   */
  async encryptFile(sourcePath, targetPath, options = {}) {
    const { compress = true, encrypt = true } = options;

    return new Promise(async (resolve, reject) => {
      try {
        // Ensure target directory exists
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          await mkdir(targetDir, { recursive: true });
        }

        const inputStream = fs.createReadStream(sourcePath);
        const outputStream = fs.createWriteStream(targetPath);

        const streams = [inputStream];

        // Add compression
        if (compress) {
          streams.push(zlib.createGzip());
        }

        // Add encryption
        if (encrypt && this.encryptionKey) {
          const iv = crypto.randomBytes(16);
          const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);
          
          // Write IV at the start of the file
          outputStream.write(iv);
          streams.push(cipher);
        }

        streams.push(outputStream);

        // Pipeline all streams
        await pipeline(...streams);

        resolve({ success: true });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Decrypt and decompress file
   */
  async decryptFile(sourcePath, targetPath, options = {}) {
    const { compress = true, encrypt = true } = options;

    return new Promise(async (resolve, reject) => {
      try {
        // Ensure target directory exists
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          await mkdir(targetDir, { recursive: true });
        }

        const inputStream = fs.createReadStream(sourcePath);
        const outputStream = fs.createWriteStream(targetPath);

        const streams = [inputStream];

        // Read IV and setup decryption
        if (encrypt && this.encryptionKey) {
          const iv = await new Promise((resolve, reject) => {
            inputStream.once('readable', () => {
              const iv = inputStream.read(16);
              if (iv) {
                resolve(iv);
              } else {
                reject(new Error('Failed to read IV from encrypted file'));
              }
            });
          });

          const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
          streams.push(decipher);
        }

        // Add decompression
        if (compress) {
          streams.push(zlib.createGunzip());
        }

        streams.push(outputStream);

        // Pipeline all streams
        await pipeline(...streams);

        resolve({ success: true });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create backup with manifest
   * Supports multiple source paths separated by semicolons
   */
  async createBackup(sourcePathInput, options = {}, progressCallback = null) {
    const {
      name = `Backup_${Date.now()}`,
      encrypt = true,
      compress = true,
      incremental = true,
      userId = null
    } = options;

    try {
      // USER ISOLATION: Initialize encryption key for current user
      if (encrypt) {
        await this.initializeEncryptionKey(userId);
      }
      
      // Parse multiple source paths (separated by semicolons)
      const sourcePaths = sourcePathInput.split(';').map(p => p.trim()).filter(p => p);
      
      if (sourcePaths.length === 0) {
        throw new Error('No source paths provided');
      }
      
      // Preflight checks for all paths
      for (const sourcePath of sourcePaths) {
        const preflightResult = await this.preflightChecks(sourcePath);
        if (preflightResult.errors.length > 0) {
          throw new Error(`Preflight checks failed for ${sourcePath}: ${preflightResult.errors.join(', ')}`);
        }
      }

      // Create backup directory
      const backupId = `backup_${Date.now()}`;
      const backupPath = path.join(this.backupStorePath, backupId);
      await mkdir(backupPath, { recursive: true });

      // Backup manifest
      const manifest = {
        backupId,
        name,
        sourcePath: sourcePathInput, // Store original input for reference
        sourcePaths, // Store array of paths
        backupPath,
        timestamp: Date.now(),
        encrypted: encrypt,
        compressed: compress,
        incremental,
        files: []
      };

      let processedFiles = 0;
      let totalSize = 0;
      let allFilesToBackup = [];

      // Collect all files from all source paths
      for (const sourcePath of sourcePaths) {
        // Get previous backup manifest if incremental
        let previousManifest = null;
        if (incremental) {
          const previousBackups = this.db.getBackups({ source_path: sourcePathInput }, 10, userId);
          if (previousBackups && previousBackups.length > 0) {
            const lastBackup = previousBackups[previousBackups.length - 1];
            if (lastBackup.manifest) {
              previousManifest = JSON.parse(lastBackup.manifest);
            }
          }
        }

        // Detect changes for this source path
        const changes = await this.detectIncrementalChanges(sourcePath, previousManifest);
        
        // Add source path info to each file for proper restoration
        for (const file of changes.filesToBackup) {
          file.sourceRoot = sourcePath;
          allFilesToBackup.push(file);
        }
      }
      
      if (progressCallback) {
        progressCallback({
          phase: 'detection',
          filesFound: allFilesToBackup.length,
          filesToBackup: allFilesToBackup.length,
          filesUnchanged: 0
        });
      }

      // Backup all files
      for (const file of allFilesToBackup) {
        try {
          const hash = await this.calculateFileHash(file.path);
          
          // Create a unique path within backup to avoid collisions
          // Use source root base name + relative path
          const sourceBaseName = path.basename(file.sourceRoot);
          const uniqueRelPath = path.join(sourceBaseName, file.relativePath);
          const targetPath = path.join(backupPath, uniqueRelPath + '.bak');

          // Encrypt and compress file
          await this.encryptFile(file.path, targetPath, { encrypt, compress });

          manifest.files.push({
            relativePath: file.relativePath,
            uniqueRelPath: uniqueRelPath,
            originalPath: file.path,
            sourceRoot: file.sourceRoot,
            backupPath: targetPath,
            size: file.size,
            modified: file.modified,
            hash,
            reason: file.reason || 'full'
          });

          totalSize += file.size;
          processedFiles++;

          if (progressCallback) {
            progressCallback({
              phase: 'backup',
              current: processedFiles,
              total: allFilesToBackup.length,
              currentFile: file.relativePath,
              progress: (processedFiles / allFilesToBackup.length) * 100
            });
          }
        } catch (error) {
          console.error(`Failed to backup file ${file.path}:`, error);
          manifest.files.push({
            relativePath: file.relativePath,
            originalPath: file.path,
            error: error.message,
            skipped: true
          });
        }
      }

      // Save manifest to file
      const manifestPath = path.join(backupPath, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Count non-skipped files
      const successfulFiles = manifest.files.filter(f => !f.skipped).length;

      // Save backup record to database
      this.db.createBackup({
        name,
        source_path: sourcePathInput,
        backup_path: backupPath,
        size: totalSize,
        file_count: successfulFiles,
        encrypted: encrypt ? 1 : 0,
        manifest: JSON.stringify(manifest)
      }, userId);

      // Log backup creation
      this.db.addLog(
        'backup',
        `Backup created: ${name}`,
        JSON.stringify({
          backupId,
          filesBackedUp: successfulFiles,
          totalSize,
          incremental,
          sourcePaths: sourcePaths.length
        }),
        'info',
        userId
      );

      if (progressCallback) {
        progressCallback({
          phase: 'complete',
          success: true,
          backupId,
          filesBackedUp: successfulFiles,
          totalSize
        });
      }

      return {
        success: true,
        backupId,
        manifest,
        filesBackedUp: successfulFiles,
        totalSize
      };

    } catch (error) {
      console.error('Backup failed:', error);
      
      // Log failure
      this.db.addLog(
        'backup',
        `Backup failed: ${error.message}`,
        JSON.stringify({ sourcePathInput, error: error.stack }),
        'error',
        userId
      );

      if (progressCallback) {
        progressCallback({
          phase: 'error',
          success: false,
          error: error.message
        });
      }

      throw error;
    }
  }

  /**
   * Restore backup with verification
   */
  async restoreBackup(backupId, targetPath, options = {}, progressCallback = null) {
    const {
      verify = true,
      conflictStrategy = 'rename' // 'overwrite', 'rename', 'skip'
    } = options;

    try {
      // Get backup record
      const backup = this.db.getBackupById(backupId);
      if (!backup) {
        throw new Error('Backup not found');
      }

      const manifest = JSON.parse(backup.manifest);
      
      // Filter out skipped files for counting
      const filesToRestore = manifest.files.filter(f => !f.skipped);
      
      if (filesToRestore.length === 0) {
        throw new Error('No files to restore in this backup');
      }
      
      if (progressCallback) {
        progressCallback({
          phase: 'init',
          filesTotal: filesToRestore.length
        });
      }

      // Ensure target directory exists
      if (!fs.existsSync(targetPath)) {
        await mkdir(targetPath, { recursive: true });
      }

      let restoredFiles = 0;
      const verificationResults = [];

      for (const file of filesToRestore) {
        try {
          // Check if backup file exists
          if (!fs.existsSync(file.backupPath)) {
            console.error(`Backup file not found: ${file.backupPath}`);
            verificationResults.push({
              file: file.relativePath,
              failed: true,
              error: 'Backup file not found'
            });
            continue;
          }
          
          // Use uniqueRelPath if available (new format), otherwise use relativePath
          const restoreRelPath = file.uniqueRelPath || file.relativePath;
          let targetFilePath = path.join(targetPath, restoreRelPath);
          
          // Ensure target directory exists
          const targetDir = path.dirname(targetFilePath);
          if (!fs.existsSync(targetDir)) {
            await mkdir(targetDir, { recursive: true });
          }
          
          // Check for conflicts
          if (fs.existsSync(targetFilePath)) {
            if (conflictStrategy === 'skip') {
              verificationResults.push({
                file: file.relativePath,
                skipped: true,
                reason: 'File exists and conflict strategy is skip'
              });
              continue;
            } else if (conflictStrategy === 'rename') {
              const ext = path.extname(targetFilePath);
              const base = path.basename(targetFilePath, ext);
              const dir = path.dirname(targetFilePath);
              const newName = `${base}_restored_${Date.now()}${ext}`;
              targetFilePath = path.join(dir, newName);
            }
            // If 'overwrite', proceed normally
          }

          // Decrypt and restore file
          await this.decryptFile(
            file.backupPath,
            targetFilePath,
            { encrypt: manifest.encrypted, compress: manifest.compressed }
          );

          // Verify hash if requested
          if (verify) {
            const restoredHash = await this.calculateFileHash(targetFilePath);
            const hashMatch = restoredHash === file.hash;
            
            verificationResults.push({
              file: file.relativePath,
              hashMatch,
              originalHash: file.hash,
              restoredHash
            });

            if (!hashMatch) {
              console.warn(`Hash mismatch for ${file.relativePath}`);
            }
          }

          restoredFiles++;

          if (progressCallback) {
            progressCallback({
              phase: 'restore',
              current: restoredFiles,
              total: filesToRestore.length,
              currentFile: file.relativePath,
              progress: (restoredFiles / filesToRestore.length) * 100
            });
          }

        } catch (error) {
          console.error(`Failed to restore file ${file.relativePath}:`, error);
          verificationResults.push({
            file: file.relativePath,
            error: error.message,
            failed: true
          });
        }
      }

      // Log restore
      const userId = backup.user_id || null;
      this.db.addLog(
        'backup',
        `Backup restored: ${manifest.name}`,
        JSON.stringify({
          backupId,
          filesRestored: restoredFiles,
          targetPath
        }),
        'info',
        userId
      );

      if (progressCallback) {
        progressCallback({
          phase: 'complete',
          success: true,
          filesRestored: restoredFiles,
          verificationResults: verify ? verificationResults : null
        });
      }

      return {
        success: true,
        filesRestored: restoredFiles,
        verificationResults: verify ? verificationResults : null
      };

    } catch (error) {
      console.error('Restore failed:', error);
      
      const backup = this.db.getBackupById(backupId);
      const userId = backup ? backup.user_id : null;
      this.db.addLog(
        'backup',
        `Restore failed: ${error.message}`,
        JSON.stringify({ backupId, error: error.stack }),
        'error',
        userId
      );

      if (progressCallback) {
        progressCallback({
          phase: 'error',
          success: false,
          error: error.message
        });
      }

      throw error;
    }
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupId, progressCallback = null) {
    try {
      const backup = this.db.getBackupById(backupId);
      if (!backup) {
        throw new Error('Backup not found');
      }

      const manifest = JSON.parse(backup.manifest);
      const verificationResults = {
        backupId,
        timestamp: Date.now(),
        filesChecked: 0,
        filesValid: 0,
        filesInvalid: 0,
        filesMissing: 0,
        virusScan: {
          scanned: 0,
          clean: 0,
          threats: 0,
          errors: 0,
          skipped: 0
        },
        details: []
      };

      const validFiles = []; // Collect valid files for virus scanning

      for (const file of manifest.files) {
        if (file.skipped) {
          continue;
        }

        try {
          // Check if backup file exists
          if (!fs.existsSync(file.backupPath)) {
            verificationResults.filesMissing++;
            verificationResults.details.push({
              file: file.relativePath,
              status: 'missing'
            });
            continue;
          }

          // For encrypted files, we can't easily verify hash without decrypting
          // In a production system, you might store encrypted file hashes in manifest
          verificationResults.filesValid++;
          validFiles.push(file.backupPath);
          verificationResults.details.push({
            file: file.relativePath,
            status: 'valid'
          });

          verificationResults.filesChecked++;

          if (progressCallback) {
            progressCallback({
              phase: 'verify',
              current: verificationResults.filesChecked,
              total: manifest.files.length,
              currentFile: file.relativePath
            });
          }

        } catch (error) {
          verificationResults.filesInvalid++;
          verificationResults.details.push({
            file: file.relativePath,
            status: 'invalid',
            error: error.message
          });
        }
      }

      // Perform virus scan on valid files
      console.log(`Scanning ${validFiles.length} valid backup files for viruses...`);
      
      for (let i = 0; i < validFiles.length; i++) {
        const filePath = validFiles[i];
        
        if (progressCallback) {
          progressCallback({
            phase: 'virus-scan',
            current: i + 1,
            total: validFiles.length,
            currentFile: path.basename(filePath)
          });
        }

        try {
          const scanResult = await antivirusService.scanFile(filePath);
          verificationResults.virusScan.scanned++;

          if (scanResult.skipped) {
            verificationResults.virusScan.skipped++;
          } else if (scanResult.isClean) {
            verificationResults.virusScan.clean++;
          } else {
            verificationResults.virusScan.threats++;
            
            // Add threat details to the file's verification result
            const fileDetail = verificationResults.details.find(
              d => d.file === path.relative(this.backupStorePath, filePath)
            );
            if (fileDetail) {
              fileDetail.threat = scanResult.threat;
              fileDetail.threatMessage = scanResult.message;
            }
          }

          if (scanResult.error) {
            verificationResults.virusScan.errors++;
          }
        } catch (scanError) {
          console.error(`Virus scan error for ${filePath}:`, scanError);
          verificationResults.virusScan.errors++;
        }
      }

      // Log verification
      const userId = backup.user_id || null;
      this.db.addLog(
        'backup',
        `Backup verified: ${manifest.name}`,
        JSON.stringify(verificationResults),
        'info',
        userId
      );

      return verificationResults;

    } catch (error) {
      console.error('Verification failed:', error);
      throw error;
    }
  }

  /**
   * List all backups
   */
  listBackups(userId = null) {
    return this.db.getBackups({}, 50, userId);
  }

  /**
   * Delete backup
   */
  async deleteBackup(backupId) {
    try {
      const backup = this.db.getBackupById(backupId);
      if (!backup) {
        throw new Error('Backup not found');
      }

      // Delete backup files
      if (fs.existsSync(backup.backup_path)) {
        fs.rmSync(backup.backup_path, { recursive: true, force: true });
      }

      // Delete from database
      this.db.deleteBackup(backupId);

      // Log deletion
      const userId = backup.user_id || null;
      this.db.addLog(
        'backup',
        `Backup deleted: ${backup.name}`,
        JSON.stringify({ backupId }),
        'info',
        userId
      );

      return { success: true };

    } catch (error) {
      console.error('Failed to delete backup:', error);
      throw error;
    }
  }

  /**
   * Get backup directory path
   * @returns {string} Backup directory path
   */
  getBackupDir() {
    return this.backupStorePath;
  }
}

module.exports = BackupService;
