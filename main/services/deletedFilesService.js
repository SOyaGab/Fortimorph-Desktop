const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const os = require('os');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);
const rename = promisify(fs.rename);
const unlink = promisify(fs.unlink);
const execPromise = promisify(exec);

/**
 * DeletedFilesService - Tracks and manages deleted files with restoration capability
 * Features:
 * - Read Windows Recycle Bin contents
 * - Track all file deletions with metadata
 * - Move deleted files to a safe storage location
 * - Restore deleted files to their original locations
 * - Search and filter deleted files by date, type, name
 * - Permanently delete files from trash
 */
class DeletedFilesService {
  constructor(database, logsService = null) {
    this.db = database;
    this.logsService = logsService;
    this.trashStorePath = null;
    this.recycleBinPath = null;
    this.getUserId = null;
  }

  /**
   * Set function to get current user ID
   */
  setUserIdProvider(getUserIdFn) {
    this.getUserId = getUserIdFn;
  }

  /**
   * Initialize deleted files service and trash storage
   */
  async initialize(trashBasePath) {
    try {
      this.trashStorePath = trashBasePath;
      
      // Ensure trash directory exists
      if (!fs.existsSync(this.trashStorePath)) {
        await mkdir(this.trashStorePath, { recursive: true });
      }

      // Set up Recycle Bin path for Windows
      if (process.platform === 'win32') {
        // Try to find Recycle Bin on each drive
        this.recycleBinPaths = this.getRecycleBinPaths();
      }

      console.log('Deleted files service initialized at:', this.trashStorePath);
      return true;
    } catch (error) {
      console.error('Failed to initialize deleted files service:', error);
      throw error;
    }
  }

  /**
   * Get all Recycle Bin paths on Windows
   */
  getRecycleBinPaths() {
    if (process.platform !== 'win32') return [];
    
    const drives = [];
    // Check common drive letters
    for (let i = 65; i <= 90; i++) { // A-Z
      const drive = String.fromCharCode(i);
      const drivePath = `${drive}:\\`;
      if (fs.existsSync(drivePath)) {
        const recycleBinPath = path.join(drivePath, '$Recycle.Bin');
        if (fs.existsSync(recycleBinPath)) {
          drives.push(recycleBinPath);
        }
      }
    }
    return drives;
  }

  /**
   * Move file to trash - cross-platform
   * Uses Electron's shell.trashItem for Mac/Linux, custom implementation for Windows
   */
  async moveToTrash(filePath) {
    const { shell } = require('electron');
    
    if (process.platform === 'win32') {
      // Use existing Windows implementation via trackDeletion
      return await this.trackDeletion(filePath);
    } else {
      // Use Electron's cross-platform trash for Mac/Linux
      try {
        await shell.trashItem(filePath);
        return { success: true, message: 'File moved to trash' };
      } catch (error) {
        console.error('Failed to move to trash:', error);
        return { success: false, error: error.message };
      }
    }
  }

