const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { Worker } = require('worker_threads');
const os = require('os');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);

/**
 * DuplicateFilesService - Detect and manage duplicate files
 * Features:
 * - Scan directories for duplicate files using SHA-256 hashing
 * - Support for files from 1KB to 100MB+ (optimized for large files)
 * - Group duplicates by content hash
 * - Calculate space savings potential
 * - Delete duplicate files (keeping one copy)
 * - Smart duplicate detection with size pre-filtering
 * - Chunked hashing for large files to prevent memory issues
 * - Parallel processing for better performance
 * - Non-blocking operations to prevent system lag
 */
class DuplicateFilesService {
  constructor(database, logsService = null) {
    this.db = database;
    this.logsService = logsService;
    this.scanInProgress = false;
    this.scanResults = null;
    this.abortController = null;
    this.getUserId = null;
    
    // Configuration for performance
    this.config = {
      MIN_FILE_SIZE: 1024, // 1KB minimum (was 100KB)
      MAX_FILE_SIZE: 500 * 1024 * 1024, // 500MB max
      LARGE_FILE_THRESHOLD: 10 * 1024 * 1024, // 10MB - use chunked hashing above this
      CHUNK_SIZE: 64 * 1024, // 64KB chunks for large files
      MAX_CONCURRENT_HASHES: Math.max(2, os.cpus().length - 1), // Leave 1 CPU free
      BATCH_SIZE: 50, // Process files in batches
      MAX_FILES_TO_SCAN: 10000, // Prevent scanning too many files
    };
  }

  /**
   * Set function to get current user ID
   */
  setUserIdProvider(getUserIdFn) {
    this.getUserId = getUserIdFn;
  }

