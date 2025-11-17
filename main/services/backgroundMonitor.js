/**
 * Background Battery Monitor Service
 * Runs independently to collect battery/process data even when FortiMorph UI is closed
 * Uses Windows Task Scheduler for persistent background operation
 */

const si = require('systeminformation');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

class BackgroundMonitor {
  constructor(dbService) {
    this.db = dbService;
    this.isRunning = false;
    this.monitorInterval = null;
    this.dataCollectionInterval = 8000; // 8 seconds (same as main service)
    this.processTracking = new Map();
    this.lastUpdate = Date.now();
    
    // Performance optimization
    this.batchQueue = [];
    this.batchSize = 10; // Batch database writes
    this.batchTimer = null;
    
    // Health tracking
    this.errorCount = 0;
    this.maxErrors = 5;
    this.lastSuccessTime = Date.now();
  }

  /**
   * Start background monitoring
   */
  async start() {
    if (this.isRunning) {
      console.log('[Background Monitor] Already running');
      return;
    }

    console.log('[Background Monitor] Starting...');
    this.isRunning = true;
    this.lastSuccessTime = Date.now();
    
    // Initial data collection
    await this.collectData();
    
    // Set up periodic collection (8 seconds)
    this.monitorInterval = setInterval(async () => {
      try {
        await this.collectData();
        this.errorCount = 0; // Reset on success
        this.lastSuccessTime = Date.now();
      } catch (error) {
        this.errorCount++;
        console.error('[Background Monitor] Error:', error.message);
        
        // Stop if too many errors
        if (this.errorCount >= this.maxErrors) {
          console.error('[Background Monitor] Too many errors, stopping...');
          this.stop();
        }
      }
    }, this.dataCollectionInterval);

    console.log('[Background Monitor] Started successfully');
  }

  /**
   * Stop background monitoring
   */
  stop() {
    if (!this.isRunning) return;

    console.log('[Background Monitor] Stopping...');
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Flush any remaining batch data
    this.flushBatchQueue();

    this.isRunning = false;
    console.log('[Background Monitor] Stopped');
  }

  /**
   * Collect battery and process data
   * Optimized to minimize system impact
   */
  async collectData() {
    try {
      const now = Date.now();

      // Get current processes (lightweight query)
      const processes = await si.processes();
      
      if (!processes || !processes.list || processes.list.length === 0) {
        return;
      }

      // Filter relevant processes (only apps using significant resources)
      const relevantProcesses = processes.list.filter(proc => 
        proc.cpu > 0.1 || proc.mem > 0.1 // Only track if CPU > 0.1% or RAM > 0.1%
      );

      // Update tracking
      for (const proc of relevantProcesses) {
        const pid = proc.pid;
        const name = proc.name || 'Unknown';
        const command = proc.command || name;

        if (!this.processTracking.has(pid)) {
          // New process
          this.processTracking.set(pid, {
            name,
            command,
            startTime: now,
            totalCpu: proc.cpu,
            totalMem: proc.mem,
            samples: 1,
            peakCpu: proc.cpu,
            peakMem: proc.mem
          });
        } else {
          // Existing process - update
          const data = this.processTracking.get(pid);
          data.totalCpu += proc.cpu;
          data.totalMem += proc.mem;
          data.samples++;
          data.peakCpu = Math.max(data.peakCpu, proc.cpu);
          data.peakMem = Math.max(data.peakMem, proc.mem);
        }

        // Add to batch queue for database write
        this.addToBatchQueue({
          pid,
          name,
          command,
          cpu: proc.cpu,
          memory: proc.mem,
          timestamp: now
        });
      }

      // Clean up dead processes (not seen in last scan)
      const currentPids = new Set(relevantProcesses.map(p => p.pid));
      for (const [pid, data] of this.processTracking.entries()) {
        if (!currentPids.has(pid)) {
          // Process ended - could save final stats if needed
          this.processTracking.delete(pid);
        }
      }

      // Limit tracking map size to prevent memory issues
      if (this.processTracking.size > 200) {
        // Remove oldest entries
        const entries = Array.from(this.processTracking.entries());
        entries.sort((a, b) => a[1].startTime - b[1].startTime);
        const toRemove = entries.slice(0, 50);
        toRemove.forEach(([pid]) => this.processTracking.delete(pid));
      }

    } catch (error) {
      console.error('[Background Monitor] Data collection error:', error.message);
      throw error;
    }
  }

  /**
   * Add data to batch queue for efficient database writes
   */
  addToBatchQueue(data) {
    this.batchQueue.push(data);

    // Write batch when size threshold reached
    if (this.batchQueue.length >= this.batchSize) {
      this.flushBatchQueue();
    } else if (!this.batchTimer) {
      // Or write after 30 seconds (whichever comes first)
      this.batchTimer = setTimeout(() => {
        this.flushBatchQueue();
      }, 30000);
    }
  }

  /**
   * Write batched data to database
   * Optimized to minimize I/O operations
   */
  flushBatchQueue() {
    if (this.batchQueue.length === 0) return;

    try {
      // Get current user ID (or null for system-wide tracking)
      const userId = this.getCurrentUserId();

      // Aggregate data by app name to reduce writes
      const aggregated = new Map();
      
      for (const item of this.batchQueue) {
        const key = item.name;
        if (!aggregated.has(key)) {
          aggregated.set(key, {
            name: item.name,
            command: item.command,
            totalCpu: 0,
            totalMem: 0,
            samples: 0,
            timestamp: item.timestamp
          });
        }
        const agg = aggregated.get(key);
        agg.totalCpu += item.cpu;
        agg.totalMem += item.memory;
        agg.samples++;
      }

      // Write aggregated data to database
      for (const [name, data] of aggregated.entries()) {
        const avgCpu = data.samples > 0 ? data.totalCpu / data.samples : 0;
        const avgMem = data.samples > 0 ? data.totalMem / data.samples : 0;
        const batteryImpact = (avgCpu * 0.5) + (avgMem * 0.1);

        this.db.saveAppUsage({
          userId: userId,
          appName: name,
          appCommand: data.command,
          cpu: avgCpu,
          memory: avgMem,
          batteryImpact: batteryImpact,
          timestamp: data.timestamp
        });
      }

      console.log(`[Background Monitor] Flushed ${this.batchQueue.length} items (${aggregated.size} apps)`);
      
      // Clear batch
      this.batchQueue = [];
      
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }

    } catch (error) {
      console.error('[Background Monitor] Batch flush error:', error.message);
      // Don't throw - just log and continue
    }
  }

  /**
   * Get current user ID for data isolation
   */
  getCurrentUserId() {
    try {
      // Try to get current logged-in user from database
      const currentUser = this.db.getCurrentUser();
      return currentUser ? currentUser.id : null;
    } catch (error) {
      return null; // System-wide tracking if no user
    }
  }

  /**
   * Get monitor health status
   */
  getHealthStatus() {
    const now = Date.now();
    const timeSinceLastSuccess = now - this.lastSuccessTime;
    const isHealthy = this.isRunning && timeSinceLastSuccess < 60000; // Healthy if updated within 1 min

    return {
      isRunning: this.isRunning,
      isHealthy,
      errorCount: this.errorCount,
      lastSuccessTime: new Date(this.lastSuccessTime).toLocaleString(),
      timeSinceLastSuccess: Math.round(timeSinceLastSuccess / 1000) + 's',
      processesTracked: this.processTracking.size,
      batchQueueSize: this.batchQueue.length
    };
  }
}

module.exports = BackgroundMonitor;