  /**
   * Parse Windows Recycle Bin metadata - IMPROVED
   */
  async parseRecycleBinItem(itemPath, fileName) {
    try {
      // $I files contain metadata (original path, deletion date)
      // $R files contain the actual file data
      const identifier = fileName.substring(2); // Remove $R prefix
      const metaPath = path.join(itemPath, `$I${identifier}`);
      const dataPath = path.join(itemPath, fileName); // Use actual filename
      
      if (!fs.existsSync(dataPath)) {
        console.warn(`Data file not found: ${dataPath}`);
        return null;
      }
      
      let originalPath = null;
      let deletionTime = null;
      let fileSize = 0;
      
      // Try to read metadata file
      if (fs.existsSync(metaPath)) {
        try {
          const metaBuffer = await fs.promises.readFile(metaPath);
          
          // Windows Recycle Bin metadata structure:
          // Version 1 (Vista+):
          // Bytes 0-7: Header/version info
          // Bytes 8-15: File size (64-bit little-endian)
          // Bytes 16-23: Deletion time (Windows FILETIME, 64-bit little-endian)
          // Bytes 24+: Original path (Unicode UTF-16LE string)
          
          if (metaBuffer.length >= 24) {
            try {
              // Read file size
              fileSize = Number(metaBuffer.readBigUInt64LE(8));
              
              // Read deletion time
              const fileTime = metaBuffer.readBigUInt64LE(16);
              // Convert Windows FILETIME to Unix timestamp (milliseconds)
              // FILETIME is 100-nanosecond intervals since January 1, 1601
              // Unix epoch is January 1, 1970
              const FILETIME_EPOCH_DIFF = 11644473600000n; // Milliseconds between epochs
              deletionTime = Number((fileTime / 10000n) - FILETIME_EPOCH_DIFF);
              
              // Read original path (UTF-16LE string)
              // Windows 10+ adds 4 bytes (path length) before the actual path
              if (metaBuffer.length > 28) {
                // Try Windows 10+ format first (path starts at byte 28)
                const pathBuffer = metaBuffer.slice(28);
                const pathStr = pathBuffer.toString('utf16le');
                const possiblePath = pathStr.split('\0')[0].trim();
                
                // Validate if it looks like a Windows path
                if (possiblePath && (possiblePath.includes(':\\') || possiblePath.startsWith('\\'))) {
                  originalPath = possiblePath;
                  console.log(`[deletedFiles] ✅ Parsed (Win10): ${originalPath}`);
                } else {
                  // Fallback to legacy format (byte 24)
                  const legacyBuffer = metaBuffer.slice(24);
                  const legacyStr = legacyBuffer.toString('utf16le');
                  const legacyPath = legacyStr.split('\0')[0].trim();
                  
                  if (legacyPath && (legacyPath.includes(':\\') || legacyPath.startsWith('\\'))) {
                    originalPath = legacyPath;
                    console.log(`[deletedFiles] ✅ Parsed (legacy): ${originalPath}`);
                  }
                }
              } else if (metaBuffer.length > 24) {
                // Short metadata, try legacy format only
                const pathBuffer = metaBuffer.slice(24);
                const pathStr = pathBuffer.toString('utf16le');
                originalPath = pathStr.split('\0')[0].trim();
                
                if (originalPath && originalPath.length > 0) {
                  console.log(`[deletedFiles] ✅ Parsed (short): ${originalPath}`);
                } else {
                  originalPath = null;
                }
              }
              
              if (!originalPath) {
                console.warn(`[deletedFiles] ⚠️ Could not extract valid path from ${fileName}`);
              }
            } catch (parseError) {
              console.warn(`Error parsing metadata structure for ${fileName}:`, parseError.message);
            }
          }
        } catch (readError) {
          console.warn(`Could not read metadata file ${metaPath}:`, readError.message);
        }
      } else {
        console.warn(`Metadata file not found: ${metaPath}`);
      }
      
      // Get file stats
      const stats = await stat(dataPath);
      
      // Fallback: If we couldn't parse the original path, use the data file name
      if (!originalPath || originalPath === '') {
        // Try to get a meaningful name from the $R file
        originalPath = `Deleted_${identifier}`;
        console.warn(`Using fallback name for ${fileName}: ${originalPath}`);
      }
      
      const displayName = path.basename(originalPath);
      const fileType = this.getFileType(originalPath);
      
      return {
        fileName: displayName,
        originalPath,
        recycleBinPath: dataPath,
        size: fileSize || stats.size,
        deletedAt: deletionTime || stats.mtime.getTime(),
        type: fileType,
        isDirectory: stats.isDirectory(),
        source: 'recycle-bin',
        identifier // Keep identifier for debugging
      };
    } catch (error) {
      console.error(`Error parsing recycle bin item ${fileName}:`, error.message);
      return null;
    }
  }