  /**
   * Calculate file hash (SHA-256) - Optimized for large files
   */
  async calculateFileHash(filePath, fileSize) {
    try {
      // For small files, use simple stream
      if (fileSize < this.config.LARGE_FILE_THRESHOLD) {
        return new Promise((resolve, reject) => {
          const hash = crypto.createHash('sha256');
          const stream = fs.createReadStream(filePath);

          stream.on('data', (data) => hash.update(data));
          stream.on('end', () => resolve(hash.digest('hex')));
          stream.on('error', reject);
        });
      }
      
      // For large files, use chunked reading with yield to prevent blocking
      return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath, {
          highWaterMark: this.config.CHUNK_SIZE
        });
        
        let processedBytes = 0;
        
        stream.on('data', (chunk) => {
          hash.update(chunk);
          processedBytes += chunk.length;
          
          // Yield to event loop every 5 chunks to prevent blocking
          if (processedBytes % (this.config.CHUNK_SIZE * 5) === 0) {
            stream.pause();
            setImmediate(() => stream.resume());
          }
        });
        
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Failed to hash ${filePath}: ${error.message}`);
    }
  }

  /**
   * Quick hash for initial comparison (first and last 4KB)
   * Much faster than full hash, good for quick pre-filtering
   */
  async calculateQuickHash(filePath, fileSize) {
    try {
      const hash = crypto.createHash('sha256');
      const chunkSize = 4096; // 4KB
      
      // Read first 4KB
      const firstChunk = Buffer.alloc(Math.min(chunkSize, fileSize));
      const fd = await fs.promises.open(filePath, 'r');
      await fd.read(firstChunk, 0, firstChunk.length, 0);
      hash.update(firstChunk);
      
      // Read last 4KB if file is large enough
      if (fileSize > chunkSize) {
        const lastChunk = Buffer.alloc(Math.min(chunkSize, fileSize));
        await fd.read(lastChunk, 0, lastChunk.length, Math.max(0, fileSize - chunkSize));
        hash.update(lastChunk);
      }
      
      await fd.close();
      return hash.digest('hex');
    } catch (error) {
      throw new Error(`Failed to quick hash ${filePath}: ${error.message}`);
    }
  }

  /**
   * Get file type based on extension
   */
  getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    if (['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) {
      return 'document';
    }
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff'].includes(ext)) {
      return 'image';
    }
    if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
      return 'video';
    }
    if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'].includes(ext)) {
      return 'audio';
    }
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'].includes(ext)) {
      return 'archive';
    }
    if (['.exe', '.msi', '.app', '.dmg', '.deb', '.rpm'].includes(ext)) {
      return 'application';
    }
    
    return 'other';
  }

  /**
   * Get all files recursively from directories
   */
  async getAllFiles(dirPaths, progressCallback = null) {
    const files = [];
    const errors = [];
    let processedDirs = 0;

    for (const dirPath of dirPaths) {
      try {
        await this.scanDirectory(dirPath, files, errors);
        processedDirs++;
        
        if (progressCallback) {
          progressCallback({
            phase: 'scanning',
            processedDirs,
            totalDirs: dirPaths.length,
            filesFound: files.length
          });
        }
      } catch (error) {
        console.error(`Error scanning directory ${dirPath}:`, error);
        errors.push({ path: dirPath, error: error.message });
      }
    }

    return { files, errors };
  }

  /**
   * Recursively scan a directory with depth limit - OPTIMIZED
   */
  async scanDirectory(dirPath, files = [], errors = [], depth = 0) {
    const MAX_DEPTH = 4; // Increased from 3 to 4 for better coverage
    const SKIP_DIRS = [
      'node_modules',
      '.git',
      '$RECYCLE.BIN',
      'System Volume Information',
      'WindowsApps',
      'ProgramData',
      'Windows',
      'Program Files',
      'Program Files (x86)',
      '.vscode',
      '.idea',
      'cache',
      'Cache',
      'temp',
      'Temp',
      'tmp',
      '.npm',
      '.cargo',
      'bower_components',
      'vendor'
    ];

    // Check depth limit
    if (depth > MAX_DEPTH) {
      return files;
    }

    // Check if directory should be skipped
    const dirName = path.basename(dirPath);
    if (SKIP_DIRS.some(skip => dirPath.includes(skip) || dirName === skip)) {
      return files;
    }

    // Check if we've reached file limit
    if (files.length >= this.config.MAX_FILES_TO_SCAN) {
      console.warn(`Reached maximum file limit (${this.config.MAX_FILES_TO_SCAN}), stopping scan`);
      return files;
    }

    try {
      const entries = await readdir(dirPath);

      // Process in batches to prevent blocking
      const BATCH_SIZE = 100;
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, Math.min(i + BATCH_SIZE, entries.length));
        
        for (const entry of batch) {
          // Skip hidden files and system files
          if (entry.startsWith('.') || entry.startsWith('$') || entry.startsWith('~')) {
            continue;
          }

          const fullPath = path.join(dirPath, entry);
          
          try {
            const stats = await stat(fullPath);
            
            if (stats.isDirectory()) {
              // Yield to event loop before recursing
              await new Promise(resolve => setImmediate(resolve));
              await this.scanDirectory(fullPath, files, errors, depth + 1);
            } else if (stats.isFile()) {
              // Only include files within size range
              if (stats.size >= this.config.MIN_FILE_SIZE && 
                  stats.size <= this.config.MAX_FILE_SIZE) {
                files.push({
                  path: fullPath,
                  name: entry,
                  size: stats.size,
                  modified: stats.mtime.getTime(),
                  type: this.getFileType(fullPath)
                });
              }
            }
          } catch (error) {
            // Silently skip files we can't access
            if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
              console.warn(`Skipping ${fullPath}: ${error.message}`);
            }
          }
        }
        
        // Yield to event loop between batches
        if (i + BATCH_SIZE < entries.length) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    } catch (error) {
      // Silently skip directories we can't access
      if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
        console.error(`Error reading directory ${dirPath}:`, error);
      }
    }

    return files;
  }

  /**
   * Find duplicate files in given directories - OPTIMIZED
   */
  async findDuplicates(dirPaths, options = {}, progressCallback = null) {
    try {
      this.scanInProgress = true;
      this.abortController = { aborted: false };
      
      const { 
        minFileSize = this.config.MIN_FILE_SIZE, 
        maxFileSize = this.config.MAX_FILE_SIZE, 
        fileTypes = null 
      } = options;

      // Step 1: Scan all files
      if (progressCallback) {
        progressCallback({ phase: 'scanning', message: 'Scanning directories...', progress: 0 });
      }

      const { files, errors } = await this.getAllFiles(dirPaths, progressCallback);

      if (this.abortController.aborted) {
        throw new Error('Scan aborted by user');
      }

      console.log(`Scanned ${files.length} files in total`);

      // Step 2: Filter by size and type
      let filteredFiles = files.filter(file => 
        file.size >= minFileSize && 
        file.size <= maxFileSize
      );

      if (fileTypes && fileTypes.length > 0) {
        filteredFiles = filteredFiles.filter(file => 
          fileTypes.includes(file.type)
        );
      }

      console.log(`After filtering: ${filteredFiles.length} files`);

      if (filteredFiles.length === 0) {
        return {
          duplicateGroups: [],
          stats: {
            totalFiles: files.length,
            duplicateFiles: 0,
            duplicateGroups: 0,
            spaceWasted: 0,
            scannedAt: Date.now()
          }
        };
      }

      if (progressCallback) {
        progressCallback({
          phase: 'grouping',
          message: 'Grouping files by size...',
          progress: 20
        });
      }

      // Step 3: Group by size (only files with same size can be duplicates)
      const sizeGroups = new Map();
      for (const file of filteredFiles) {
        if (!sizeGroups.has(file.size)) {
          sizeGroups.set(file.size, []);
        }
        sizeGroups.get(file.size).push(file);
      }

      // Filter out sizes with only one file
      const potentialDuplicateSizes = Array.from(sizeGroups.entries())
        .filter(([size, group]) => group.length > 1);

      console.log(`Found ${potentialDuplicateSizes.length} size groups with potential duplicates`);

      if (potentialDuplicateSizes.length === 0) {
        return {
          duplicateGroups: [],
          stats: {
            totalFiles: files.length,
            duplicateFiles: 0,
            duplicateGroups: 0,
            spaceWasted: 0,
            scannedAt: Date.now()
          }
        };
      }

      if (progressCallback) {
        progressCallback({
          phase: 'quick-hashing',
          message: 'Quick pre-filtering with partial hashes...',
          progress: 30
        });
      }

      // Step 4: Quick hash for pre-filtering (much faster)
      const quickHashGroups = new Map();
      let processedForQuickHash = 0;
      
      for (const [size, filesInGroup] of potentialDuplicateSizes) {
        for (const file of filesInGroup) {
          try {
            const quickHash = await this.calculateQuickHash(file.path, file.size);
            const key = `${size}-${quickHash}`;
            
            if (!quickHashGroups.has(key)) {
              quickHashGroups.set(key, []);
            }
            quickHashGroups.get(key).push(file);
            
            processedForQuickHash++;
            if (processedForQuickHash % 50 === 0 && progressCallback) {
              const totalPotential = potentialDuplicateSizes.reduce((sum, [, g]) => sum + g.length, 0);
              progressCallback({
                phase: 'quick-hashing',
                message: `Quick pre-filtering: ${processedForQuickHash}/${totalPotential}`,
                progress: 30 + (processedForQuickHash / totalPotential) * 20
              });
            }
            
            // Yield to event loop periodically
            if (processedForQuickHash % 20 === 0) {
              await new Promise(resolve => setImmediate(resolve));
            }
          } catch (error) {
            console.warn(`Failed to quick hash ${file.path}:`, error.message);
          }
        }
      }

      // Filter to only groups with 2+ files (potential duplicates)
      const quickDuplicateCandidates = Array.from(quickHashGroups.values())
        .filter(group => group.length > 1)
        .flat();

      console.log(`After quick hash: ${quickDuplicateCandidates.length} files need full hash`);

      if (quickDuplicateCandidates.length === 0) {
        return {
          duplicateGroups: [],
          stats: {
            totalFiles: files.length,
            duplicateFiles: 0,
            duplicateGroups: 0,
            spaceWasted: 0,
            scannedAt: Date.now()
          }
        };
      }

      if (progressCallback) {
        progressCallback({
          phase: 'hashing',
          message: 'Calculating full file hashes...',
          progress: 50
        });
      }

      // Step 5: Calculate full hashes for candidates (in batches to prevent blocking)
      const hashGroups = new Map();
      let processed = 0;
      const HASH_BATCH_SIZE = this.config.BATCH_SIZE;

      for (let i = 0; i < quickDuplicateCandidates.length; i += HASH_BATCH_SIZE) {
        if (this.abortController.aborted) {
          throw new Error('Scan aborted by user');
        }
        
        const batch = quickDuplicateCandidates.slice(i, Math.min(i + HASH_BATCH_SIZE, quickDuplicateCandidates.length));
        
        // Process batch in parallel but with concurrency limit
        const batchPromises = batch.map(async (file) => {
          try {
            const hash = await this.calculateFileHash(file.path, file.size);
            
            if (!hashGroups.has(hash)) {
              hashGroups.set(hash, []);
            }
            
            hashGroups.get(hash).push({
              ...file,
              hash
            });

            processed++;
            
            if (progressCallback && processed % 10 === 0) {
              progressCallback({
                phase: 'hashing',
                message: `Hashing files: ${processed}/${quickDuplicateCandidates.length}`,
                processed,
                total: quickDuplicateCandidates.length,
                progress: 50 + (processed / quickDuplicateCandidates.length) * 40
              });
            }
          } catch (error) {
            console.warn(`Failed to hash file ${file.path}:`, error.message);
            errors.push({ path: file.path, error: error.message });
          }
        });
        
        await Promise.all(batchPromises);

        // Yield to event loop between batches
        await new Promise(resolve => setImmediate(resolve));
      }

      console.log(`Hashed ${processed} files, found ${hashGroups.size} unique hashes`);

      // Step 6: Filter to only actual duplicates (groups with 2+ files)
      const duplicateGroups = Array.from(hashGroups.entries())
        .filter(([hash, files]) => files.length > 1)
        .map(([hash, files]) => ({
          hash,
          files,
          count: files.length,
          totalSize: files.reduce((sum, f) => sum + f.size, 0),
          wastedSpace: files[0].size * (files.length - 1), // Space saved if keeping only one
          type: files[0].type
        }));

      // Step 7: Calculate statistics
      const stats = {
        totalScanned: files.length,
        totalFiltered: filteredFiles.length,
        duplicateGroups: duplicateGroups.length,
        totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.count, 0),
        totalWastedSpace: duplicateGroups.reduce((sum, g) => sum + g.wastedSpace, 0),
        byType: {},
        scannedAt: Date.now(),
        errors: errors.length
      };

      // Group stats by type
      for (const group of duplicateGroups) {
        if (!stats.byType[group.type]) {
          stats.byType[group.type] = {
            groups: 0,
            files: 0,
            wastedSpace: 0
          };
        }
        stats.byType[group.type].groups++;
        stats.byType[group.type].files += group.count;
        stats.byType[group.type].wastedSpace += group.wastedSpace;
      }

      if (progressCallback) {
        progressCallback({
          phase: 'complete',
          message: `Scan complete! Found ${duplicateGroups.length} duplicate groups`,
          progress: 100
        });
      }

      this.scanResults = {
        duplicateGroups,
        stats,
        errors,
        scannedAt: Date.now()
      };

      this.scanInProgress = false;

      console.log('Duplicate scan complete:', stats);

      // Log scan completion
      if (this.logsService) {
        const userId = this.getUserId ? this.getUserId() : null;
        await this.logsService.info('Duplicate files scan completed', 'duplicate_scan', {
          totalScanned: stats.totalScanned,
          duplicateGroups: stats.duplicateGroups,
          totalDuplicates: stats.totalDuplicates,
          wastedSpace: stats.totalWastedSpace,
          directories: dirPaths.length
        }, userId);
      }

      return this.scanResults;
    } catch (error) {
      this.scanInProgress = false;
      console.error('Failed to find duplicates:', error);
      
      // Log scan error
      if (this.logsService) {
        const userId = this.getUserId ? this.getUserId() : null;
        await this.logsService.error('Duplicate files scan failed', 'duplicate_scan', {
          error: error.message,
          directories: dirPaths.length
        }, userId);
      }
      
      throw error;
    }
  }

  /**
   * Get cached scan results
   */
  getCachedResults() {
    return this.scanResults;
  }

  /**
   * Delete duplicate files (keeping one from each group)
   */
  async deleteDuplicates(duplicateGroup, filesToKeep = []) {
    try {
      const results = {
        deleted: 0,
        failed: 0,
        spaceFreed: 0,
        errors: []
      };

      // If no specific files to keep are provided, keep the first one
      const keepPaths = filesToKeep.length > 0 
        ? filesToKeep 
        : [duplicateGroup.files[0].path];

      for (const file of duplicateGroup.files) {
        if (keepPaths.includes(file.path)) {
          continue; // Keep this file
        }

        try {
          await unlink(file.path);
          results.deleted++;
          results.spaceFreed += file.size;
        } catch (error) {
          console.error(`Failed to delete ${file.path}:`, error);
          results.failed++;
          results.errors.push({
            path: file.path,
            error: error.message
          });
        }
      }

      // Log deletion
      if (this.logsService && results.deleted > 0) {
        const userId = this.getUserId ? this.getUserId() : null;
        await this.logsService.info(`Deleted ${results.deleted} duplicate files`, 'duplicate_scan', {
          deleted: results.deleted,
          failed: results.failed,
          spaceFreed: results.spaceFreed,
          groupHash: duplicateGroup.hash
        }, userId);
      }

      return results;
    } catch (error) {
      console.error('Failed to delete duplicates:', error);
      throw error;
    }
  }

  /**
   * Save scan results to database
   */
  async saveScanResults(results) {
    try {
      const stmt = this.db.db.prepare(`
        INSERT INTO duplicate_scans (
          total_scanned, duplicate_groups, total_duplicates,
          wasted_space, scan_results, scanned_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const scanData = stmt.run([
        results.stats.totalScanned,
        results.stats.duplicateGroups,
        results.stats.totalDuplicates,
        results.stats.totalWastedSpace,
        JSON.stringify(results),
        results.scannedAt
      ]);

      stmt.free();

      return {
        success: true,
        scanId: scanData.lastInsertRowid
      };
    } catch (error) {
      console.error('Failed to save scan results:', error);
      throw error;
    }
  }

  /**
   * Get scan history
   */
  getScanHistory(limit = 10, userId = null) {
    try {
      let query = `
        SELECT 
          id, total_scanned, duplicate_groups, total_duplicates,
          wasted_space, scanned_at
        FROM duplicate_scans
      `;
      
      const params = [];
      
      if (userId) {
        query += ' WHERE user_id = ?';
        params.push(userId);
      }
      
      query += ' ORDER BY scanned_at DESC LIMIT ?';
      params.push(limit);
      
      const stmt = this.db.db.prepare(query);
      stmt.bind(params);

      const history = [];
      
      while (stmt.step()) {
        history.push(stmt.getAsObject());
      }
      stmt.free();

      return history;
    } catch (error) {
      console.error('Failed to get scan history:', error);
      throw error;
    }
  }

  /**
   * Clear scan results
   */
  clearResults() {
    this.scanResults = null;
  }
}

module.exports = DuplicateFilesService;
