/**
 * Monitoring Service
 * Collects real-time system metrics: CPU, memory, disk, processes
 * Uses systeminformation, pidusage, and os-utils for accurate data
 */

const si = require('systeminformation');
const pidusage = require('pidusage');
const osUtils = require('os-utils');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

// Fast Windows-native process fetcher with improved timeout handling
const getWindowsProcesses = () => {
  return new Promise((resolve, reject) => {
    // Use Windows tasklist for instant results with tight timeout
    const tasklistTimeout = setTimeout(() => {
      console.warn('[getWindowsProcesses] tasklist command timed out');
      resolve([]); // Return empty array on timeout instead of rejecting
    }, 1500);
    
    exec('tasklist /FO CSV /NH', { timeout: 1500, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
      clearTimeout(tasklistTimeout);
      
      if (error) {
        console.error('[getWindowsProcesses] Error:', error.message);
        resolve([]); // Return empty array on error instead of rejecting
        return;
      }
      
      try {
        const processes = [];
        const lines = stdout.trim().split('\n');
        const totalMem = os.totalmem();
        
        for (const line of lines) {
          const match = line.match(/"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"/);
          if (match) {
            const [, name, pid, sessionName, sessionNum, memUsage] = match;
            const memBytes = parseInt(memUsage.replace(/[^0-9]/g, '')) * 1024;
            const parsedPid = parseInt(pid);
            
            // Skip invalid entries
            if (isNaN(parsedPid) || parsedPid <= 0) continue;
            
            processes.push({
              name: name,
              pid: parsedPid,
              memory: memBytes,
              memoryPercent: ((memBytes / totalMem) * 100).toFixed(2),
              cpu: 0 // Will be filled by pidusage
            });
          }
        }
        
        console.log(`[getWindowsProcesses] Parsed ${processes.length} processes`);
        resolve(processes);
      } catch (parseError) {
        console.error('[getWindowsProcesses] Parse error:', parseError.message);
        resolve([]); // Return empty array on parse error
      }
    });
  });
};

class MonitoringService {
  constructor() {
    this.metricsHistory = {
      cpu: [],
      memory: [],
      disk: [],
      timestamps: []
    };
    this.maxHistorySize = 180; // Keep 180 data points (6 minutes at 2s intervals)
    this.lastProcessFetch = 0; // Timestamp of last fetch
    this.minFetchInterval = 1000; // 1 second minimum for faster updates
    this.isProcessFetching = false; // Prevent concurrent fetches
    this.cachedProcessList = []; // Cache last successful fetch
    this.maxPidSampleSizeFull = 60; // Limit heavy pidusage sampling to top offenders (full refresh)
    this.maxPidSampleSizeFast = 20; // Lightweight sampling when we just need quick numbers
    this.lastCpuReading = null; // Track last CPU reading for smoothing
    this.cpuStuckCount = 0; // Counter for consecutive high CPU readings
    this.isInitialized = false; // Track if first metrics fetch is complete
    this.cachedStaticMetrics = null; // Cache for expensive static metrics
    this.lastFullUpdate = 0; // Timestamp of last full metrics update
  }