  /**
   * Get all files from Windows Recycle Bin - IMPROVED
   * Returns empty array with message on non-Windows platforms
   */
  async getRecycleBinFiles() {
    // Only available on Windows
    if (process.platform !== 'win32') {
      console.log('Recycle Bin viewing is only available on Windows');
      return [];
    }
    
    if (!this.recycleBinPaths) {
      console.log('No Recycle Bin paths found');
      return [];
    }
    
    console.log(`Scanning ${this.recycleBinPaths.length} Recycle Bin path(s)...`);
    const recycleBinFiles = [];
    
    for (const recycleBinPath of this.recycleBinPaths) {
      try {
        console.log(`Scanning Recycle Bin: ${recycleBinPath}`);
        
        // Read all SID folders in Recycle Bin
        const entries = await readdir(recycleBinPath);
        const sidFolders = [];
        
        // Filter to only SID folders (long hexadecimal names)
        for (const entry of entries) {
          const entryPath = path.join(recycleBinPath, entry);
          try {
            const entryStat = await stat(entryPath);
            if (entryStat.isDirectory() && entry.startsWith('S-1-5-')) {
              sidFolders.push(entry);
            }
          } catch (error) {
            // Skip if can't stat
            continue;
          }
        }
        
        console.log(`Found ${sidFolders.length} SID folder(s) in ${recycleBinPath}`);
        
        for (const sidFolder of sidFolders) {
          const sidPath = path.join(recycleBinPath, sidFolder);
          
          try {
            // Read files in this SID folder
            const files = await readdir(sidPath);
            
            // Separate $I and $R files
            const rFiles = files.filter(f => f.startsWith('$R'));
            const iFiles = files.filter(f => f.startsWith('$I'));
            
            console.log(`SID folder ${sidFolder}: ${rFiles.length} data files, ${iFiles.length} metadata files`);
            
            // Process $R files (actual deleted files)
            for (const file of rFiles) {
              try {
                const item = await this.parseRecycleBinItem(sidPath, file);
                if (item) {
                  recycleBinFiles.push(item);
                } else {
                  console.warn(`Failed to parse item: ${file}`);
                }
              } catch (error) {
                console.error(`Error parsing ${file}:`, error.message);
              }
            }
          } catch (error) {
            // Skip folders we can't access (permission issues)
            if (error.code !== 'EPERM' && error.code !== 'EACCES') {
              console.warn(`Error reading SID folder ${sidFolder}:`, error.message);
            } else {
              console.log(`Permission denied for SID folder ${sidFolder}`);
            }
          }
        }
      } catch (error) {
        // Skip recycle bins we can't access
        if (error.code !== 'EPERM' && error.code !== 'EACCES') {
          console.warn(`Error reading recycle bin ${recycleBinPath}:`, error.message);
        } else {
          console.log(`Permission denied for Recycle Bin ${recycleBinPath}`);
        }
      }
    }
    
    console.log(`Total files found in Recycle Bin: ${recycleBinFiles.length}`);
    return recycleBinFiles;
  }

  /**
   * Get file type based on extension
   */
  getFileType(filePath) {
    if (!filePath || filePath === 'Unknown') {
      return 'other';
    }
    
    const ext = path.extname(filePath).toLowerCase();
    
    // If no extension, might be a folder
    if (!ext) {
      return 'folder';
    }
    
    // Document types
    if (['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx', '.csv'].includes(ext)) {
      return 'document';
    }
    
    // Image types
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff', '.tif', '.heic'].includes(ext)) {
      return 'image';
    }
    
