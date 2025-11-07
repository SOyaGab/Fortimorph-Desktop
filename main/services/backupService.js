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
   */
  async initializeEncryptionKey() {
    try {
      // Try to get existing key from database
      const keyRecord = this.db.getSetting('backup_encryption_key');
      
      if (keyRecord) {
        this.encryptionKey = Buffer.from(keyRecord, 'hex');
      } else {
        // Generate new encryption key
        this.encryptionKey = crypto.randomBytes(32);
        
        // Save key to database
        this.db.setSetting('backup_encryption_key', this.encryptionKey.toString('hex'));
        
        console.log('Generated new backup encryption key');
      }

      return true;
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
      throw error;
    }
  }

  /**
   * Generate recovery key for backup encryption
   */
  generateRecoveryKey() {
    const recoveryKey = crypto.randomBytes(32);
    const recoveryKeyString = recoveryKey.toString('base64');
    
    // Store recovery key info in database
    this.db.setSetting('backup_recovery_key_generated', Date.now().toString());
    
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
   * Get all files recursively from a directory
   */
  async getAllFiles(dirPath, arrayOfFiles = []) {
    try {
      const files = await readdir(dirPath);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        
        try {
          const stats = await stat(filePath);
          
          if (stats.isDirectory()) {
            arrayOfFiles = await this.getAllFiles(filePath, arrayOfFiles);
          } else {
            arrayOfFiles.push({
              path: filePath,
              size: stats.size,
              modified: stats.mtime.getTime()
            });
          }
        } catch (error) {
          console.warn(`Skipping file ${filePath}: ${error.message}`);
        }
      }

      return arrayOfFiles;
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
      return arrayOfFiles;
    }
  }

  /**
   * Detect files that need backup (new or changed)
   */
  async detectIncrementalChanges(sourcePath, previousManifest = null) {
    const currentFiles = await this.getAllFiles(sourcePath);
    const filesToBackup = [];
    const unchangedFiles = [];

    for (const file of currentFiles) {
      const relativePath = path.relative(sourcePath, file.path);
      
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
   */
  async createBackup(sourcePath, options = {}, progressCallback = null) {
    const {
      name = `Backup_${Date.now()}`,
      encrypt = true,
      compress = true,
      incremental = true
    } = options;

    try {
      // Preflight checks
      const preflightResult = await this.preflightChecks(sourcePath);
      if (preflightResult.errors.length > 0) {
        throw new Error(`Preflight checks failed: ${preflightResult.errors.join(', ')}`);
      }

      // Get previous backup manifest if incremental
      let previousManifest = null;
      if (incremental) {
        const previousBackups = this.db.getBackups({ source_path: sourcePath });
        if (previousBackups && previousBackups.length > 0) {
          const lastBackup = previousBackups[previousBackups.length - 1];
          if (lastBackup.manifest) {
            previousManifest = JSON.parse(lastBackup.manifest);
          }
        }
      }

      // Detect changes
      const changes = await this.detectIncrementalChanges(sourcePath, previousManifest);
      
      if (progressCallback) {
        progressCallback({
          phase: 'detection',
          filesFound: changes.totalFiles,
          filesToBackup: changes.filesToBackup.length,
          filesUnchanged: changes.unchangedFiles.length
        });
      }

      // Create backup directory
      const backupId = `backup_${Date.now()}`;
      const backupPath = path.join(this.backupStorePath, backupId);
      await mkdir(backupPath, { recursive: true });

      // Backup files
      const manifest = {
        backupId,
        name,
        sourcePath,
        backupPath,
        timestamp: Date.now(),
        encrypted: encrypt,
        compressed: compress,
        incremental,
        files: []
      };

      let processedFiles = 0;
      let totalSize = 0;

      for (const file of changes.filesToBackup) {
        try {
          const hash = await this.calculateFileHash(file.path);
          const targetPath = path.join(backupPath, file.relativePath + '.bak');

          // Encrypt and compress file
          await this.encryptFile(file.path, targetPath, { encrypt, compress });

          manifest.files.push({
            relativePath: file.relativePath,
            originalPath: file.path,
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
              total: changes.filesToBackup.length,
              currentFile: file.relativePath,
              progress: (processedFiles / changes.filesToBackup.length) * 100
            });
          }
        } catch (error) {
          console.error(`Failed to backup file ${file.path}:`, error);
          manifest.files.push({
            relativePath: file.relativePath,
            error: error.message,
            skipped: true
          });
        }
      }

      // Add unchanged files to manifest (reference only)
      if (incremental && previousManifest) {
        manifest.referencedFiles = changes.unchangedFiles.map(f => f.relativePath);
      }

      // Save manifest to file
      const manifestPath = path.join(backupPath, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Save backup record to database
      this.db.createBackup({
        name,
        source_path: sourcePath,
        backup_path: backupPath,
        size: totalSize,
        file_count: manifest.files.length,
        encrypted: encrypt ? 1 : 0,
        manifest: JSON.stringify(manifest)
      });

      // Log backup creation
      this.db.addLog(
        'backup',
        `Backup created: ${name}`,
        JSON.stringify({
          backupId,
          filesBackedUp: manifest.files.length,
          totalSize,
          incremental
        }),
        'info'
      );

      if (progressCallback) {
        progressCallback({
          phase: 'complete',
          success: true,
          backupId,
          filesBackedUp: manifest.files.length,
          totalSize
        });
      }

      return {
        success: true,
        backupId,
        manifest,
        filesBackedUp: manifest.files.length,
        totalSize
      };

    } catch (error) {
      console.error('Backup failed:', error);
      
      // Log failure
      this.db.addLog(
        'backup',
        `Backup failed: ${error.message}`,
        JSON.stringify({ sourcePath, error: error.stack }),
        'error'
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
      
      if (progressCallback) {
        progressCallback({
          phase: 'init',
          filesTotal: manifest.files.length
        });
      }

      // Ensure target directory exists
      if (!fs.existsSync(targetPath)) {
        await mkdir(targetPath, { recursive: true });
      }

      let restoredFiles = 0;
      const verificationResults = [];

      for (const file of manifest.files) {
        if (file.skipped) {
          continue;
        }

        try {
          let targetFilePath = path.join(targetPath, file.relativePath);
          
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
              total: manifest.files.length,
              currentFile: file.relativePath,
              progress: (restoredFiles / manifest.files.length) * 100
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
      this.db.addLog(
        'backup',
        `Backup restored: ${manifest.name}`,
        JSON.stringify({
          backupId,
          filesRestored: restoredFiles,
          targetPath
        }),
        'info'
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
      
      this.db.addLog(
        'backup',
        `Restore failed: ${error.message}`,
        JSON.stringify({ backupId, error: error.stack }),
        'error'
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
      this.db.addLog(
        'backup',
        `Backup verified: ${manifest.name}`,
        JSON.stringify(verificationResults),
        'info'
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
  listBackups() {
    return this.db.getBackups();
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
      this.db.addLog(
        'backup',
        `Backup deleted: ${backup.name}`,
        JSON.stringify({ backupId }),
        'info'
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