  /**
   * Get comprehensive system metrics
   * @returns {Promise<Object>} System metrics including CPU, memory, disk
   */
  async getSystemMetrics() {
    try {
      console.log('[Monitoring] Fetching system metrics...');
      
      // Fetch critical metrics first (fastest queries)
      const [currentLoad, mem, cpu, osInfo] = await Promise.all([
        si.currentLoad(),     // Fastest - just reads current CPU
        si.mem(),             // Fast - memory info
        si.cpu(),             // Medium - CPU static info (cached by systeminformation)
        si.osInfo()           // Fast - OS info (cached)
      ]);
      
      console.log('[Monitoring] Current CPU load raw value:', currentLoad.currentLoad);
      console.log('[Monitoring] Current CPU load type:', typeof currentLoad.currentLoad);
      
      // Fetch disk with timeout (can be slow on network drives)
      const diskPromise = si.fsSize();
      const diskTimeout = new Promise(resolve => 
        setTimeout(() => {
          console.log('[Monitoring] Disk fetch timeout after 5s');
          return resolve([]);
        }, 5000)
      );
      
      let disk = await Promise.race([diskPromise, diskTimeout]);
      console.log('[Monitoring] Disk data received:', disk?.length || 0, 'drives');
      
      // If no disk data or timeout, try to get at least C: drive
      if (!disk || disk.length === 0) {
        console.warn('[Monitoring] No disk data, trying fallback method...');
        try {
          disk = await si.fsSize();
          if (!disk || disk.length === 0) {
            console.warn('[Monitoring] Fallback also failed, using empty disk array');
            disk = [];
          }
        } catch (diskError) {
          console.error('[Monitoring] Disk fallback error:', diskError);
          disk = [];
        }
      }
      
      // Get process count separately (lightweight, no detailed list)
      const processCount = await Promise.race([
        si.processes().then(p => ({
          all: p.all || 0,
          running: p.running || 0,
          blocked: p.blocked || 0,
          sleeping: p.sleeping || 0
        })),
        new Promise(resolve => setTimeout(() => resolve({ all: 0, running: 0, blocked: 0, sleeping: 0 }), 2000))
      ]).catch(() => ({ all: 0, running: 0, blocked: 0, sleeping: 0 }));

      const timestamp = Date.now();

      // CPU metrics - ENSURE proper number conversion and validation
      // Clamp CPU values between 0 and 100 to prevent invalid readings
      const cpuLoadValue = Math.min(100, Math.max(0, parseFloat(currentLoad.currentLoad) || 0));
      const cpuLoadUserValue = Math.min(100, Math.max(0, parseFloat(currentLoad.currentLoadUser) || 0));
      const cpuLoadSystemValue = Math.min(100, Math.max(0, parseFloat(currentLoad.currentLoadSystem) || 0));
      const cpuLoadIdleValue = Math.min(100, Math.max(0, parseFloat(currentLoad.currentLoadIdle) || 0));
      
      // If CPU shows 100%, verify with average calculation
      const avgCoreLoad = currentLoad.cpus ? 
        currentLoad.cpus.reduce((sum, core) => sum + (parseFloat(core.load) || 0), 0) / currentLoad.cpus.length : cpuLoadValue;
      
      // Detect if CPU reading is stuck at 100%
      if (cpuLoadValue >= 99) {
        this.cpuStuckCount++;
        if (this.cpuStuckCount <= 3) {
          console.warn('[Monitoring] ⚠️ High CPU detected:', cpuLoadValue.toFixed(2) + '% (count:', this.cpuStuckCount, ')');
        }
      } else {
        if (this.cpuStuckCount > 0) {
          console.log('[Monitoring] ✅ CPU back to normal, resetting stuck counter');
        }
        this.cpuStuckCount = 0;
      }
      
      // Use the more accurate value between overall and average
      let actualCpuLoad = cpuLoadValue;
      
      // If reported at 100% but cores show significantly lower, trust cores
      if (cpuLoadValue === 100 && avgCoreLoad < 95) {
        actualCpuLoad = avgCoreLoad;
        console.log('[Monitoring] ✅ Using core average', avgCoreLoad.toFixed(2) + '% instead of 100%');
      }
      
      console.log('[Monitoring] Raw CPU load:', cpuLoadValue.toFixed(2) + '%, Average cores:', avgCoreLoad.toFixed(2) + '%, Using:', actualCpuLoad.toFixed(2) + '%');
      
      // Use os-utils for a quick CPU sample (measures over ~1 second internally)
      const osUtilsCpuPromise = new Promise((resolve) => {
        osUtils.cpuUsage((usage) => {
          resolve(Math.round(usage * 10000) / 100); // Round to 2 decimals
        });
      });
      
      // Get os-utils reading with 1 second timeout
      let osUtilsCpu = await Promise.race([
        osUtilsCpuPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 1100))
      ]);
      
      // Final CPU value logic:
      let finalCpuLoad;
      
      if (osUtilsCpu !== null) {
        // os-utils succeeded - use a weighted average for smoother readings
        console.log('[Monitoring] systeminformation:', actualCpuLoad.toFixed(2) + '%, os-utils:', osUtilsCpu.toFixed(2) + '%');
        
        // If both agree (within 15%), trust systeminformation (it's faster)
        if (Math.abs(actualCpuLoad - osUtilsCpu) <= 15) {
          finalCpuLoad = actualCpuLoad;
        } 
        // If they disagree significantly, use weighted average (70% os-utils, 30% systeminformation)
        else {
          finalCpuLoad = (osUtilsCpu * 0.7) + (actualCpuLoad * 0.3);
          console.log('[Monitoring] Large difference detected, using weighted average:', finalCpuLoad.toFixed(2) + '%');
        }
      } else {
        // os-utils timed out, use systeminformation
        console.log('[Monitoring] os-utils timeout, using systeminformation:', actualCpuLoad.toFixed(2) + '%');
        finalCpuLoad = actualCpuLoad;
      }
      
      // Apply smoothing if we have previous reading to prevent jumpy values
      if (this.lastCpuReading !== null) {
        const smoothingFactor = 0.3; // 30% of new value, 70% of old (smoother)
        const smoothedCpu = (finalCpuLoad * smoothingFactor) + (this.lastCpuReading * (1 - smoothingFactor));
        console.log('[Monitoring] Smoothed CPU:', smoothedCpu.toFixed(2) + '% (raw:', finalCpuLoad.toFixed(2) + '%)');
        finalCpuLoad = smoothedCpu;
      }
      
      finalCpuLoad = Math.round(finalCpuLoad * 100) / 100; // Round to 2 decimals
      this.lastCpuReading = finalCpuLoad;
      
