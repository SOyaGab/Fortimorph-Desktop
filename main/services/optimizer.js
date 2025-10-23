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
      errors: []
    };

    try {
      // 1. Clear temp files
      const tempResult = await this.clearTempFiles();
      results.actions.push(tempResult);
      results.spaceSaved += tempResult.spaceSaved || 0;

      // 2. Clear app cache
      const cacheResult = await this.clearAppCache();
      results.actions.push(cacheResult);
      results.spaceSaved += cacheResult.spaceSaved || 0;

      // 3. Clear browser caches (optional, requires user consent)
      // Skipping for now to avoid data loss

      // 4. Run garbage collection if available
      if (global.gc) {
        global.gc();
        results.actions.push({
          action: 'Garbage Collection',
          status: 'success',
          message: 'Memory garbage collection executed'
        });
      }

      this.optimizationLog.push(results);
      return results;
    } catch (error) {
      console.error('Optimization error:', error);
      results.errors.push(error.message);
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
      message: ''
    };

    try {
      const { app } = require('electron');
      const cachePath = app.getPath('cache');
      
      if (await fs.pathExists(cachePath)) {
        const sizeBefore = await this.getDirectorySize(cachePath);
        await fs.emptyDir(cachePath);
        result.spaceSaved = sizeBefore;
        result.status = 'success';
        result.message = `Cleared app cache, freed ${this.formatBytes(sizeBefore)}`;
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
            message: `Process ${pid} terminated successfully`
          });
        }
      });
    });
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