    // Video types
    if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp'].includes(ext)) {
      return 'video';
    }
    
    // Audio types
    if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus', '.alac'].includes(ext)) {
      return 'audio';
    }
    
    // Archive types
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'].includes(ext)) {
      return 'archive';
    }
    
    // Executable/App types
    if (['.exe', '.msi', '.app', '.dmg', '.deb', '.rpm', '.bat', '.cmd', '.sh'].includes(ext)) {
      return 'application';
    }
    
    return 'other';
  }

  /**
   * Track a file deletion
   */
  async trackDeletion(originalPath, options = {}) {
    try {
      const stats = await stat(originalPath);
      const isDirectory = stats.isDirectory();
      
      // Generate unique trash path
      const timestamp = Date.now();
      const basename = path.basename(originalPath);
      const trashPath = path.join(this.trashStorePath, `${timestamp}_${basename}`);
      
      // Move file to trash
      await rename(originalPath, trashPath);
      
      // Get file type
      const fileType = isDirectory ? 'folder' : this.getFileType(originalPath);
      
      // Record in database
      const stmt = this.db.db.prepare(`
        INSERT INTO deleted_files (
          original_path, trash_path, file_name, file_type,
          size, is_directory, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run([
        originalPath,
        trashPath,
        basename,
        fileType,
        stats.size,
        isDirectory ? 1 : 0,
        timestamp
      ]);
      
      stmt.free();
      
      return {
        success: true,
        id: result.lastInsertRowid,
        trashPath
      };
    } catch (error) {
      console.error('Failed to track deletion:', error);
      throw error;
    }
  }

  /**
   * Get all deleted files with optional filters (includes Recycle Bin)
   */
  async getDeletedFiles(filters = {}) {
    try {
      // Get files from our internal trash
      let query = `
        SELECT * FROM deleted_files
        WHERE restored = 0 AND permanently_deleted = 0
      `;
      const params = [];
      
      // Filter by user_id for multi-user isolation
      if (filters.userId) {
        query += ` AND user_id = ?`;
        params.push(filters.userId);
      }
      
      // Filter by date range
      if (filters.startDate) {
        query += ` AND deleted_at >= ?`;
        params.push(filters.startDate);
      }
      
      if (filters.endDate) {
        query += ` AND deleted_at <= ?`;
        params.push(filters.endDate);
      }
      
      // Filter by type
      if (filters.fileType) {
        query += ` AND file_type = ?`;
        params.push(filters.fileType);
      }
      
      // Filter by name (search)
      if (filters.searchTerm) {
        query += ` AND file_name LIKE ?`;
        params.push(`%${filters.searchTerm}%`);
      }
      
      // Sort by deletion date (newest first)
      query += ` ORDER BY deleted_at DESC`;
      
      // Limit results if specified
      if (filters.limit) {
        query += ` LIMIT ?`;
        params.push(filters.limit);
      }
      
      const stmt = this.db.db.prepare(query);
      const files = [];
      
      stmt.bind(params);
      while (stmt.step()) {
        const file = stmt.getAsObject();
        file.source = 'internal-trash';
        files.push(file);
      }
      stmt.free();
      
      // Get files from Windows Recycle Bin
      const recycleBinFiles = await this.getRecycleBinFiles();
      
      console.log(`Retrieved ${recycleBinFiles.length} files from Recycle Bin`);
      
      // Apply filters to recycle bin files
      let filteredRecycleBinFiles = recycleBinFiles;
      
      if (filters.startDate) {
        const before = filteredRecycleBinFiles.length;
        filteredRecycleBinFiles = filteredRecycleBinFiles.filter(f => f.deletedAt >= filters.startDate);
        console.log(`Date filter (start): ${before} -> ${filteredRecycleBinFiles.length}`);
      }
      
      if (filters.endDate) {
        const before = filteredRecycleBinFiles.length;
        filteredRecycleBinFiles = filteredRecycleBinFiles.filter(f => f.deletedAt <= filters.endDate);
        console.log(`Date filter (end): ${before} -> ${filteredRecycleBinFiles.length}`);
      }
      
      if (filters.fileType && filters.fileType !== 'all') {
        const before = filteredRecycleBinFiles.length;
        filteredRecycleBinFiles = filteredRecycleBinFiles.filter(f => {
          const fileType = f.type || 'other';
          return fileType === filters.fileType;
        });
        console.log(`Type filter (${filters.fileType}): ${before} -> ${filteredRecycleBinFiles.length}`);
      }
      
      if (filters.searchTerm) {
        const before = filteredRecycleBinFiles.length;
        const searchLower = filters.searchTerm.toLowerCase();
        filteredRecycleBinFiles = filteredRecycleBinFiles.filter(f => 
          (f.fileName && f.fileName.toLowerCase().includes(searchLower)) ||
          (f.originalPath && f.originalPath.toLowerCase().includes(searchLower))
        );
        console.log(`Search filter ("${filters.searchTerm}"): ${before} -> ${filteredRecycleBinFiles.length}`);
      }
      
      console.log(`Final filtered Recycle Bin files: ${filteredRecycleBinFiles.length}`);
      
      // Combine and sort by deletion date
      const allFiles = [...files, ...filteredRecycleBinFiles];
      allFiles.sort((a, b) => {
        const timeA = a.deleted_at || a.deletedAt;
        const timeB = b.deleted_at || b.deletedAt;
        return timeB - timeA;
      });
      
      // Apply limit if specified
      if (filters.limit) {
        return allFiles.slice(0, filters.limit);
      }
      
      return allFiles;
    } catch (error) {
      console.error('Failed to get deleted files:', error);
      throw error;
    }
  }

  /**
   * Restore a file from Windows Recycle Bin
   */
  async restoreFromRecycleBin(recycleBinPath, originalPath) {
    try {
      // Determine restore path
      let restorePath = originalPath;
      
      // Check if original path is occupied
      if (fs.existsSync(restorePath)) {
        // Generate alternative name
        const dir = path.dirname(restorePath);
        const ext = path.extname(restorePath);
        const name = path.basename(restorePath, ext);
        let counter = 1;
        
        do {
          restorePath = path.join(dir, `${name} (restored ${counter})${ext}`);
          counter++;
        } while (fs.existsSync(restorePath));
      }
      
      // Ensure restore directory exists
      const restoreDir = path.dirname(restorePath);
      if (!fs.existsSync(restoreDir)) {
        await mkdir(restoreDir, { recursive: true });
      }
      
      // Copy file from Recycle Bin (don't move, as it requires admin privileges)
      await fs.promises.copyFile(recycleBinPath, restorePath);
      
      // Log restoration
      if (this.logsService) {
        const userId = this.getUserId ? this.getUserId() : null;
        await this.logsService.info(`File restored from Recycle Bin: ${path.basename(originalPath)}`, 'deleted_files', {
          originalPath,
          restorePath,
          recycleBinPath
        }, userId);
      }
      
      return {
        success: true,
        restoredPath: restorePath
      };
    } catch (error) {
      console.error('Failed to restore from recycle bin:', error);
      throw error;
    }
  }

  /**
   * Restore a deleted file to its original location
   */
  async restoreFile(fileId, options = {}) {
    try {
      const { alternativePath = null, recycleBinPath = null, originalPath = null } = options;
      
      // If this is a Recycle Bin file, handle it differently
      if (recycleBinPath && originalPath) {
        return await this.restoreFromRecycleBin(recycleBinPath, originalPath);
      }
      
      // Get file info from database
      const stmt = this.db.db.prepare(`
        SELECT * FROM deleted_files WHERE id = ?
      `);
      stmt.bind([fileId]);
      
      if (!stmt.step()) {
        stmt.free();
        throw new Error('Deleted file not found');
      }
      
      const fileInfo = stmt.getAsObject();
      stmt.free();
      
      // Check if trash file exists
      if (!fs.existsSync(fileInfo.trash_path)) {
        throw new Error('File not found in trash storage');
      }
      
      // Determine restore path
      let restorePath = alternativePath || fileInfo.original_path;
      
      // Check if original path is occupied
      if (fs.existsSync(restorePath)) {
        // Generate alternative name
        const dir = path.dirname(restorePath);
        const ext = path.extname(restorePath);
        const name = path.basename(restorePath, ext);
        let counter = 1;
        
        do {
          restorePath = path.join(dir, `${name} (restored ${counter})${ext}`);
          counter++;
        } while (fs.existsSync(restorePath));
      }
      
      // Ensure restore directory exists
      const restoreDir = path.dirname(restorePath);
      if (!fs.existsSync(restoreDir)) {
        await mkdir(restoreDir, { recursive: true });
      }
      
      // Move file back
      await rename(fileInfo.trash_path, restorePath);
      
      // Update database
      const updateStmt = this.db.db.prepare(`
        UPDATE deleted_files 
        SET restored = 1, restored_at = ?, restored_path = ?
        WHERE id = ?
      `);
      
      updateStmt.run([Date.now(), restorePath, fileId]);
      updateStmt.free();
      
      // Log restoration
      if (this.logsService) {
        const userId = this.getUserId ? this.getUserId() : fileInfo.user_id;
        await this.logsService.info(`File restored: ${fileInfo.original_name}`, 'deleted_files', {
          fileId,
          originalPath: fileInfo.original_path,
          restorePath
        }, userId);
      }
      
      return {
        success: true,
        restoredPath: restorePath
      };
    } catch (error) {
      console.error('Failed to restore file:', error);
      throw error;
    }
  }

  /**
   * Permanently delete a file from trash
   */
  async permanentlyDelete(fileId) {
    try {
      // Get file info
      const stmt = this.db.db.prepare(`
        SELECT * FROM deleted_files WHERE id = ?
      `);
      stmt.bind([fileId]);
      
      if (!stmt.step()) {
        stmt.free();
        throw new Error('Deleted file not found');
      }
      
      const fileInfo = stmt.getAsObject();
      stmt.free();
      
      // Delete file from trash if it exists
      if (fs.existsSync(fileInfo.trash_path)) {
        if (fileInfo.is_directory === 1) {
          // Recursively delete directory
          await this.deleteDirectoryRecursive(fileInfo.trash_path);
        } else {
          await unlink(fileInfo.trash_path);
        }
      }
      
      // Update database
      const updateStmt = this.db.db.prepare(`
        UPDATE deleted_files 
        SET permanently_deleted = 1, permanently_deleted_at = ?
        WHERE id = ?
      `);
      
      updateStmt.run([Date.now(), fileId]);
      updateStmt.free();
      
      // Log permanent deletion
      if (this.logsService) {
        const userId = this.getUserId ? this.getUserId() : fileInfo.user_id;
        await this.logsService.info(`File permanently deleted: ${fileInfo.original_name}`, 'deleted_files', {
          fileId,
          originalPath: fileInfo.original_path,
          size: fileInfo.size
        }, userId);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Failed to permanently delete file:', error);
      throw error;
    }
  }

  /**
   * Recursively delete a directory
   */
  async deleteDirectoryRecursive(dirPath) {
    if (fs.existsSync(dirPath)) {
      const files = await readdir(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await stat(filePath);
        
        if (stats.isDirectory()) {
          await this.deleteDirectoryRecursive(filePath);
        } else {
          await unlink(filePath);
        }
      }
      
      fs.rmdirSync(dirPath);
    }
  }

  /**
   * Get statistics about deleted files (includes Recycle Bin)
   */
  async getStatistics(userId = null) {
    try {
      let query = `
        SELECT 
          COUNT(*) as total_count,
          SUM(size) as total_size,
          file_type,
          COUNT(*) as type_count
        FROM deleted_files
        WHERE restored = 0 AND permanently_deleted = 0
      `;
      const params = [];
      
      if (userId) {
        query += ` AND user_id = ?`;
        params.push(userId);
      }
      
      query += ` GROUP BY file_type`;
      
      const stmt = this.db.db.prepare(query);
      stmt.bind(params);
      
      const stats = {
        totalCount: 0,
        totalSize: 0,
        byType: {},
        folders: 0
      };
      
      while (stmt.step()) {
        const row = stmt.getAsObject();
        stats.byType[row.file_type] = {
          count: row.type_count,
          size: row.total_size || 0
        };
        stats.totalCount += row.type_count;
        stats.totalSize += row.total_size || 0;
      }
      stmt.free();
      
      // Add Recycle Bin files to statistics
      const recycleBinFiles = await this.getRecycleBinFiles();
      
      console.log(`Adding ${recycleBinFiles.length} Recycle Bin files to statistics`);
      
      for (const file of recycleBinFiles) {
        stats.totalCount++;
        stats.totalSize += file.size || 0;
        
        if (file.isDirectory) {
          stats.folders++;
        }
        
        const type = file.type || 'other';
        if (!stats.byType[type]) {
          stats.byType[type] = { count: 0, size: 0 };
        }
        stats.byType[type].count++;
        stats.byType[type].size += file.size || 0;
      }
      
      console.log('Final statistics:', stats);
      
      return stats;
    } catch (error) {
      console.error('Failed to get statistics:', error);
      throw error;
    }
  }

  /**
   * Permanently delete a file from Windows Recycle Bin
   */
  async permanentlyDeleteFromRecycleBin(recycleBinPath) {
    try {
      if (!fs.existsSync(recycleBinPath)) {
        return { success: false, error: 'File not found in Recycle Bin' };
      }

      // Get the $I metadata file path
      const dirPath = path.dirname(recycleBinPath);
      const fileName = path.basename(recycleBinPath);
      const identifier = fileName.substring(2); // Remove $R prefix
      const metaPath = path.join(dirPath, `$I${identifier}`);

      // Delete the actual file
      const stats = await stat(recycleBinPath);
      if (stats.isDirectory()) {
        await this.deleteDirectoryRecursive(recycleBinPath);
      } else {
        await unlink(recycleBinPath);
      }

      // Delete the metadata file if it exists
      if (fs.existsSync(metaPath)) {
        await unlink(metaPath);
      }

      console.log(`Permanently deleted from Recycle Bin: ${recycleBinPath}`);

      // Log the deletion
      if (this.logsService) {
        const userId = this.getUserId ? this.getUserId() : null;
        await this.logsService.info(`File permanently deleted from Recycle Bin`, 'deleted_files', {
          recycleBinPath
        }, userId);
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to permanently delete from Recycle Bin:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Empty the entire Windows Recycle Bin using PowerShell
   */
  async emptyWindowsRecycleBin() {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: 'This operation is only supported on Windows' };
      }

      // Use PowerShell to empty the Recycle Bin
      // The -Force flag prevents confirmation prompts
      const command = 'powershell.exe -NoProfile -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"';
      
      await execPromise(command);
      
      console.log('Windows Recycle Bin emptied successfully');

      // Log the action
      if (this.logsService) {
        const userId = this.getUserId ? this.getUserId() : null;
        await this.logsService.info('Windows Recycle Bin emptied', 'deleted_files', {}, userId);
      }

      return { success: true, message: 'Windows Recycle Bin emptied successfully' };
    } catch (error) {
      console.error('Failed to empty Windows Recycle Bin:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Empty trash (permanently delete all - includes both internal trash and Recycle Bin)
   */
  async emptyTrash(includeRecycleBin = true) {
    try {
      const files = await this.getDeletedFiles();
      let deleted = 0;
      let recycleBinDeleted = 0;
      
      // Delete internal trash files
      const internalFiles = files.filter(f => f.source === 'internal-trash' && f.id);
      
      for (const file of internalFiles) {
        try {
          await this.permanentlyDelete(file.id);
          deleted++;
        } catch (error) {
          console.error(`Failed to delete file ${file.id}:`, error);
        }
      }

      // Also empty Windows Recycle Bin if requested
      if (includeRecycleBin && process.platform === 'win32') {
        const recycleBinResult = await this.emptyWindowsRecycleBin();
        if (recycleBinResult.success) {
          const recycleBinFiles = files.filter(f => f.source === 'recycle-bin');
          recycleBinDeleted = recycleBinFiles.length;
        }
      }
      
      const totalDeleted = deleted + recycleBinDeleted;
      
      return {
        success: true,
        deletedCount: totalDeleted,
        internalDeleted: deleted,
        recycleBinDeleted: recycleBinDeleted,
        message: totalDeleted > 0 
          ? `Deleted ${totalDeleted} files (${deleted} from internal trash, ${recycleBinDeleted} from Recycle Bin).`
          : 'No files to delete.'
      };
    } catch (error) {
      console.error('Failed to empty trash:', error);
      throw error;
    }
  }
}

module.exports = DeletedFilesService;
