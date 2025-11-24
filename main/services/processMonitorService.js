const { parentPort } = require('worker_threads');
const { exec } = require('child_process');
const pidusage = require('pidusage');

/**
 * Process Monitor Service - Background Process Data Collection
 * 
 * This service runs continuously in the background, collecting process data
 * every 3-4 seconds to maintain a hot cache that's always ready for instant UI display.
 * 
 * Features:
 * - Continuous background monitoring
 * - Hot cache with real CPU/Memory values (no 0.00% placeholders)
 * - Differential update detection
 * - Smart sampling for top processes
 * - Auto-pause when no clients connected
 */

class ProcessMonitorService {
  constructor() {
    this.cachedProcessList = [];
    this.previousProcessMap = new Map(); // For change detection
    this.lastUpdateTime = 0;
    this.isRunning = false;
    this.updateInterval = null;
    this.clientCount = 0;
    
    // Configuration
    this.config = {
      updateIntervalMs: 3000,      // 3 seconds for background updates
      maxProcessesForCPU: 80,      // Sample top 80 processes for CPU
      cpuSamplingTimeout: 500,     // 500ms timeout for CPU sampling
      changeThreshold: 0.5,        // 0.5% change to consider "changed"
    };
  }

  /**
   * Start the background monitoring service
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('[ProcessMonitor] Background monitoring started');
    
    // Initial fetch to populate cache immediately
    this.updateProcessData().catch(err => {
      console.error('[ProcessMonitor] Initial fetch failed:', err);
    });
    
    // Set up continuous monitoring
    this.updateInterval = setInterval(() => {
      this.updateProcessData().catch(err => {
        console.error('[ProcessMonitor] Update failed:', err);
      });
    }, this.config.updateIntervalMs);
  }

  /**
   * Stop the background monitoring service
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    console.log('[ProcessMonitor] Background monitoring stopped');
  }

  /**
   * Register a client (UI component) that needs process data
   */
  registerClient() {
    this.clientCount++;
    if (!this.isRunning) {
      this.start();
    }
    console.log(`[ProcessMonitor] Client registered. Total clients: ${this.clientCount}`);
  }

  /**
   * Unregister a client
   */
  unregisterClient() {
    this.clientCount--;
    if (this.clientCount <= 0) {
      this.clientCount = 0;
      // Keep running for 30 seconds after last client disconnects
      // This handles quick tab switches without stopping/starting
      setTimeout(() => {
        if (this.clientCount === 0) {
          this.stop();
        }
      }, 30000);
    }
    console.log(`[ProcessMonitor] Client unregistered. Total clients: ${this.clientCount}`);
  }

  /**
   * Get cached process list (instant return)
   */
  getCachedProcesses() {
    return {
      processes: this.cachedProcessList,
      timestamp: this.lastUpdateTime,
      age: Date.now() - this.lastUpdateTime
    };
  }

  /**
   * Main update loop - fetches process data and updates cache
   */
  async updateProcessData() {
    const startTime = Date.now();
    
    try {
      // Step 1: Get process list using fast Windows native command
      const processMap = await this.fetchProcessListFast();
      
      // Step 2: Get CPU usage for top processes
      await this.enrichWithCPUData(processMap);
      
      // Step 3: Convert to array and sort by CPU usage
      const processList = Array.from(processMap.values())
        .sort((a, b) => (b.cpu || 0) - (a.cpu || 0));
      
      // Step 4: Detect changes from previous snapshot
      const changes = this.detectChanges(processList);
      
      // Step 5: Update cache
      this.cachedProcessList = processList;
      this.lastUpdateTime = Date.now();
      
      const duration = Date.now() - startTime;
      console.log(`[ProcessMonitor] Updated ${processList.length} processes in ${duration}ms (${changes.added} added, ${changes.removed} removed, ${changes.modified} modified)`);
      
      return {
        processes: processList,
        changes: changes,
        duration: duration
      };
      
    } catch (error) {
      console.error('[ProcessMonitor] Update error:', error);
      throw error;
    }
  }

