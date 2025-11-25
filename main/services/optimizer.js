/**
 * Optimization Service
 * Provides system optimization features: clear temp/cache, end processes, free memory
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const kill = require('tree-kill');

const execAsync = promisify(exec);

class OptimizerService {
  constructor() {
    this.optimizationLog = [];
  }

  /**
   * Run full system optimization
   * @returns {Promise<Object>} Optimization results
   */
  async optimizeSystem() {
    const results = {
      timestamp: Date.now(),
      actions: [],
      spaceSaved: 0,
      processesEnded: 0,
      errors: [],
      success: false // Will be set to true if at least one action succeeds
    };

    try {
      console.log('Starting system optimization...');
      
      // 1. Clear temp files
      try {
        const tempResult = await this.clearTempFiles();
        results.actions.push(tempResult);
        results.spaceSaved += tempResult.spaceSaved || 0;
        console.log('Temp files cleanup:', tempResult.status);
      } catch (err) {
        console.error('Temp file cleanup error:', err);
        results.actions.push({
          action: 'Clear Temp Files',
          status: 'error',
          message: 'Failed to clear temp files: ' + err.message
        });
        results.errors.push('Temp files: ' + err.message);
      }

      // 2. Clear app cache
      try {
        const cacheResult = await this.clearAppCache();
        results.actions.push(cacheResult);
        results.spaceSaved += cacheResult.spaceSaved || 0;
        console.log('Cache cleanup:', cacheResult.status);
      } catch (err) {
        console.error('Cache cleanup error:', err);
        results.actions.push({
          action: 'Clear App Cache',
          status: 'error',
          message: 'Failed to clear cache: ' + err.message
        });
        results.errors.push('Cache: ' + err.message);
      }

      // 3. Clear browser caches (optional, requires user consent)
      // Skipping for now to avoid data loss

      // 4. Run garbage collection if available
      try {
        if (global.gc) {
          global.gc();
          results.actions.push({
            action: 'Garbage Collection',
            status: 'success',
            message: 'Memory garbage collection executed'
          });
          console.log('Garbage collection: success');
        } else {
          results.actions.push({
            action: 'Garbage Collection',
            status: 'skipped',
            message: 'Garbage collection not available (requires --expose-gc flag)'
          });
          console.log('Garbage collection: skipped (not available)');
        }
      } catch (err) {
        console.error('Garbage collection error:', err);
        results.actions.push({
          action: 'Garbage Collection',
          status: 'error',
          message: 'Failed to run garbage collection: ' + err.message
        });
      }

      // Determine overall success - be more lenient with success criteria
      const successfulActions = results.actions.filter(a => a.status === 'success' || a.status === 'warning');
      const failedActions = results.actions.filter(a => a.status === 'error');
      const skippedActions = results.actions.filter(a => a.status === 'skipped');
      
      // Consider success if:
      // 1. At least one action succeeded, OR
      // 2. No critical errors occurred (all are skipped/warning), OR
      // 3. Some space was saved regardless of individual action status
      const hasSuccessfulAction = successfulActions.length > 0;
      const noCriticalErrors = failedActions.length === 0;
      const achievedSomething = results.spaceSaved > 0;
      
      results.success = hasSuccessfulAction || noCriticalErrors || achievedSomething;
      
      // Add summary message
      if (results.success) {
        if (results.spaceSaved > 0) {
          results.summary = `Successfully freed ${this.formatBytes(results.spaceSaved)}`;
        } else if (noCriticalErrors) {
          results.summary = 'System is already optimized';
        } else {
          results.summary = 'Optimization completed';
        }
      } else {
        results.summary = 'Optimization encountered errors';
      }
      
      console.log('Optimization completed:', {
        success: results.success,
        summary: results.summary,
        actionsCompleted: results.actions.length,
        successfulActions: successfulActions.length,
        failedActions: failedActions.length,
        spaceSaved: this.formatBytes(results.spaceSaved),
        errors: results.errors.length
      });

      this.optimizationLog.push(results);
      return results;
      
    } catch (error) {
      console.error('Critical optimization error:', error);
      results.errors.push(error.message);
      results.success = false;
      results.actions.push({
        action: 'System Optimization',
        status: 'error',
        message: 'Critical error: ' + error.message
      });
      return results;
    }
  }

  /**
   * Clear system temporary files
   * @returns {Promise<Object>} Result of temp file cleanup
   */
  async clearTempFiles() {
    const result = {
      action: 'Clear Temp Files',
      status: 'pending',
      spaceSaved: 0,
      filesDeleted: 0,
      errors: []
    };

    try {
      const tempDir = os.tmpdir();
      const files = await fs.readdir(tempDir);

      for (const file of files) {
        try {
          const filePath = path.join(tempDir, file);
          const stats = await fs.stat(filePath);
          
          // Only delete files older than 1 day to avoid breaking running apps
          const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
          if (stats.mtimeMs < oneDayAgo) {
            const size = stats.size;
            await fs.remove(filePath);
            result.spaceSaved += size;
            result.filesDeleted++;
          }
        } catch (err) {
          // File might be in use or permission denied - skip it
          result.errors.push(`Failed to delete ${file}: ${err.message}`);
        }
      }

      result.status = 'success';
      result.message = `Cleared ${result.filesDeleted} temp files, freed ${this.formatBytes(result.spaceSaved)}`;
    } catch (error) {
      result.status = 'error';
      result.message = error.message;
    }

    return result;
  }

  /**
   * Clear Electron app cache
   * @returns {Promise<Object>} Result of cache cleanup
   */
  async clearAppCache() {
    const result = {
      action: 'Clear App Cache',
      status: 'pending',
      spaceSaved: 0,
      filesDeleted: 0,
      errors: []
    };

    try {
      const { app } = require('electron');
      const cachePath = app.getPath('cache');
      
      if (await fs.pathExists(cachePath)) {
        const files = await fs.readdir(cachePath);
        let totalSize = 0;

        // Try to delete files individually, skipping locked ones
        for (const file of files) {
          try {
            const filePath = path.join(cachePath, file);
            const stats = await fs.stat(filePath);
            
            // Skip if it's the app's own cache directory that might be locked
            if (file.includes('fortimorph-desktop') || file.includes('SharedStorage')) {
              result.errors.push(`Skipped ${file} (in use by application)`);
              continue;
            }

            const size = stats.isDirectory() 
              ? await this.getDirectorySize(filePath)
              : stats.size;
            
            await fs.remove(filePath);
            totalSize += size;
            result.filesDeleted++;
          } catch (err) {
            // Skip files that are in use or locked
            result.errors.push(`Skipped ${file}: ${err.message}`);
          }
        }

        result.spaceSaved = totalSize;
        result.status = totalSize > 0 ? 'success' : 'warning';
        result.message = totalSize > 0 
          ? `Cleared ${result.filesDeleted} cache items, freed ${this.formatBytes(totalSize)}`
          : 'Some cache files are in use and cannot be deleted';
      } else {
        result.status = 'success';
        result.message = 'No cache to clear';
      }
    } catch (error) {
      result.status = 'error';
      result.message = error.message;
    }

    return result;
  }

  /**
   * End a process by PID
   * @param {number} pid - Process ID to terminate
   * @param {boolean} force - Force kill if true
   * @returns {Promise<Object>} Result of process termination
   */
  async endProcess(pid, force = false) {
    return new Promise((resolve) => {
      const signal = force ? 'SIGKILL' : 'SIGTERM';
      
      kill(pid, signal, (err) => {
        if (err) {
          resolve({
            success: false,
            pid,
            message: err.message
          });
        } else {
          resolve({
            success: true,
            pid,
            message: `Process ${pid} and its children terminated successfully`
          });
        }
      });
    });
  }

  /**
   * End all processes by name (e.g., kill all Chrome processes)
   * @param {string} processName - Name of the process to terminate
   * @returns {Promise<Object>} Result of process termination
   */
  async endProcessByName(processName) {
    try {
      // On Windows, use taskkill with spawn to avoid shell quoting issues
      if (process.platform === 'win32') {
        return new Promise((resolve) => {
          const { spawn } = require('child_process');
          const taskkill = spawn('taskkill', ['/F', '/IM', processName, '/T'], {
            windowsHide: true
          });
          
          let stdout = '';
          let stderr = '';
          
          taskkill.stdout.on('data', (data) => { stdout += data.toString(); });
          taskkill.stderr.on('data', (data) => { stderr += data.toString(); });
          
          const timeout = setTimeout(() => {
            taskkill.kill();
            resolve({
              success: false,
              processName,
              message: `Timeout while terminating "${processName}"`
            });
          }, 5000);
          
          taskkill.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
              resolve({
                success: true,
                processName,
                message: `All processes matching "${processName}" terminated successfully`,
                output: stdout
              });
            } else if (stderr.includes('not found') || stdout.includes('not found') || code === 128) {
              resolve({
                success: true,
                processName,
                message: `No processes found matching "${processName}"`,
                alreadyTerminated: true
              });
            } else {
              resolve({
                success: false,
                processName,
                message: `Failed to terminate "${processName}": ${stderr || stdout || 'Unknown error'}`
              });
            }
          });
          
          taskkill.on('error', (err) => {
            clearTimeout(timeout);
            resolve({
              success: false,
              processName,
              message: `Failed to terminate "${processName}": ${err.message}`
            });
          });
        });
      } else {
        // On Unix-like systems, use pkill
        const { stdout, stderr } = await execAsync(`pkill -9 "${processName}"`, {
          timeout: 5000
        });
        
        return {
          success: true,
          processName,
          message: `All processes matching "${processName}" terminated successfully`,
          output: stdout
        };
      }
    } catch (error) {
      // taskkill returns error code if no process found, but that's okay
      if (error.message.includes('not found') || error.message.includes('No tasks')) {
        return {
          success: true,
          processName,
          message: `No processes found matching "${processName}"`,
          alreadyTerminated: true
        };
      }
      
      return {
        success: false,
        processName,
        message: `Failed to terminate "${processName}": ${error.message}`
      };
    }
  }

  /**
   * End multiple processes
   * @param {Array<number>} pids - Array of process IDs
   * @returns {Promise<Array>} Results for each process
   */
  async endProcesses(pids) {
    const results = await Promise.all(
      pids.map(pid => this.endProcess(pid, false))
    );
    return results;
  }

  /**
   * Clear Windows prefetch (requires admin on Windows)
   * @returns {Promise<Object>} Result of prefetch cleanup
   */
  async clearPrefetch() {
    if (os.platform() !== 'win32') {
      return {
        action: 'Clear Prefetch',
        status: 'skipped',
        message: 'Only available on Windows'
      };
    }

    const result = {
      action: 'Clear Prefetch',
      status: 'pending',
      spaceSaved: 0,
      message: ''
    };

    try {
      const prefetchPath = 'C:\\Windows\\Prefetch';
      
      if (await fs.pathExists(prefetchPath)) {
        const sizeBefore = await this.getDirectorySize(prefetchPath);
        
        // Use Windows command to delete prefetch files
        await execAsync('del /q /f /s %WINDIR%\\Prefetch\\*', { shell: 'cmd.exe' });
        
        result.spaceSaved = sizeBefore;
        result.status = 'success';
        result.message = `Cleared prefetch, freed ${this.formatBytes(sizeBefore)}`;
      }
    } catch (error) {
      result.status = 'error';
      result.message = `Requires administrator privileges: ${error.message}`;
    }

    return result;
  }

  /**
   * Get quick optimization suggestions based on current system state
   * @param {Object} metrics - Current system metrics
   * @returns {Array} Array of optimization suggestions
   */
  getOptimizationSuggestions(metrics) {
    const suggestions = [];

    // High CPU usage
    if (parseFloat(metrics.cpu.currentLoad) > 80) {
      suggestions.push({
        type: 'cpu',
        severity: 'high',
        title: 'High CPU Usage',
        message: 'Your CPU usage is over 80%. Consider closing some applications.',
        action: 'view_processes'
      });
    }

    // High memory usage
    if (parseFloat(metrics.memory.usagePercent) > 85) {
      suggestions.push({
        type: 'memory',
        severity: 'high',
        title: 'High Memory Usage',
        message: 'Your RAM is almost full. Consider closing memory-heavy applications.',
        action: 'optimize_memory'
      });
    }

    // Low disk space
    const primaryDisk = metrics.disk[0];
    if (primaryDisk && primaryDisk.use > 90) {
      suggestions.push({
        type: 'disk',
        severity: 'critical',
        title: 'Low Disk Space',
        message: `Your ${primaryDisk.mount} drive is ${primaryDisk.use}% full. Consider cleaning up files.`,
        action: 'clear_temp'
      });
    }

    return suggestions;
  }

  /**
   * Get directory size recursively
   * @private
   */
  async getDirectorySize(dirPath) {
    try {
      let totalSize = 0;
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        try {
          const filePath = path.join(dirPath, file);
          const stats = await fs.stat(filePath);

          if (stats.isDirectory()) {
            totalSize += await this.getDirectorySize(filePath);
          } else {
            totalSize += stats.size;
          }
        } catch (err) {
          // Skip files we can't access
          continue;
        }
      }

      return totalSize;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Format bytes to human-readable string
   * @private
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Get optimization history
   * @returns {Array} Recent optimization logs
   */
  getOptimizationHistory() {
    return this.optimizationLog.slice(-10); // Last 10 optimizations
  }
}

// Export singleton instance
module.exports = new OptimizerService();
