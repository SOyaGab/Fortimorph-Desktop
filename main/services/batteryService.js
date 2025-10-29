/**
 * Battery Service
 * Monitors battery health, trends, and provides optimization recommendations
 * with adaptive polling and intelligent alerting
 */

const si = require('systeminformation');
const { app } = require('electron');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class BatteryService {
  constructor(dbService) {
    this.db = dbService;
    this.isMonitoring = false;
    this.monitoringInterval = null;
    
    // Track if systeminformation is consistently failing
    this.siFailureCount = 0;
    this.useFallbackMethod = false;
    
    // Optimization modes
    this.modes = {
      SAVER: 'saver',
      BALANCED: 'balanced',
      PERFORMANCE: 'performance'
    };
    
    this.currentMode = this.modes.BALANCED;
    
    // Adaptive polling intervals (in milliseconds)
    this.pollingIntervals = {
      [this.modes.SAVER]: 60000,      // 60 seconds - slowest
      [this.modes.BALANCED]: 30000,    // 30 seconds - default
      [this.modes.PERFORMANCE]: 10000  // 10 seconds - fastest
    };
    
    // Battery state tracking
    this.lastBatteryState = null;
    this.batteryHistory = []; // 24-hour trend data
    this.maxHistoryPoints = 288; // 24 hours at 5-minute intervals
    
    // Process tracking for battery usage
    this.processTracking = new Map(); // pid -> {name, startTime, totalCpu, totalMem, samples}
    this.processHistory = []; // Historical process data for battery impact
    this.maxProcessHistory = 100; // Keep last 100 samples
    this.lastProcessTrackingTime = null; // Track when we last updated process tracking
    
    // Cache for analytics to avoid slow calls
    this.cachedAnalytics = null;
    
    // System boot tracking
    this.systemBootTime = null;
    this.lastShutdownTime = null;
    this.sessionStartTime = Date.now();
    
    // Load persistent tracking data
    this.loadPersistentTracking();
    
    // Alert system
    this.alerts = [];
    this.alertCooldowns = new Map(); // Alert type -> last triggered timestamp
    this.cooldownDuration = 300000; // 5 minutes in milliseconds
    
    // Alert thresholds
    this.thresholds = {
      criticalBattery: 10,      // Critical battery level %
      lowBattery: 20,            // Low battery level %
      rapidDrain: 5,             // % drain per minute
      highTemp: 45,              // Temperature in Celsius
      cycleWarning: 500,         // Cycle count warning threshold
      healthWarning: 80          // Battery health % warning
    };
    
    // Alert rules configuration
    this.alertRules = [
      {
        id: 'critical_battery',
        type: 'critical',
        check: (data) => !data.isCharging && data.percent <= this.thresholds.criticalBattery,
        message: (data) => `Critical battery level: ${data.percent}%. Connect charger immediately.`,
        action: 'Enable power saving mode and close unnecessary applications.',
        cooldown: 600000 // 10 minutes
      },
      {
        id: 'low_battery',
        type: 'warning',
        check: (data) => !data.isCharging && data.percent <= this.thresholds.lowBattery && data.percent > this.thresholds.criticalBattery,
        message: (data) => `Low battery: ${data.percent}%. Consider charging soon.`,
        action: 'Reduce screen brightness and close background applications.',
        cooldown: 300000 // 5 minutes
      },
      {
        id: 'rapid_drain',
        type: 'warning',
        check: (data) => {
          if (!this.lastBatteryState || data.isCharging) return false;
          const timeDiff = (data.timestamp - this.lastBatteryState.timestamp) / 60000; // minutes
          const percentDiff = this.lastBatteryState.percent - data.percent;
          return timeDiff > 0 && (percentDiff / timeDiff) >= this.thresholds.rapidDrain;
        },
        message: (data) => `Rapid battery drain detected. Current level: ${data.percent}%.`,
        action: 'Check for resource-intensive applications and consider switching to battery saver mode.',
        cooldown: 600000 // 10 minutes
      },
      {
        id: 'high_temperature',
        type: 'warning',
        check: (data) => data.temperature && data.temperature >= this.thresholds.highTemp,
        message: (data) => `High battery temperature: ${data.temperature}°C`,
        action: 'Allow device to cool down. Avoid charging and reduce CPU load.',
        cooldown: 900000 // 15 minutes
      },
      {
        id: 'health_warning',
        type: 'info',
        check: (data) => data.capacityPercent && data.capacityPercent <= this.thresholds.healthWarning,
        message: (data) => `Battery health at ${data.capacityPercent}%. Consider battery replacement.`,
        action: 'Battery may not hold charge as effectively. Plan for replacement.',
        cooldown: 86400000 // 24 hours
      },
      {
        id: 'cycle_warning',
        type: 'info',
        check: (data) => data.cycleCount && data.cycleCount >= this.thresholds.cycleWarning,
        message: (data) => `Battery cycle count: ${data.cycleCount}. Monitor battery health.`,
        action: 'High cycle count detected. Check battery health regularly.',
        cooldown: 86400000 // 24 hours
      },
      {
        id: 'fully_charged',
        type: 'info',
        check: (data) => data.isCharging && data.percent >= 95,
        message: () => `Battery fully charged. Unplug to preserve battery health.`,
        action: 'Disconnect charger to prevent overcharging and extend battery lifespan.',
        cooldown: 3600000 // 1 hour
      }
    ];
  }

  /**
   * Initialize battery monitoring service
   */
  async initialize() {
    try {
      console.log('Initializing battery service...');
      
      // Load saved settings
      await this.loadSettings();
      
      // Check if device has battery
      const hasBattery = await this.checkBatteryAvailability();
      
      if (!hasBattery) {
        console.log('No battery detected. Battery monitoring disabled.');
        this.db.addLog('battery', 'No battery detected on this device', null, 'info');
        return false;
      }
      
      // Get initial battery state
      this.lastBatteryState = await this.getBatteryData();
      
      // Initialize with current battery data in history (so charts show immediately)
      if (this.lastBatteryState && this.batteryHistory.length === 0) {
        console.log('[Battery Init] Adding initial data point to history');
        this.addToHistory(this.lastBatteryState);
      }
      
      // Start monitoring
      this.startMonitoring();
      
      // OPTIMIZED: Delay initial process scan to let app start faster
      // Run it after 30 seconds instead of immediately to reduce startup lag
      console.log('[Battery Init] Scheduling initial process scan for 30s from now...');
      setTimeout(() => {
        console.log('[Battery Init] Running delayed initial process scan...');
        this.updateProcessTrackingAsync().catch(err => {
          console.error('Initial process scan failed (non-critical):', err);
        });
      }, 30000); // Wait 30 seconds before first scan
      
      // Schedule data retention cleanup (keep 30 days)
      this.scheduleDataRetention(30);
      
      this.db.addLog('battery', 'Battery service initialized successfully', {
        mode: this.currentMode,
        hasBattery: true,
        initialPercent: this.lastBatteryState.percent
      }, 'info');
      
      console.log('Battery service initialized successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to initialize battery service:', error);
      this.db.addLog('battery', 'Failed to initialize battery service', {
        error: error.message
      }, 'error');
      return false;
    }
  }

  /**
   * Check if device has a battery
   */
  async checkBatteryAvailability() {
    try {
      const battery = await si.battery();
      return battery.hasBattery;
    } catch (error) {
      console.error('Error checking battery availability:', error);
      return false;
    }
  }

  /**
   * Load persistent tracking data from database
   * FIXED: Data now properly resets on system shutdown/restart
   * Only restores if from the SAME boot session (not persisted across reboots)
   */
  loadPersistentTracking() {
    try {
      // Get system boot time
      const os = require('os');
      const uptimeSeconds = os.uptime();
      this.systemBootTime = Date.now() - (uptimeSeconds * 1000);
      this.sessionStartTime = Date.now(); // Track when our app session started
      
      console.log(`System boot time: ${new Date(this.systemBootTime).toLocaleString()}`);
      console.log(`App session started: ${new Date(this.sessionStartTime).toLocaleString()}`);
      console.log(`System uptime: ${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`);
      
      // ALWAYS start fresh - do not restore old data
      // The UI says "counters reset when you restart/shutdown your laptop"
      // So we should never load old tracking data
      console.log('Starting fresh tracking session (no restoration from previous sessions)');
      this.clearPersistentTracking();
      
    } catch (error) {
      console.error('Error loading persistent tracking:', error);
    }
  }

  /**
   * Save persistent tracking data to database
   * This allows tracking to survive app restarts
   */
  savePersistentTracking() {
    try {
      // Convert Map to array for JSON serialization
      const processTrackingArray = Array.from(this.processTracking.entries()).map(([pid, data]) => ({
        pid,
        data
      }));
      
      const trackingData = {
        systemBootTime: this.systemBootTime,
        sessionStartTime: this.sessionStartTime,
        lastSaveTime: Date.now(),
        processTracking: processTrackingArray
      };
      
      this.db.setSetting('process_tracking_data', JSON.stringify(trackingData));
      console.log(`Saved tracking data for ${processTrackingArray.length} processes`);
    } catch (error) {
      console.error('Error saving persistent tracking:', error);
    }
  }

  /**
   * Clear persistent tracking data
   * Called on new boot session
   */
  clearPersistentTracking() {
    try {
      this.db.setSetting('process_tracking_data', null);
      console.log('Cleared persistent tracking data');
    } catch (error) {
      console.error('Error clearing persistent tracking:', error);
    }
  }

  /**
   * Start battery monitoring with adaptive polling
   * OPTIMIZED: Reduced initial scanning frequency to prevent system lag
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.log('Battery monitoring already running');
      return;
    }
    
    this.isMonitoring = true;
    const interval = this.pollingIntervals[this.currentMode];
    
    console.log(`Starting battery monitoring with ${interval}ms interval (${this.currentMode} mode)`);
    
    this.monitoringInterval = setInterval(async () => {
      await this.collectBatteryData();
    }, interval);
    
    // Initial data collection - do it immediately
    this.collectBatteryData();
    
    // REDUCED: Only do ONE additional early scan at 30 seconds (removed the 20s, 1m, 2m scans)
    // This prevents overwhelming the system on startup
    setTimeout(() => this.collectBatteryData(), 30000);  // 30 seconds
  }

  /**
   * Stop battery monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    console.log('Battery monitoring stopped');
    this.db.addLog('battery', 'Battery monitoring stopped', null, 'info');
  }

  /**
   * Collect battery data and check alerts
   */
  async collectBatteryData() {
    try {
      console.log('[Battery Monitoring] Collecting battery data...');
      const batteryData = await this.getBatteryData();
      
      // Store in history
      this.addToHistory(batteryData);
      
      // Check alert rules
      await this.checkAlerts(batteryData);
      
      // Update last state
      this.lastBatteryState = batteryData;
      
      // OPTIMIZED: Only update process tracking every 5 minutes to reduce system load
      // This prevents constant CPU/memory scanning that causes lag
      if (!this.lastProcessTrackingTime || (Date.now() - this.lastProcessTrackingTime) > 300000) {
        console.log('[Battery Monitoring] Triggering background process tracking update (5min interval)...');
        this.lastProcessTrackingTime = Date.now();
        this.updateProcessTrackingAsync().catch(err => {
          console.error('Error updating process tracking (non-critical):', err);
        });
      }
      
      // Adjust polling based on charging state
      await this.adjustPolling(batteryData);
      
      // Log to database periodically (every 5 minutes)
      if (this.shouldLogToDatabase()) {
        this.db.addLog('battery', 'Battery data collected', {
          percent: batteryData.percent,
          isCharging: batteryData.isCharging,
          mode: this.currentMode
        }, 'debug');
      }
      
      return batteryData;
      
    } catch (error) {
      console.error('Error collecting battery data:', error);
      this.db.addLog('battery', 'Error collecting battery data', {
        error: error.message
      }, 'error');
      return null;
    }
  }

  /**
   * Get current battery data
   */
  async getBatteryData() {
    try {
      const battery = await si.battery();
      
      // Check which metrics are available
      const hasCapacityData = battery.maxCapacity && battery.currentCapacity;
      const hasCycleCount = battery.cycleCount && battery.cycleCount > 0;
      const hasTemperature = battery.temperature && battery.temperature > 0;
      
      return {
        hasBattery: battery.hasBattery,
        isCharging: battery.isCharging,
        percent: battery.percent || 0,
        timeRemaining: battery.timeRemaining || null,
        acConnected: battery.acConnected,
        type: battery.type || 'Unknown',
        model: battery.model || 'Unknown',
        manufacturer: battery.manufacturer || 'Unknown',
        maxCapacity: battery.maxCapacity || null,
        currentCapacity: battery.currentCapacity || null,
        capacityUnit: battery.capacityUnit || null,
        voltage: battery.voltage || null,
        capacityPercent: battery.capacityPercent || null,
        cycleCount: battery.cycleCount || null,
        temperature: battery.temperature || null,
        timestamp: Date.now(),
        // Add metadata about data availability
        dataAvailability: {
          hasCapacityData,
          hasCycleCount,
          hasTemperature,
          reason: this.getDataLimitationReason(hasCapacityData, hasCycleCount, hasTemperature)
        }
      };
    } catch (error) {
      console.error('Error getting battery data:', error);
      throw error;
    }
  }

  /**
   * Get explanation for why certain data isn't available
   * @private
   */
  getDataLimitationReason(hasCapacity, hasCycles, hasTemp) {
    if (hasCapacity && hasCycles && hasTemp) {
      return 'All battery metrics are available from your hardware.';
    }
    
    const missing = [];
    if (!hasCapacity) missing.push('capacity health');
    if (!hasCycles) missing.push('cycle count');
    if (!hasTemp) missing.push('temperature');
    
    if (missing.length === 3) {
      return 'Your device\'s battery controller doesn\'t expose detailed health metrics. This is common with basic battery management systems and doesn\'t affect monitoring capabilities.';
    }
    
    return `Some metrics (${missing.join(', ')}) are not available. This depends on your device's battery hardware and drivers.`;
  }

  /**
   * Add battery data to history (24-hour trend)
   */
  addToHistory(data) {
    this.batteryHistory.push({
      percent: data.percent,
      isCharging: data.isCharging,
      timestamp: data.timestamp
    });
    
    // Keep only last 24 hours (288 points at 5-minute intervals)
    if (this.batteryHistory.length > this.maxHistoryPoints) {
      this.batteryHistory.shift();
    }
    
    console.log(`[Battery History] Added data point. Total history: ${this.batteryHistory.length} points`);
  }

  /**
   * Get 24-hour battery trend
   */
  getBatteryTrend() {
    return this.batteryHistory;
  }

  /**
   * Check alert rules and trigger if needed
   */
  async checkAlerts(batteryData) {
    const now = Date.now();
    
    for (const rule of this.alertRules) {
      try {
        // Check if alert is on cooldown
        const lastTriggered = this.alertCooldowns.get(rule.id);
        const cooldownPeriod = rule.cooldown || this.cooldownDuration;
        
        if (lastTriggered && (now - lastTriggered) < cooldownPeriod) {
          continue; // Skip this alert, still on cooldown
        }
        
        // Check if alert condition is met
        if (rule.check(batteryData)) {
          const alert = {
            id: rule.id,
            type: rule.type,
            message: rule.message(batteryData),
            action: rule.action,
            timestamp: now,
            batteryData: {
              percent: batteryData.percent,
              isCharging: batteryData.isCharging,
              temperature: batteryData.temperature
            }
          };
          
          // Add to alerts list
          this.alerts.unshift(alert);
          
          // Keep only last 50 alerts
          if (this.alerts.length > 50) {
            this.alerts = this.alerts.slice(0, 50);
          }
          
          // Set cooldown
          this.alertCooldowns.set(rule.id, now);
          
          // Log to database
          this.db.addLog('battery', `Battery alert: ${alert.message}`, alert, rule.type);
          
          console.log(`Battery alert triggered: ${rule.id} - ${alert.message}`);
        }
        
      } catch (error) {
        console.error(`Error checking alert rule ${rule.id}:`, error);
      }
    }
  }

  /**
   * Get recent alerts
   */
  getAlerts(limit = 20) {
    return this.alerts.slice(0, limit);
  }

  /**
   * Clear all alerts
   */
  clearAlerts() {
    this.alerts = [];
    this.db.addLog('battery', 'Battery alerts cleared', null, 'info');
  }

  /**
   * Dismiss specific alert
   */
  dismissAlert(alertId) {
    const index = this.alerts.findIndex(a => a.id === alertId && a.timestamp);
    if (index !== -1) {
      this.alerts.splice(index, 1);
    }
  }

  /**
   * Adjust polling interval based on battery state
   * NOTE: This has been disabled to respect user mode selection
   * The system will no longer automatically change modes
   */
  async adjustPolling(batteryData) {
    // Automatic mode adjustment disabled - user selection will persist
    // Users can manually change modes via the UI
    return;
  }

  /**
   * Set optimization mode
   */
  async setOptimizationMode(mode) {
    if (!Object.values(this.modes).includes(mode)) {
      throw new Error(`Invalid optimization mode: ${mode}`);
    }
    
    if (this.currentMode === mode) {
      return; // Already in this mode
    }
    
    const oldMode = this.currentMode;
    this.currentMode = mode;
    
    // Restart monitoring with new interval
    this.stopMonitoring();
    this.startMonitoring();
    
    // Save setting
    await this.saveSettings();
    
    this.db.addLog('battery', `Optimization mode changed: ${oldMode} → ${mode}`, {
      oldMode,
      newMode: mode,
      interval: this.pollingIntervals[mode]
    }, 'info');
    
    console.log(`Battery optimization mode changed to: ${mode}`);
  }

  /**
   * Get current optimization mode
   */
  getOptimizationMode() {
    return this.currentMode;
  }

  /**
   * Get optimization mode details
   */
  getOptimizationModeDetails() {
    return {
      current: this.currentMode,
      available: Object.values(this.modes),
      intervals: this.pollingIntervals,
      descriptions: {
        [this.modes.SAVER]: 'Minimal monitoring (60s interval) - Best for battery life',
        [this.modes.BALANCED]: 'Normal monitoring (30s interval) - Recommended',
        [this.modes.PERFORMANCE]: 'Frequent monitoring (10s interval) - Real-time tracking'
      }
    };
  }

  /**
   * Update alert thresholds
   */
  updateThresholds(newThresholds) {
    this.thresholds = {
      ...this.thresholds,
      ...newThresholds
    };
    
    this.db.addLog('battery', 'Alert thresholds updated', newThresholds, 'info');
  }

  /**
   * Get current thresholds
   */
  getThresholds() {
    return { ...this.thresholds };
  }

  /**
   * Get battery statistics
   */
  getBatteryStats() {
    if (this.batteryHistory.length === 0) {
      return null;
    }
    
    const recentData = this.batteryHistory.slice(-60); // Last hour
    const percentages = recentData.map(d => d.percent);
    
    const avgPercent = percentages.reduce((a, b) => a + b, 0) / percentages.length;
    const minPercent = Math.min(...percentages);
    const maxPercent = Math.max(...percentages);
    
    // Calculate drain rate (% per hour)
    const firstPoint = recentData[0];
    const lastPoint = recentData[recentData.length - 1];
    const timeDiffHours = (lastPoint.timestamp - firstPoint.timestamp) / 3600000;
    const drainRate = timeDiffHours > 0 ? (firstPoint.percent - lastPoint.percent) / timeDiffHours : 0;
    
    return {
      avgPercent: Math.round(avgPercent),
      minPercent,
      maxPercent,
      drainRate: Math.round(drainRate * 100) / 100,
      dataPoints: this.batteryHistory.length,
      currentPercent: this.lastBatteryState?.percent || 0,
      isCharging: this.lastBatteryState?.isCharging || false
    };
  }

  /**
   * Check if should log to database (every 5 minutes)
   */
  shouldLogToDatabase() {
    if (!this.lastDatabaseLog) {
      this.lastDatabaseLog = Date.now();
      return true;
    }
    
    const timeSinceLastLog = Date.now() - this.lastDatabaseLog;
    if (timeSinceLastLog >= 300000) { // 5 minutes
      this.lastDatabaseLog = Date.now();
      return true;
    }
    
    return false;
  }

  /**
   * Schedule data retention cleanup
   */
  scheduleDataRetention(days) {
    const retentionMs = days * 24 * 60 * 60 * 1000;
    
    // Run cleanup daily
    setInterval(() => {
      try {
        const cutoffTime = Date.now() - retentionMs;
        
        // Clean up old alerts
        this.alerts = this.alerts.filter(alert => alert.timestamp > cutoffTime);
        
        // Clean up old database logs
        this.db.cleanupOldLogs('battery', cutoffTime);
        
        console.log(`Battery data retention cleanup completed (${days} days)`);
        
      } catch (error) {
        console.error('Error during battery data retention cleanup:', error);
      }
    }, 86400000); // Run daily
  }

  /**
   * Save battery service settings
   */
  async saveSettings() {
    try {
      this.db.setSetting('battery_optimization_mode', this.currentMode);
      this.db.setSetting('battery_thresholds', JSON.stringify(this.thresholds));
    } catch (error) {
      console.error('Error saving battery settings:', error);
    }
  }

  /**
   * Load battery service settings
   */
  async loadSettings() {
    try {
      const savedMode = this.db.getSetting('battery_optimization_mode');
      if (savedMode && Object.values(this.modes).includes(savedMode)) {
        this.currentMode = savedMode;
      }
      
      const savedThresholds = this.db.getSetting('battery_thresholds');
      if (savedThresholds) {
        this.thresholds = {
          ...this.thresholds,
          ...JSON.parse(savedThresholds)
        };
      }
    } catch (error) {
      console.error('Error loading battery settings:', error);
    }
  }

  /**
   * Get comprehensive battery report
   */
  async getBatteryReport() {
    try {
      const currentData = this.lastBatteryState || await this.getBatteryData();
      const stats = this.getBatteryStats();
      const alerts = this.getAlerts(10);
      const modeDetails = this.getOptimizationModeDetails();
      
      // Get analytics asynchronously but don't wait for it if it takes too long
      // This prevents the UI from hanging
      let analytics = null;
      try {
        const analyticsPromise = this.getBatteryAnalytics();
        const timeoutPromise = new Promise((resolve) => 
          setTimeout(() => resolve(null), 3000) // 3 second timeout
        );
        analytics = await Promise.race([analyticsPromise, timeoutPromise]);
      } catch (analyticsError) {
        console.error('Error getting battery analytics (non-critical):', analyticsError);
        analytics = {
          topProcesses: [],
          dischargeAnalysis: null,
          usageHistory: null,
          error: analyticsError.message
        };
      }
      
      return {
        current: currentData,
        stats,
        alerts,
        optimization: modeDetails,
        thresholds: this.thresholds,
        trend: this.batteryHistory,
        isMonitoring: this.isMonitoring,
        analytics
      };
    } catch (error) {
      console.error('Error in getBatteryReport:', error);
      // Return minimal data even on error
      return {
        current: { hasBattery: false, percent: 0, isCharging: false },
        stats: null,
        alerts: [],
        optimization: this.getOptimizationModeDetails(),
        thresholds: this.thresholds,
        trend: [],
        isMonitoring: this.isMonitoring,
        analytics: null,
        error: error.message
      };
    }
  }

  /**
   * Update process tracking asynchronously (non-blocking)
   * OPTIMIZED: Reduced timeout and better failure handling to prevent lag
   */
  async updateProcessTrackingAsync() {
    try {
      console.log('[Process Tracking] Starting background update...');
      
      // If systeminformation has failed 3+ times, use fallback method
      if (this.siFailureCount >= 3 && process.platform === 'win32') {
        console.log('[Process Tracking] Using Windows fallback method (systeminformation too slow)');
        await this.updateProcessTrackingWindows();
        return;
      }
      
      const si = require('systeminformation');
      
      // REDUCED TIMEOUT: 8 seconds instead of 15 to prevent lag
      // Get process info with timeout - systeminformation can be slow on Windows
      const processesPromise = si.processes();
      const timeoutPromise = new Promise((resolve) => 
        setTimeout(() => {
          console.log('[Process Tracking] Timeout reached (8s) - systeminformation is slow, switching to fallback');
          this.siFailureCount++;
          return resolve({ list: [] });
        }, 8000) // REDUCED: 8 second timeout (was 15s)
      );
      const processes = await Promise.race([processesPromise, timeoutPromise]);
      
      console.log(`[Process Tracking] Got ${processes.list?.length || 0} processes from system`);
      
      // Update tracking if we got data
      if (processes.list && processes.list.length > 0) {
        this.siFailureCount = 0; // Reset failure count on success
        this.updateProcessTracking(processes.list);
        console.log(`[Process Tracking] ✅ Updated: ${this.processTracking.size} processes being tracked`);
      } else {
        console.log('[Process Tracking] ⚠️ No process data received - will retry on next cycle');
      }
    } catch (error) {
      // Log but don't throw - this is background work
      console.error('[Process Tracking] ❌ Background update failed:', error.message);
      this.siFailureCount++;
      
      // After 2 failures on Windows, switch to fallback permanently
      if (this.siFailureCount >= 2 && process.platform === 'win32') {
        console.log('[Process Tracking] Switching to Windows fallback method due to repeated failures');
      }
    }
  }

  /**
   * Fallback process tracking using Windows tasklist command
   * OPTIMIZED: Much faster than systeminformation on Windows, with better filtering
   */
  async updateProcessTrackingWindows() {
    try {
      console.log('[Process Tracking Windows] Using native Windows tasklist...');
      
      // Use Windows tasklist with CSV format for easier parsing
      // OPTIMIZED: Use /FI filter to only get processes using >20MB memory (was 5MB)
      const { stdout } = await execAsync('tasklist /FO CSV /NH /FI "MEMUSAGE gt 20480"', { 
        timeout: 3000, // REDUCED: 3 seconds (was 5s)
        windowsHide: true 
      });
      
      const lines = stdout.trim().split('\n');
      const processes = [];
      
      for (const line of lines) {
        // Parse CSV line: "Image Name","PID","Session Name","Session#","Mem Usage"
        const match = line.match(/"([^"]+)","(\d+)","[^"]+","[^"]+","([^"]+)"/);
        if (match) {
          const [, name, pidStr, memStr] = match;
          const pid = parseInt(pidStr);
          const memKB = parseInt(memStr.replace(/[^\d]/g, ''));
          
          // OPTIMIZED: Only track processes using >20MB (was 5MB)
          if (pid > 0 && memKB > 20480) {
            processes.push({
              pid,
              name,
              command: name,
              cpu: 0, // Can't get CPU from tasklist easily
              memVsTotal: (memKB / 1024 / 1024) / (require('os').totalmem() / 1024 / 1024 / 1024) * 100
            });
          }
        }
      }
      
      if (processes.length > 0) {
        this.updateProcessTracking(processes);
        console.log(`[Process Tracking Windows] ✅ Updated ${this.processTracking.size} processes using tasklist (${processes.length} found)`);
      }
    } catch (error) {
      console.error('[Process Tracking Windows] Failed:', error.message);
    }
  }

  /**
   * Get battery consumption analytics
   * Uses cached data if fresh enough to avoid slow systeminformation calls
   */
  async getBatteryAnalytics() {
    try {
      const now = Date.now();
      
      // Check if we have cached analytics less than 10 seconds old (increased from 5)
      if (this.cachedAnalytics && (now - this.cachedAnalytics.timestamp) < 10000) {
        console.log('[Battery Analytics] Using cached data');
        return this.cachedAnalytics;
      }
      
      console.log('[Battery Analytics] Generating fresh analytics...');
      
      // Always get the top processes from our tracking (which updates in background)
      const topProcesses = this.getTopBatteryDrainingProcesses();
      
      // Calculate discharge rate analysis from historical data (fast, no API calls)
      const dischargeAnalysis = this.calculateDischargeAnalysis();
      
      // Get usage history from our stored data (fast, no API calls)
      const usageHistory = this.getUsageHistory();

      const analytics = {
        topProcesses: topProcesses || [], // Ensure it's always an array
        dischargeAnalysis,
        usageHistory,
        timestamp: now,
        processTrackingSize: this.processTracking.size,
        batteryHistorySize: this.batteryHistory.length
      };
      
      // Cache the result
      this.cachedAnalytics = analytics;
      
      console.log(`[Battery Analytics] ✅ Generated:`);
      console.log(`  - Top processes: ${topProcesses.length} apps`);
      console.log(`  - Tracking: ${this.processTracking.size} total processes`);
      console.log(`  - Battery history: ${this.batteryHistory.length} data points`);
      console.log(`  - Discharge analysis: ${dischargeAnalysis ? 'Available' : 'Not enough data'}`);
      console.log(`  - Usage history: ${usageHistory ? 'Available' : 'Not enough data'}`);
      
      return analytics;
    } catch (error) {
      console.error('Error getting battery analytics:', error);
      // Return whatever we can with safe defaults
      return {
        topProcesses: this.getTopBatteryDrainingProcesses() || [],
        dischargeAnalysis: this.calculateDischargeAnalysis() || null,
        usageHistory: this.getUsageHistory() || null,
        processTrackingSize: this.processTracking.size,
        batteryHistorySize: this.batteryHistory.length,
        error: error.message
      };
    }
  }

  /**
   * Update process tracking to monitor battery impact over time
   * FIXED: Now properly tracks time since current session start only
   * Resets on system shutdown/restart as expected
   */
  updateProcessTracking(processList) {
    const now = Date.now();
    const currentPids = new Set();
    
    // Update or add processes
    processList.forEach(process => {
      if (process.cpu > 0.1 || process.memVsTotal > 0) { // Track any measurable activity
        currentPids.add(process.pid);
        
        if (!this.processTracking.has(process.pid)) {
          // New process detected - record when WE first saw it (not system boot time)
          // This ensures accurate "running time since laptop started" tracking
          let processStartTime = now;
          
          // Try to get actual process start time from the system
          if (process.started) {
            try {
              // Parse the started timestamp
              const startDate = new Date(process.started);
              if (!isNaN(startDate.getTime())) {
                const parsedTime = startDate.getTime();
                // Only use if it's after system boot and not in the future
                if (parsedTime >= this.systemBootTime && parsedTime <= now) {
                  processStartTime = parsedTime;
                } else {
                  // Invalid timestamp - use when we first detected it
                  console.log(`[Process Tracking] Invalid start time for ${process.name}, using detection time`);
                  processStartTime = now;
                }
              }
            } catch (e) {
              // If parsing fails, use current time (when we detected it)
              console.log(`[Process Tracking] Could not parse start time for ${process.name}, using detection time`);
              processStartTime = now;
            }
          }
          
          // IMPORTANT: If startTime is before our session started, cap it to session start
          // This ensures we only count runtime during THIS session
          if (processStartTime < this.sessionStartTime) {
            console.log(`[Process Tracking] ${process.name} started before our session, capping to session start`);
            processStartTime = this.sessionStartTime;
          }
          
          // New process
          this.processTracking.set(process.pid, {
            name: process.name || 'Unknown',
            command: process.command || process.name || 'N/A',
            startTime: processStartTime,
            totalCpu: process.cpu || 0,
            totalMem: process.memVsTotal || 0,
            samples: 1,
            lastSeen: now,
            peakCpu: process.cpu || 0,
            peakMem: process.memVsTotal || 0
          });
        } else {
          // Update existing process
          const tracked = this.processTracking.get(process.pid);
          tracked.totalCpu += process.cpu || 0;
          tracked.totalMem += process.memVsTotal || 0;
          tracked.samples++;
          tracked.lastSeen = now;
          tracked.peakCpu = Math.max(tracked.peakCpu, process.cpu || 0);
          tracked.peakMem = Math.max(tracked.peakMem, process.memVsTotal || 0);
        }
      }
    });
    
    // Remove processes that are no longer running
    // Check if process hasn't been seen in last 30 seconds (2 monitoring cycles)
    const thirtySecondsAgo = now - 30000;
    for (const [pid, data] of this.processTracking.entries()) {
      if (data.lastSeen < thirtySecondsAgo && !currentPids.has(pid)) {
        console.log(`Process ${data.name} (PID: ${pid}) closed - removing from tracking`);
        this.processTracking.delete(pid);
      }
    }
    
    // Store snapshot in history
    this.processHistory.push({
      timestamp: now,
      activeProcesses: processList.length,
      totalCpu: processList.reduce((sum, p) => sum + (p.cpu || 0), 0)
    });
    
    if (this.processHistory.length > this.maxProcessHistory) {
      this.processHistory.shift();
    }
    
    // DON'T save tracking data across sessions anymore
    // Data should reset on laptop shutdown/restart
    // Removed: this.savePersistentTracking();
  }

  /**
   * Get top battery-draining processes with enhanced metrics
   */
  getTopBatteryDrainingProcesses() {
    const now = Date.now();
    const processes = [];
    
    console.log(`[Top Processes] Processing ${this.processTracking.size} tracked processes`);
    
    // If no processes tracked yet, return empty array with explanation
    if (this.processTracking.size === 0) {
      console.log('[Top Processes] ⚠️ No processes tracked yet - returning empty array');
      return [];
    }
    
    for (const [pid, data] of this.processTracking.entries()) {
      const runningTime = now - data.startTime; // milliseconds
      const runningMinutes = runningTime / 60000;
      const runningHours = runningTime / 3600000;
      
      const avgCpu = data.samples > 0 ? data.totalCpu / data.samples : 0;
      const avgMem = data.samples > 0 ? data.totalMem / data.samples : 0;
      
      // Calculate battery impact score
      // Higher CPU usage and longer running time = higher impact
      const batteryImpact = (avgCpu * runningMinutes) + (avgMem * runningMinutes * 0.1);
      
      processes.push({
        pid,
        name: data.name,
        command: data.command,
        avgCpu: Math.round(avgCpu * 10) / 10,
        avgMem: Math.round(avgMem * 10) / 10,
        peakCpu: Math.round(data.peakCpu * 10) / 10,
        peakMem: Math.round(data.peakMem * 10) / 10,
        runningTime: runningMinutes < 60 
          ? `${Math.round(runningMinutes)}m` 
          : `${Math.floor(runningHours)}h ${Math.round(runningMinutes % 60)}m`,
        runningTimeMinutes: Math.round(runningMinutes),
        batteryImpact: Math.round(batteryImpact),
        samples: data.samples
      });
    }
    
    // Sort by battery impact (highest first)
    processes.sort((a, b) => b.batteryImpact - a.batteryImpact);
    
    const topProcesses = processes.slice(0, 15);
    console.log(`[Top Processes] ✅ Returning top ${topProcesses.length} of ${processes.length} total processes`);
    if (topProcesses.length > 0) {
      console.log(`[Top Processes] Top 5:`, 
        topProcesses.slice(0, 5).map(p => `${p.name}(impact:${p.batteryImpact}, cpu:${p.avgCpu}%)`).join(', ')
      );
    }
    
    // Return top 15
    return topProcesses;
  }

  /**
   * Calculate discharge rate analysis
   */
  calculateDischargeAnalysis() {
    if (this.batteryHistory.length < 2) {
      console.log(`[Discharge Analysis] Insufficient history: ${this.batteryHistory.length} points`);
      return null;
    }

    // Get data from last hour, or use all available data if less than 1 hour
    const oneHourAgo = Date.now() - 3600000;
    let recentData = this.batteryHistory.filter(d => d.timestamp >= oneHourAgo);
    
    // If we don't have data from the last hour, use all available data
    if (recentData.length < 2) {
      recentData = this.batteryHistory;
      console.log(`[Discharge Analysis] Using all ${recentData.length} data points (less than 1 hour old)`);
    } else {
      console.log(`[Discharge Analysis] Using ${recentData.length} data points from last hour`);
    }
    
    if (recentData.length < 2) {
      return null;
    }

    // Calculate average discharge rate
    const dischargingPeriods = [];
    for (let i = 1; i < recentData.length; i++) {
      if (!recentData[i].isCharging && !recentData[i-1].isCharging) {
        const timeDiff = (recentData[i].timestamp - recentData[i-1].timestamp) / 60000; // minutes
        const percentDiff = recentData[i-1].percent - recentData[i].percent;
        if (timeDiff > 0 && percentDiff > 0) {
          dischargingPeriods.push({
            rate: percentDiff / timeDiff,
            time: recentData[i].timestamp
          });
        }
      }
    }

    if (dischargingPeriods.length === 0) {
      return null;
    }

    const avgRate = dischargingPeriods.reduce((sum, p) => sum + p.rate, 0) / dischargingPeriods.length;
    const maxRate = Math.max(...dischargingPeriods.map(p => p.rate));
    const minRate = Math.min(...dischargingPeriods.map(p => p.rate));

    // Estimate time to 0%
    const currentPercent = this.lastBatteryState?.percent || 0;
    const estimatedMinutes = avgRate > 0 ? currentPercent / avgRate : 0;

    return {
      avgRatePerMinute: Math.round(avgRate * 100) / 100,
      avgRatePerHour: Math.round(avgRate * 60 * 100) / 100,
      maxRatePerMinute: Math.round(maxRate * 100) / 100,
      minRatePerMinute: Math.round(minRate * 100) / 100,
      estimatedTimeToEmpty: Math.round(estimatedMinutes),
      dataPoints: dischargingPeriods.length
    };
  }

  /**
   * Get usage history comparison (daily/weekly)
   */
  getUsageHistory() {
    // Return partial data even with less than 10 points for better UX
    if (this.batteryHistory.length < 2) {
      console.log(`[Usage History] Insufficient data: ${this.batteryHistory.length} data points (need 2+)`);
      return null;
    }

    const now = Date.now();
    const oneDayAgo = now - 86400000; // 24 hours
    const twoDaysAgo = now - 172800000; // 48 hours
    const oneWeekAgo = now - 604800000; // 7 days

    // Calculate today's usage
    const todayData = this.batteryHistory.filter(d => d.timestamp >= oneDayAgo);
    const yesterdayData = this.batteryHistory.filter(d => d.timestamp >= twoDaysAgo && d.timestamp < oneDayAgo);
    const weekData = this.batteryHistory.filter(d => d.timestamp >= oneWeekAgo);

    console.log(`[Usage History] Data points - Today: ${todayData.length}, Yesterday: ${yesterdayData.length}, Week: ${weekData.length}`);

    const calculateUsageTime = (data) => {
      if (data.length === 0) return 0;
      // Estimate active time when battery is discharging
      const dischargingTime = data.filter(d => !d.isCharging).length * 5; // 5 minutes per data point
      return Math.round(dischargingTime / 60 * 10) / 10; // Convert to hours
    };

    const calculateAverageBattery = (data) => {
      if (data.length === 0) return 0;
      return Math.round(data.reduce((sum, d) => sum + d.percent, 0) / data.length);
    };

    const result = {
      today: {
        activeHours: calculateUsageTime(todayData),
        avgBatteryLevel: calculateAverageBattery(todayData),
        dataPoints: todayData.length
      },
      yesterday: {
        activeHours: calculateUsageTime(yesterdayData),
        avgBatteryLevel: calculateAverageBattery(yesterdayData),
        dataPoints: yesterdayData.length
      },
      thisWeek: {
        activeHours: calculateUsageTime(weekData),
        avgBatteryLevel: calculateAverageBattery(weekData),
        dataPoints: weekData.length,
        dailyAverage: calculateUsageTime(weekData) / 7
      },
      // Additional metadata for last 7 days
      last7Days: {
        activeHours: calculateUsageTime(weekData),
        avgBatteryLevel: calculateAverageBattery(weekData),
        dataPoints: weekData.length
      },
      totalActiveHours: calculateUsageTime(this.batteryHistory)
    };

    console.log(`[Usage History] Calculated - Today: ${result.today.activeHours}h, Yesterday: ${result.yesterday.activeHours}h, Week: ${result.thisWeek.activeHours}h`);

    return result;
  }

  /**
   * Shutdown battery service
   */
  shutdown() {
    console.log('Shutting down battery service...');
    this.stopMonitoring();
    this.saveSettings();
    
    // Save tracking data before shutdown
    this.savePersistentTracking();
    
    this.db.addLog('battery', 'Battery service shut down', null, 'info');
  }
}

module.exports = BatteryService;