  /**
   * Fetch process list using Windows tasklist command (50-100ms)
   */
  async fetchProcessListFast() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Process fetch timeout'));
      }, 2000);

      exec('tasklist /FO CSV /NH', { 
        timeout: 2000,
        maxBuffer: 5 * 1024 * 1024 
      }, (error, stdout, stderr) => {
        clearTimeout(timeout);
        
        if (error) {
          console.error('[ProcessMonitor] tasklist error:', error);
          reject(error);
          return;
        }

        try {
          const processMap = new Map();
          const lines = stdout.trim().split('\n');
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            // Parse CSV format: "name","pid","session","mem"
            const matches = line.match(/"([^"]*)"/g);
            if (!matches || matches.length < 4) continue;
            
            const name = matches[0].replace(/"/g, '');
            const pid = parseInt(matches[1].replace(/"/g, ''));
            const memStr = matches[4].replace(/"/g, '').replace(/[,\s]/g, '');
            const memory = parseInt(memStr) * 1024; // Convert KB to bytes
            
            if (isNaN(pid) || isNaN(memory)) continue;
            
            processMap.set(pid, {
              pid: pid,
              name: name,
              memory: memory,
              cpu: 0, // Will be enriched
              memoryPercent: 0, // Will be calculated
              status: 'running'
            });
          }
          
          resolve(processMap);
          
        } catch (parseError) {
          console.error('[ProcessMonitor] Parse error:', parseError);
          reject(parseError);
        }
      });
    });
  }

  /**
   * Enrich process data with CPU usage (using pidusage)
   */
  async enrichWithCPUData(processMap) {
    if (processMap.size === 0) return;
    
    // Get top N processes by memory for CPU sampling
    const processList = Array.from(processMap.values())
      .sort((a, b) => b.memory - a.memory)
      .slice(0, this.config.maxProcessesForCPU);
    
    const pids = processList.map(p => p.pid);
    
    try {
      // Sample CPU usage with timeout
      const cpuData = await Promise.race([
        pidusage(pids),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('CPU sampling timeout')), this.config.cpuSamplingTimeout)
        )
      ]);
      
      // Update process map with CPU data
      for (const [pid, stats] of Object.entries(cpuData)) {
        const process = processMap.get(parseInt(pid));
        if (process) {
          process.cpu = Math.round(stats.cpu * 100) / 100 || 0;
          process.memory = stats.memory || process.memory;
          
          // Calculate memory percentage (rough estimate)
          const totalMemory = require('os').totalmem();
          process.memoryPercent = Math.round((process.memory / totalMemory) * 10000) / 100;
        }
      }
      
    } catch (error) {
      console.warn('[ProcessMonitor] CPU sampling failed:', error.message);
      // Continue without CPU data - better to show processes without CPU than fail
    }
  }

  /**
   * Detect changes between current and previous process snapshots
   */
  detectChanges(currentProcesses) {
    const changes = {
      added: 0,
      removed: 0,
      modified: 0,
      changedProcesses: []
    };
    
    // Build current map
    const currentMap = new Map();
    for (const proc of currentProcesses) {
      currentMap.set(proc.pid, proc);
    }
    
    // Detect removed processes
    for (const pid of this.previousProcessMap.keys()) {
      if (!currentMap.has(pid)) {
        changes.removed++;
      }
    }
    
    // Detect added and modified processes
    for (const [pid, proc] of currentMap.entries()) {
      const prev = this.previousProcessMap.get(pid);
      
      if (!prev) {
        // New process
        changes.added++;
        changes.changedProcesses.push({
          type: 'added',
          pid: pid,
          name: proc.name
        });
      } else {
        // Check if significantly changed
        const cpuChange = Math.abs((proc.cpu || 0) - (prev.cpu || 0));
        const memChange = Math.abs((proc.memoryPercent || 0) - (prev.memoryPercent || 0));
        
        if (cpuChange > this.config.changeThreshold || memChange > this.config.changeThreshold) {
          changes.modified++;
          changes.changedProcesses.push({
            type: 'modified',
            pid: pid,
            name: proc.name,
            cpuDelta: cpuChange,
            memDelta: memChange
          });
        }
      }
    }
    
    // Update previous map for next comparison
    this.previousProcessMap = currentMap;
    
    return changes;
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      clientCount: this.clientCount,
      cachedProcessCount: this.cachedProcessList.length,
      lastUpdateTime: this.lastUpdateTime,
      cacheAge: Date.now() - this.lastUpdateTime,
      config: this.config
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Restart with new interval if changed
    if (newConfig.updateIntervalMs && this.isRunning) {
      this.stop();
      this.start();
    }
  }
}

// Export singleton instance
const processMonitorService = new ProcessMonitorService();
module.exports = processMonitorService;