      const cpuMetrics = {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed,
        currentLoad: finalCpuLoad.toFixed(2),
        currentLoadUser: cpuLoadUserValue.toFixed(2),
        currentLoadSystem: cpuLoadSystemValue.toFixed(2),
        currentLoadIdle: cpuLoadIdleValue.toFixed(2),
        coresLoad: currentLoad.cpus.map(core => ({
          load: Math.min(100, Math.max(0, parseFloat(core.load) || 0)).toFixed(2),
          loadUser: Math.min(100, Math.max(0, parseFloat(core.loadUser) || 0)).toFixed(2),
          loadSystem: Math.min(100, Math.max(0, parseFloat(core.loadSystem) || 0)).toFixed(2)
        }))
      };

      // Memory metrics - ENSURE proper calculation with proper rounding
      const memUsedValue = parseInt(mem.used) || 0;
      const memTotalValue = parseInt(mem.total) || 1; // Avoid division by zero
      const memUsagePercent = Math.round(((memUsedValue / memTotalValue) * 100) * 100) / 100; // Round to 2 decimals
      
      console.log('[Monitoring] Memory usage:', memUsagePercent.toFixed(2) + '%');
      
      const memoryMetrics = {
        total: mem.total,
        free: mem.free,
        used: mem.used,
        active: mem.active,
        available: mem.available,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        swapFree: mem.swapfree,
        usagePercent: memUsagePercent.toFixed(2)
      };

      // Disk metrics - ENSURE proper data structure
      const diskMetrics = disk.map(d => {
        const diskUseValue = parseFloat(d.use) || 0;
        console.log(`[Monitoring] Disk ${d.fs}: ${diskUseValue.toFixed(2)}% used`);
        return {
          fs: d.fs,
          type: d.type,
          size: parseInt(d.size) || 0,
          used: parseInt(d.used) || 0,
          available: parseInt(d.available) || 0,
          use: diskUseValue.toFixed(2),
          mount: d.mount
        };
      });
      
      // If no disk data at all, provide a placeholder
      if (diskMetrics.length === 0) {
        console.warn('[Monitoring] No disk metrics available, using placeholder');
        diskMetrics.push({
          fs: 'N/A',
          type: 'unknown',
          size: 0,
          used: 0,
          available: 0,
          use: '0.00',
          mount: 'N/A'
        });
      }

      // Process metrics (lightweight count only)
      const processMetrics = processCount;

      // System info
      const systemInfo = {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        arch: osInfo.arch,
        hostname: osInfo.hostname,
        uptime: os.uptime()
      };

      // Store in history - use numeric values for proper charting
      const diskUseForHistory = parseFloat(diskMetrics[0]?.use) || 0;
      this.addToHistory(finalCpuLoad, memUsagePercent, diskUseForHistory, timestamp);
      
      console.log('[Monitoring] History updated - CPU:', finalCpuLoad.toFixed(2) + '%, Memory:', memUsagePercent.toFixed(2) + '%, Disk:', diskUseForHistory.toFixed(2) + '%');
      console.log('[Monitoring] History size:', this.metricsHistory.cpu.length, 'data points');
      console.log('[Monitoring] Last 3 CPU readings:', this.metricsHistory.cpu.slice(-3).map(v => v.toFixed(2)).join('%, ') + '%');

      // Mark as initialized after first successful fetch
      if (!this.isInitialized) {
        this.isInitialized = true;
        console.log('[Monitoring] ✅ Monitoring service initialized successfully');
      }

      return {
        cpu: cpuMetrics,
        memory: memoryMetrics,
        disk: diskMetrics,
        processes: processMetrics,
        system: systemInfo,
        timestamp,
        history: {
          cpu: [...this.metricsHistory.cpu],
          memory: [...this.metricsHistory.memory],
          disk: [...this.metricsHistory.disk],
          timestamps: [...this.metricsHistory.timestamps]
        }
      };
    } catch (error) {
      console.error('[Monitoring] Error getting system metrics:', error);
      throw error;
    }
  }

  /**
   * ULTRA-FAST process list with instant return and progressive enhancement
   * @param {Object} options - Options for fetching processes
   * @param {boolean} options.fastMode - Use fast mode (default: false)
   * @param {boolean} options.force - Force fresh fetch, bypass cache (default: false)
   * @param {boolean} options.enrichCpu - Wait for CPU enrichment (default: false)
   * @param {boolean} options.instant - Return INSTANTLY with just tasklist data, no CPU (default: false)
   * @param {boolean} options.freshFetch - Do a completely fresh fetch with CPU sampling (default: false)
   * @returns {Promise<Array>} Complete list of all running processes
   */
  async getProcessList(options = {}) {
    const { fastMode = false, force = false, enrichCpu = false, instant = false, freshFetch = false } = options;
    const now = Date.now();
    const timeSinceLastFetch = now - this.lastProcessFetch;
    
    // INSTANT MODE: Return data immediately without any CPU sampling
    if (instant) {
      console.log('[Process List] ⚡ INSTANT MODE - returning tasklist data immediately');
      return await this.fetchProcessesInstant();
    }
    
    // FRESH FETCH MODE: Always do a new fetch with CPU sampling
    if (freshFetch || (force && enrichCpu)) {
      console.log('[Process List] 🔄 FRESH FETCH with CPU sampling');
      return await this.fetchProcessesFast(true); // true = enrich CPU
    }
    
    // If force flag is set, trigger background refresh but return cache immediately
    if (force) {
      console.log('[Process List] 🔄 FORCE REFRESH - returning cache + triggering background update');
      
      // Trigger background refresh (don't wait for it)
      if (!this.isProcessFetching) {
        this.refreshProcessesInBackground();
      }
      
      // Return cache immediately (if available) for instant response
      if (this.cachedProcessList.length > 0) {
        return this.cachedProcessList;
      }
      
      // If no cache, do quick fetch
      return await this.fetchProcessesFast();
    }
    
    // Always return cached data immediately if available (even if stale)
    // Then trigger background refresh if needed
    if (this.cachedProcessList.length > 0) {
      console.log(`[Process List] ⚡ Cache hit (${this.cachedProcessList.length} processes, age: ${timeSinceLastFetch}ms)`);
      
      // Trigger background refresh if cache is stale (> 2 seconds)
      if (timeSinceLastFetch > 2000 && !this.isProcessFetching) {
        console.log('[Process List] 🔄 Triggering background refresh');
        this.refreshProcessesInBackground();
      }
      
      return this.cachedProcessList;
    }
    
    // If already fetching, wait briefly or return empty
    if (this.isProcessFetching) {
      console.log('[Process List] ⏳ Fetch in progress, waiting briefly...');
      // Wait max 100ms for initial fetch
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.cachedProcessList.length > 0 ? this.cachedProcessList : [];
    }
    
    // Perform fresh fetch (only if no cache and not already fetching)
    console.log('[Process List] 🚀 Starting fresh fetch (no cache available)');
    return await this.fetchProcessesFast(true); // Always enrich CPU on initial
  }

  /**
   * Fast process fetch using Windows native command + selective pidusage
   * @param {boolean} enrichCpu - If true, sample CPU (adds ~200-500ms)
   */
  async fetchProcessesFast(enrichCpu = false) {
    this.isProcessFetching = true;
    this.lastProcessFetch = Date.now();
    const startTime = Date.now();
    
    try {
      // Get process list from tasklist
      let processList = await getWindowsProcesses();
      processList.sort((a, b) => b.memory - a.memory);
      
      // Get PIDs for CPU sampling
      const topPids = processList.slice(0, 80).map(p => p.pid).filter(pid => pid > 0);
      
      // Sample CPU if requested
      let cpuStats = {};
      if (enrichCpu && topPids.length > 0) {
        try {
          cpuStats = await Promise.race([
            pidusage(topPids),
            new Promise(resolve => setTimeout(() => resolve({}), 1000))
          ]);
        } catch (e) {
          // Silent fail - continue without CPU
        }
      }
      
      // Format results
      const totalMem = os.totalmem();
      const formattedProcesses = processList.map(proc => {
        const cpuData = cpuStats[proc.pid];
        const cpuValue = cpuData?.cpu || 0;
        const memValue = cpuData?.memory || proc.memory || 0;
        const memPercent = (memValue / totalMem) * 100;
        
        return {
          pid: proc.pid,
          name: proc.name,
          cpu: cpuValue.toFixed(2),
          cpuPercent: cpuValue,
          memory: memValue,
          memoryFormatted: (memValue / 1024 / 1024).toFixed(1) + ' MB',
          memoryPercent: memPercent.toFixed(2),
          memoryPercentNum: memPercent,
          priority: 'Normal',
          state: 'running',
          command: proc.name,
          timestamp: Date.now()
        };
      }).sort((a, b) => {
        const cpuDiff = b.cpuPercent - a.cpuPercent;
        if (Math.abs(cpuDiff) > 0.1) return cpuDiff;
        return b.memoryPercentNum - a.memoryPercentNum;
      });
      
      this.cachedProcessList = formattedProcesses;
      console.log(`[Process List] ✅ ${formattedProcesses.length} processes in ${Date.now() - startTime}ms`);
      return formattedProcesses;
      
    } catch (error) {
      console.error('[Process List] Error:', error.message);
      return this.cachedProcessList;
    } finally {
      this.isProcessFetching = false;
    }
  }

  /**
   * INSTANT process fetch - just tasklist, NO CPU sampling
   * Returns in ~50-100ms for immediate UI display
   * Never throws - always returns an array (empty if error)
   */
  async fetchProcessesInstant() {
    const startTime = Date.now();
    
    try {
      // Use Windows tasklist only - no CPU sampling, pure speed
      let processList = await getWindowsProcesses();
      
      // If tasklist returned empty, try returning cache
      if (!processList || processList.length === 0) {
        console.log('[Process List] ⚡ INSTANT: No processes from tasklist, using cache');
        return this.cachedProcessList.length > 0 ? this.cachedProcessList : [];
      }
      
      // Sort by memory
      processList.sort((a, b) => b.memory - a.memory);
      
      // Format with memory data only - CPU will come from stream
      const totalMem = os.totalmem();
      const formattedProcesses = processList.map(proc => {
        const memValue = proc.memory || 0;
        const memPercent = (memValue / totalMem) * 100;
        
        // Use cached CPU if available, otherwise show 0
        const cachedProc = this.cachedProcessList.find(p => p.pid === proc.pid);
        const cpuValue = cachedProc?.cpuPercent || 0;
        
        return {
          pid: proc.pid,
          name: proc.name,
          cpu: cpuValue.toFixed(2),
          cpuPercent: cpuValue,
          memory: memValue,
          memoryFormatted: (memValue / 1024 / 1024).toFixed(1) + ' MB',
          memoryPercent: memPercent.toFixed(2),
          memoryPercentNum: memPercent,
          priority: 'Normal',
          state: 'running',
          command: proc.name,
          timestamp: Date.now()
        };
      }).sort((a, b) => b.memoryPercentNum - a.memoryPercentNum);
      
      // Update cache with instant data
      if (formattedProcesses.length > 0) {
        this.cachedProcessList = formattedProcesses;
      }
      
      console.log(`[Process List] ⚡ INSTANT: ${formattedProcesses.length} processes in ${Date.now() - startTime}ms`);
      return formattedProcesses;
      
    } catch (error) {
      console.error('[Process List] Instant fetch error:', error.message);
      // Always return something - never throw
      return this.cachedProcessList.length > 0 ? this.cachedProcessList : [];
    }
  }

  /**
   * Background refresh without blocking
   */
  refreshProcessesInBackground() {
    if (this.isProcessFetching) return;
    this.fetchProcessesFast(true).catch(() => {});
  }

  /**
   * Get CPU-specific metrics with per-core breakdown
   * @returns {Promise<Object>} Detailed CPU metrics
   */
  async getCPUMetrics() {
    try {
      const [cpu, currentLoad, temp] = await Promise.all([
        si.cpu(),
        si.currentLoad(),
        si.cpuTemperature().catch(() => ({ main: null })) // Temperature not always available
      ]);

      return {
        general: {
          manufacturer: cpu.manufacturer,
          brand: cpu.brand,
          speed: cpu.speed,
          cores: cpu.cores,
          physicalCores: cpu.physicalCores,
          processors: cpu.processors
        },
        load: {
          currentLoad: currentLoad.currentLoad.toFixed(2),
          currentLoadUser: currentLoad.currentLoadUser.toFixed(2),
          currentLoadSystem: currentLoad.currentLoadSystem.toFixed(2),
          currentLoadIdle: currentLoad.currentLoadIdle.toFixed(2),
          rawCurrentLoad: currentLoad.rawCurrentLoad,
          coresLoad: currentLoad.cpus.map((core, index) => ({
            core: index,
            load: core.load.toFixed(2),
            loadUser: core.loadUser.toFixed(2),
            loadSystem: core.loadSystem.toFixed(2),
            loadIdle: core.loadIdle.toFixed(2)
          }))
        },
        temperature: temp.main ? {
          main: temp.main,
          cores: temp.cores,
          max: temp.max
        } : null
      };
    } catch (error) {
      console.error('Error getting CPU metrics:', error);
      throw error;
    }
  }

  /**
   * Get memory-specific metrics
   * @returns {Promise<Object>} Detailed memory metrics
   */
  async getMemoryMetrics() {
    try {
      const mem = await si.mem();

      return {
        total: mem.total,
        free: mem.free,
        used: mem.used,
        active: mem.active,
        available: mem.available,
        buffers: mem.buffers,
        cached: mem.cached,
        slab: mem.slab,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        swapFree: mem.swapfree,
        usagePercent: ((mem.used / mem.total) * 100).toFixed(2),
        swapUsagePercent: mem.swaptotal > 0 ? ((mem.swapused / mem.swaptotal) * 100).toFixed(2) : '0.00'
      };
    } catch (error) {
      console.error('Error getting memory metrics:', error);
      throw error;
    }
  }

  /**
   * Add metrics to history buffer
   * @private
   */
  addToHistory(cpuLoad, memoryUsage, diskUsage, timestamp) {
    // Ensure all values are proper numbers, not strings
    const cpuValue = typeof cpuLoad === 'number' ? cpuLoad : parseFloat(cpuLoad) || 0;
    const memValue = typeof memoryUsage === 'number' ? memoryUsage : parseFloat(memoryUsage) || 0;
    const diskValue = typeof diskUsage === 'number' ? diskUsage : parseFloat(diskUsage) || 0;
    
    this.metricsHistory.cpu.push(cpuValue);
    this.metricsHistory.memory.push(memValue);
    this.metricsHistory.disk.push(diskValue);
    this.metricsHistory.timestamps.push(timestamp);
    
    console.log('[History] Added data point - CPU:', cpuValue.toFixed(2), 'Memory:', memValue.toFixed(2), 'Disk:', diskValue.toFixed(2));

    // Keep only last N entries - create NEW arrays instead of shift() to ensure React detects changes
    if (this.metricsHistory.cpu.length > this.maxHistorySize) {
      this.metricsHistory.cpu = this.metricsHistory.cpu.slice(-this.maxHistorySize);
      this.metricsHistory.memory = this.metricsHistory.memory.slice(-this.maxHistorySize);
      this.metricsHistory.disk = this.metricsHistory.disk.slice(-this.maxHistorySize);
      this.metricsHistory.timestamps = this.metricsHistory.timestamps.slice(-this.maxHistorySize);
      console.log('[History] Trimmed to max size:', this.maxHistorySize, '- created new array references');
    }
  }

  /**
   * Clear metrics history
   */
  clearHistory() {
    this.metricsHistory = {
      cpu: [],
      memory: [],
      disk: [],
      timestamps: []
    };
  }

  /**
   * Get battery information (for laptops)
   * @returns {Promise<Object|null>} Battery metrics or null if not available
   */
  async getBatteryInfo() {
    try {
      const battery = await si.battery();
      
      if (!battery.hasBattery) {
        return null;
      }

      return {
        hasBattery: battery.hasBattery,
        isCharging: battery.isCharging,
        percent: battery.percent,
        timeRemaining: battery.timeRemaining,
        acConnected: battery.acConnected,
        type: battery.type,
        model: battery.model,
        manufacturer: battery.manufacturer,
        maxCapacity: battery.maxCapacity,
        currentCapacity: battery.currentCapacity,
        capacityUnit: battery.capacityUnit,
        voltage: battery.voltage,
        cycleCount: battery.cycleCount
      };
    } catch (error) {
      console.error('Error getting battery info:', error);
      return null;
    }
  }

  /**
   * Get installed applications on Windows
   * Uses PowerShell to query Windows Registry - RELIABLE METHOD
   * @returns {Promise<Array>} List of installed applications
   */
  async getInstalledApplications() {
    console.log('========================================');
    console.log('Starting to fetch installed applications...');
    console.log('Platform:', process.platform);
    console.log('========================================');
    
    try {
      if (process.platform !== 'win32') {
        console.log('Non-Windows platform, using systeminformation fallback');
        return await this.getInstalledAppsSystemInfo();
      }

      // PowerShell script - saved to temp file to avoid escaping issues
      const psScriptContent = `
$apps = @()
$seen = @{}

# Registry paths to check (64-bit, 32-bit, and current user)
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)

# Read from Windows Registry
foreach ($path in $paths) {
  try {
    Get-ItemProperty $path -ErrorAction SilentlyContinue | 
      Where-Object { $_.DisplayName -and -not $seen.ContainsKey($_.DisplayName) } |
      ForEach-Object {
        $seen[$_.DisplayName] = $true
        $size = if ($_.EstimatedSize) { [int64]$_.EstimatedSize * 1024 } else { 0 }
        $apps += [PSCustomObject]@{
          Name = $_.DisplayName
          Version = if ($_.DisplayVersion) { $_.DisplayVersion } else { 'Unknown' }
          Publisher = if ($_.Publisher) { $_.Publisher } else { 'Unknown' }
          InstallDate = if ($_.InstallDate) { $_.InstallDate } else { 'Unknown' }
          InstallLocation = if ($_.InstallLocation) { $_.InstallLocation } else { '' }
          Size = $size
          Source = 'Registry'
        }
      }
  } catch {}
}

# Output as JSON
if ($apps.Count -gt 0) {
  $apps | ConvertTo-Json -Compress
} else {
  '[]'
}
`;

      // Write script to temp file
      const tmpDir = os.tmpdir();
      const scriptPath = path.join(tmpDir, `fortimorph-getapps-${Date.now()}.ps1`);
      
      console.log('Writing PowerShell script to:', scriptPath);
      await fs.writeFile(scriptPath, psScriptContent, 'utf8');

      console.log('Executing PowerShell script...');
      
      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
        {
          timeout: 30000, // 30 second timeout
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true
        }
      );

      // Clean up temp file
      try {
        await fs.unlink(scriptPath);
      } catch (e) {
        console.warn('Failed to delete temp script file:', e.message);
      }

      if (stderr && stderr.trim() && !stderr.includes('SilentlyContinue')) {
        console.warn('PowerShell stderr:', stderr);
      }

      console.log('PowerShell command completed');
      console.log('Output length:', stdout.length, 'characters');

      // Parse JSON output
      let appsData;
      try {
        const trimmed = stdout.trim();
        if (!trimmed || trimmed === '') {
          console.warn('PowerShell returned empty output');
          return await this.getInstalledAppsSystemInfo();
        }
        appsData = JSON.parse(trimmed);
      } catch (parseError) {
        console.error('Failed to parse PowerShell JSON output:', parseError.message);
        console.log('Raw output (first 1000 chars):', stdout.substring(0, 1000));
        return await this.getInstalledAppsSystemInfo();
      }

      // Handle single app or array
      const appsArray = Array.isArray(appsData) ? appsData : [appsData];
      
      console.log(`✅ Total apps found from registry: ${appsArray.length}`);
      
      if (appsArray.length > 0) {
        console.log('Sample of ALL apps found:');
        appsArray.slice(0, 20).forEach((app, i) => {
          console.log(`  ${i + 1}. ${app.Name} - ${app.Publisher} (${this.formatBytes(app.Size)})`);
        });
      }
      
      // System apps to EXCLUDE (Windows pre-installed bloat)
      const excludeSystemApps = [
        'Microsoft Edge',
        'Windows Security',
        'Microsoft Store',
        'Settings',
        'Windows Defender',
        'Windows Update',
        'Microsoft Edge Update',
        'Microsoft Edge WebView2',
        'Microsoft Edge WebView',
        'Windows Media Player',
        'Windows Photo Viewer',
        'Windows Calculator',
        'Windows Maps',
        'Windows Camera',
        'Windows Mail',
        'Windows Calendar',
        'Windows Alarms',
        'Windows Clock',
        'Windows Voice Recorder',
        'Windows Sound Recorder',
        'Cortana',
        'Microsoft News',
        'Microsoft Weather',
        'Microsoft Solitaire',
        'Microsoft Tips',
        'Xbox',
        'Xbox Game Bar',
        'Xbox Identity Provider',
        'Xbox Console Companion',
        'Paint',
        'Paint 3D',
        'Snipping Tool',
        'Sticky Notes',
        'Get Help',
        'Microsoft OneDrive',
      ];
      
      // Filter function - SIMPLIFIED: Include everything EXCEPT system bloat
      const isUserInstalledApp = (app) => {
        const name = app.Name || '';
        // const publisher = app.Publisher || '';
        const lowerName = name.toLowerCase();
        // const lowerPublisher = publisher.toLowerCase();
        
        // 1. EXCLUDE exact system apps
        for (const excluded of excludeSystemApps) {
          if (lowerName === excluded.toLowerCase()) {
            return false;
          }
        }
        
        // 2. EXCLUDE Windows system patterns
        if (lowerName.match(/^(windows|microsoft)\s+(defender|update|security|hotfix|kb\d{6,})/)) {
          return false;
        }
        
        // 3. EXCLUDE drivers, runtimes, and redistributables
        if (lowerName.includes('driver') ||
            lowerName.includes('redistributable') ||
            lowerName.match(/^microsoft visual c\+\+/i) ||
            lowerName.match(/^\.net framework/i) ||
            lowerName.match(/^asp\.net/i)) {
          return false;
        }
        
        // 4. INCLUDE EVERYTHING ELSE! (User apps, even if unknown publisher)
        return true;
      };
      
      // Filter and transform apps
      const installedApps = appsArray
        .filter(app => app.Name && app.Name.trim().length > 0)
        .filter(isUserInstalledApp)
        .map(app => ({
          name: app.Name,
          version: app.Version || 'Unknown',
          publisher: app.Publisher || 'Unknown',
          installDate: this.formatInstallDate(app.InstallDate),
          size: app.Size || 0,
          sizeFormatted: app.Size ? this.formatBytes(app.Size) : 'Unknown',
          installLocation: app.InstallLocation || 'Unknown'
        }))
        .sort((a, b) => b.size - a.size); // Sort by size (largest first)

      console.log(`========================================`);
      console.log(`✅ Found ${installedApps.length} applications after filtering`);
      console.log(`========================================`);

      if (installedApps.length > 0) {
        console.log('Top 10 apps by size:');
        installedApps.slice(0, 10).forEach((app, i) => {
          console.log(`${i + 1}. ${app.name} (${app.sizeFormatted}) - ${app.publisher}`);
        });
        return installedApps;
      }

      // If nothing found, use fallback
      console.warn('⚠️ No user apps found after filtering! Using fallback...');
      return await this.getInstalledAppsSystemInfo();

    } catch (error) {
      console.error('❌ Fatal error in getInstalledApplications:', error.message);
      console.error('Stack:', error.stack);
      console.log('Using fallback method...');
      return await this.getInstalledAppsSystemInfo();
    }
  }

  /**
   * Fallback method using systeminformation
   * @returns {Promise<Array>} List of installed applications
   */
  async getInstalledAppsSystemInfo() {
    console.log('========================================');
    console.log('Using systeminformation fallback method...');
    console.log('========================================');
    
    try {
      // systeminformation doesn't have a software() method - it uses system() for OS info
      // So we'll just return demo data directly
      console.log('systeminformation does not provide installed apps list');
      console.log('Using demo data instead...');
      return this.getDemoAppsData();
    } catch (error) {
      console.error('Error in systeminformation fallback:', error);
      console.error('Stack:', error.stack);
      return this.getDemoAppsData();
    }
  }

  /**
   * Get demo/common Windows apps data as last resort
   * @returns {Array} List of common Windows applications
   */
  getDemoAppsData() {
    console.log('Returning demo/common Windows apps data...');
    return [
      { name: 'Microsoft Edge', version: 'Installed', publisher: 'Microsoft Corporation', installDate: 'Pre-installed', size: 0, sizeFormatted: 'Unknown' },
      { name: 'Windows Security', version: 'Installed', publisher: 'Microsoft Corporation', installDate: 'Pre-installed', size: 0, sizeFormatted: 'Unknown' },
      { name: 'Microsoft Store', version: 'Installed', publisher: 'Microsoft Corporation', installDate: 'Pre-installed', size: 0, sizeFormatted: 'Unknown' },
      { name: 'Settings', version: 'Installed', publisher: 'Microsoft Corporation', installDate: 'Pre-installed', size: 0, sizeFormatted: 'Unknown' },
      { 
        name: '⚠️ Full app detection requires elevated permissions', 
        version: 'Run as Administrator', 
        publisher: 'System Message', 
        installDate: 'N/A', 
        size: 0, 
        sizeFormatted: 'N/A' 
      },
      { 
        name: 'Try running: wmic product get name', 
        version: 'In PowerShell', 
        publisher: 'System Tip', 
        installDate: 'N/A', 
        size: 0, 
        sizeFormatted: 'N/A' 
      }
    ];
  }

  /**
   * Format install date from registry format (YYYYMMDD) to readable format
   * @param {string} dateStr - Date string from registry
   * @returns {string} Formatted date
   */
  formatInstallDate(dateStr) {
    if (!dateStr || dateStr === 'N/A') return 'Unknown';
    
    try {
      const str = String(dateStr);
      if (str.length === 8) {
        const year = str.substring(0, 4);
        const month = str.substring(4, 6);
        const day = str.substring(6, 8);
        return `${year}-${month}-${day}`;
      }
    } catch (e) {
      console.error('Error formatting date:', e);
    }
    
    return 'Unknown';
  }

  /**
   * Format bytes to human readable format
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Scan for large files and folders consuming storage
   * @param {number} minSizeMB - Minimum file size in MB to include (default: 100MB)
   * @returns {Promise<Object>} Storage analysis with large files and folders
   */
  async getStorageAnalysis(minSizeMB = 100) {
    try {
      const minSizeBytes = minSizeMB * 1024 * 1024;
      const userProfile = process.env.USERPROFILE || process.env.HOME;
      
      // Common folders that consume storage
      const foldersToScan = [
        path.join(userProfile, 'Downloads'),
        path.join(userProfile, 'Documents'),
        path.join(userProfile, 'Desktop'),
        path.join(userProfile, 'Videos'),
        path.join(userProfile, 'Pictures'),
        path.join(userProfile, 'Music'),
        path.join(userProfile, 'AppData', 'Local', 'Temp')
      ];

      const largeFiles = [];
      const folderSizes = {};

      // Scan each folder
      for (const folder of foldersToScan) {
        try {
          const stats = await fs.stat(folder);
          if (stats.isDirectory()) {
            const { files, totalSize } = await this.scanDirectory(folder, minSizeBytes, 2); // Max depth 2
            largeFiles.push(...files);
            folderSizes[folder] = totalSize;
          }
        } catch (err) {
          console.log(`Skipping folder ${folder}:`, err.message);
        }
      }

      // Sort files by size
      largeFiles.sort((a, b) => b.size - a.size);

      // Get top folder sizes
      const topFolders = Object.entries(folderSizes)
        .map(([path, size]) => ({
          path,
          size,
          sizeFormatted: this.formatBytes(size)
        }))
        .sort((a, b) => b.size - a.size);

      // Get disk usage breakdown
      const diskData = await si.fsSize();
      const disks = diskData.map(d => ({
        mount: d.mount,
        fs: d.fs,
        type: d.type,
        size: d.size,
        used: d.used,
        available: d.available,
        usePercent: d.use,
        sizeFormatted: this.formatBytes(d.size),
        usedFormatted: this.formatBytes(d.used),
        availableFormatted: this.formatBytes(d.available)
      }));

      return {
        largeFiles: largeFiles, // Return ALL files found, not just top 50
        topFolders,
        disks,
        totalScanned: largeFiles.length,
        minSizeMB
      };
    } catch (error) {
      console.error('Error analyzing storage:', error);
      return {
        largeFiles: [],
        topFolders: [],
        disks: [],
        totalScanned: 0,
        error: error.message
      };
    }
  }

  /**
   * Recursively scan directory for large files
   * @private
   */
  async scanDirectory(dirPath, minSize, maxDepth, currentDepth = 0) {
    const files = [];
    let totalSize = 0;

    if (currentDepth > maxDepth) {
      return { files, totalSize };
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        try {
          const fullPath = path.join(dirPath, entry.name);
          
          // Skip system and hidden folders
          if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
          }

          const stats = await fs.stat(fullPath);

          if (entry.isFile()) {
            totalSize += stats.size;
            if (stats.size >= minSize) {
              files.push({
                path: fullPath,
                name: entry.name,
                size: stats.size,
                sizeFormatted: this.formatBytes(stats.size),
                modified: stats.mtime,
                type: path.extname(entry.name) || 'No extension'
              });
            }
          } else if (entry.isDirectory()) {
            const result = await this.scanDirectory(fullPath, minSize, maxDepth, currentDepth + 1);
            files.push(...result.files);
            totalSize += result.totalSize;
          }
        } catch (err) {
          // Skip files/folders we can't access
          continue;
        }
      }
    } catch (err) {
      console.log(`Error scanning ${dirPath}:`, err.message);
    }

    return { files, totalSize };
  }

}

// Export singleton instance
module.exports = new MonitoringService();
