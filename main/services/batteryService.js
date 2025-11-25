/**
 * Battery Service
 * Monitors battery health, trends, and provides optimization recommendations
 * with adaptive polling and intelligent alerting
 */

const si = require('systeminformation');
const { app, Notification } = require('electron');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class BatteryService {
  constructor(dbService, mainWindow = null) {
    this.db = dbService;
    this.mainWindow = mainWindow;
    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.processTrackingInterval = null; // Separate interval for process tracking
    this.getUserId = null; // Function to get current user ID
    
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
    this.processTracking = new Map(); // pid -> {name, startTime, totalCpu, totalMem, samples, sessionId}
    this.processHistory = []; // Historical process data for battery impact
    this.maxProcessHistory = 100; // Keep last 100 samples
    this.lastProcessTrackingTime = null; // Track when we last updated process tracking
    
    // Enhanced tracking with database persistence
    this.processSessionIds = new Map(); // pid -> sessionId for database linking
    this.lastProcessSnapshot = new Map(); // pid -> last known data for change detection
    
    // Error handling and self-repair
    this.monitoringErrors = 0;
    this.maxConsecutiveErrors = 5;
    this.lastSuccessfulUpdate = Date.now();
    this.healthCheckInterval = null;
    this.isRecovering = false;
    
    // Cache for analytics to avoid slow calls
    this.cachedAnalytics = null;
    this.cachedUsageInsights = null; // Cache for usage insights (30s TTL)
    
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
   * Set function to get current user ID
   * Also clears caches when user changes to ensure fresh data
   */
  setUserIdProvider(getUserIdFn) {
    this.getUserId = getUserIdFn;
  }

  /**
   * Clear cached insights when user changes
   * Call this when user logs in/out to ensure fresh data
   */
  clearUserCache() {
    this.cachedUsageInsights = null;
    this.cachedAnalytics = null;
    console.log('[Battery Service] User cache cleared for fresh data');
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
        const userId = this.getUserId ? this.getUserId() : null;
        this.db.addLog('battery', 'No battery detected on this device', null, 'info', userId);
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
      
      // VERIFY: Test pidusage is working before starting process tracking
      try {
        const pidusageTest = require('pidusage');
        const testPid = process.pid;
        const testResult = await pidusageTest(testPid);
        console.log(`[Battery Init] ✅ pidusage verified! Current process CPU: ${testResult.cpu.toFixed(2)}%`);
      } catch (pidError) {
        console.error('[Battery Init] ❌ pidusage test FAILED:', pidError.message);
        console.error('[Battery Init] ⚠️ CPU tracking will not work properly! Install: npm install pidusage');
        const userId = this.getUserId ? this.getUserId() : null;
        this.db.addLog('battery', 'pidusage module test failed - CPU tracking unavailable', {
          error: pidError.message
        }, 'error', userId);
      }
      
      // OPTIMIZED: Start process tracking quickly and run frequently
      // First scan after 2 seconds for immediate data
      console.log('[Battery Init] Scheduling IMMEDIATE initial process scan (2s)...');
      setTimeout(() => {
        console.log('[Battery Init] Running first quick process scan...');
        this.updateProcessTrackingAsync().catch(err => {
          console.error('Initial process scan failed (non-critical):', err);
        });
      }, 2000); // Wait only 2 seconds for first data
      
      // Schedule regular updates every 8 seconds for real-time tracking
      this.processTrackingInterval = setInterval(() => {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Battery Service] Running scheduled process tracking update...');
        }
        this.updateProcessTrackingAsync().catch(err => {
          console.error('Scheduled process scan failed (non-critical):', err);
        });
      }, 8000); // Every 8 seconds for responsive updates (was 120000)
      
      // Schedule data retention cleanup (keep 30 days)
      this.scheduleDataRetention(30);
      
      // Auto-cleanup old app usage data daily
      this.scheduleAppUsageCleanup();
      
      // Start health check monitor
      this.startHealthCheck();
      
      // Auto-save tracking data every 2 minutes for persistence
      this.trackingSaveInterval = setInterval(() => {
        this.savePersistentTracking();
      }, 120000); // Every 2 minutes
      
      const userId = this.getUserId ? this.getUserId() : null;
      this.db.addLog('battery', 'Battery service initialized successfully', {
        mode: this.currentMode,
        hasBattery: true,
        initialPercent: this.lastBatteryState.percent
      }, 'info', userId);
      
      console.log('Battery service initialized successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to initialize battery service:', error);
      const userId = this.getUserId ? this.getUserId() : null;
      this.db.addLog('battery', 'Failed to initialize battery service', {
        error: error.message
      }, 'error', userId);
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
   * BEHAVIOR:
   * - ALWAYS starts fresh on new boot session (laptop restart)
   * - All app tracking counters reset to 0 on each boot
   * - Only tracks apps launched in current boot session
   * - This ensures accurate "time since app opened" without carrying over old data
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
      
      // Check if this is the same boot session as last time FortiMorph ran
      const lastBootTime = this.db.getSetting('last_system_boot_time');
      const bootTimeChanged = !lastBootTime || Math.abs(parseInt(lastBootTime) - this.systemBootTime) > 60000; // 1 min tolerance
      
      if (bootTimeChanged) {
        // NEW BOOT SESSION - Start fresh (this is what user wants)
        console.log('🔄 New boot session detected - starting fresh tracking (all counters reset to 0)');
        this.clearPersistentTracking();
        this.db.setSetting('last_system_boot_time', this.systemBootTime.toString());
      } else {
        // SAME BOOT SESSION - But still start fresh for accurate tracking
        // REASON: Even in same boot, we want to track from NOW, not restore old times
        // This prevents the 19-day issue from persisting across FortiMorph restarts
        console.log('✅ Same boot session detected, but starting fresh tracking');
        console.log('   (This ensures accurate "time since app opened" counts)');
        this.clearPersistentTracking();
        
        // DON'T RESTORE OLD DATA - always start fresh
        // This way, running times are accurate from when user opens FortiMorph
      }
      
    } catch (error) {
      console.error('Error loading persistent tracking:', error);
    }
  }

  /**
   * Save persistent tracking data to database
   * This allows tracking to survive app restarts
   * OPTIMIZED: Non-blocking, debounced saves to prevent performance issues
   */
  savePersistentTracking() {
    try {
      // Throttle saves to prevent excessive writes (max once per 30 seconds)
      const now = Date.now();
      if (this.lastTrackingSave && (now - this.lastTrackingSave) < 30000) {
        return; // Too soon, skip save
      }
      this.lastTrackingSave = now;
      
      // Convert Map to array for JSON serialization
      const processTrackingArray = Array.from(this.processTracking.entries()).map(([pid, data]) => ({
        pid,
        data
      }));
      
      const trackingData = {
        systemBootTime: this.systemBootTime,
        sessionStartTime: this.sessionStartTime,
        lastSaveTime: now,
        processTracking: processTrackingArray,
        processHistory: this.processHistory.slice(-50) // Keep last 50 history points
      };
      
      // Save asynchronously to avoid blocking
      setImmediate(() => {
        try {
          this.db.setSetting('process_tracking_data', JSON.stringify(trackingData));
          if (process.env.NODE_ENV === 'development') {
            console.log(`💾 Saved tracking data for ${processTrackingArray.length} processes`);
          }
        } catch (error) {
          console.error('Error during async tracking save:', error);
        }
      });
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
    
    if (this.processTrackingInterval) {
      clearInterval(this.processTrackingInterval);
      this.processTrackingInterval = null;
    }
    
    console.log('Battery monitoring stopped');
    const userId = this.getUserId ? this.getUserId() : null;
    this.db.addLog('battery', 'Battery monitoring stopped', null, 'info', userId);
  }

  /**
   * Collect battery data and check alerts
   */
  async collectBatteryData() {
    try {
      // Reduced logging - only log every 10th collection to avoid console spam
      const shouldLog = !this._collectionCount || this._collectionCount % 10 === 0;
      this._collectionCount = (this._collectionCount || 0) + 1;
      
      if (shouldLog && process.env.NODE_ENV === 'development') {
        console.log('[Battery Monitoring] Collecting battery data... (logged every 10th collection)');
      }
      
      const batteryData = await this.getBatteryData();
      
      // Store in history
      this.addToHistory(batteryData);
      
      // Check alert rules
      await this.checkAlerts(batteryData);
      
      // Update last state
      this.lastBatteryState = batteryData;
      
      // Process tracking is now handled by separate interval in initialize()
      // No need to trigger it here
      
      // Adjust polling based on charging state
      await this.adjustPolling(batteryData);
      
      // Log to database periodically (every 5 minutes)
      if (this.shouldLogToDatabase()) {
        const userId = this.getUserId ? this.getUserId() : null;
        this.db.addLog('battery', 'Battery data collected', {
          percent: batteryData.percent,
          isCharging: batteryData.isCharging,
          mode: this.currentMode
        }, 'debug', userId);
      }
      
      // Reset error counter on success
      this.monitoringErrors = 0;
      this.lastSuccessfulUpdate = Date.now();
      
      return batteryData;
      
    } catch (error) {
      this.monitoringErrors++;
      console.error('Error collecting battery data:', error);
      
      // Log error but continue service
      const userId = this.getUserId ? this.getUserId() : null;
      this.db.addLog('battery', 'Error collecting battery data', {
        error: error.message,
        consecutiveErrors: this.monitoringErrors
      }, 'error', userId);
      
      // Attempt recovery if too many consecutive errors
      if (this.monitoringErrors >= this.maxConsecutiveErrors) {
        await this.attemptRecovery();
      }
      
      return null;
    }
  }

  /**
   * Get current battery data
   */
  async getBatteryData() {
    try {
      const battery = await si.battery();
      
      // If no battery detected, return safe defaults
      if (!battery || !battery.hasBattery) {
        return this.getSafeBatteryData();
      }
      
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
      
      // Return safe defaults instead of throwing
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Battery Data] Returning safe defaults due to error');
      }
      
      return this.getSafeBatteryData();
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
    
    // Reduced logging - only log significant milestones
    if (this.batteryHistory.length === 1 || this.batteryHistory.length % 50 === 0) {
      console.log(`[Battery History] Total history: ${this.batteryHistory.length} points`);
    }
  }

  /**
   * Get 24-hour battery trend
   */
  getBatteryTrend() {
    return this.batteryHistory;
  }

  /**
   * Check alert rules and trigger if needed
   * Now includes system-level notifications
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
          const userId = this.getUserId ? this.getUserId() : null;
          this.db.addLog('battery', `Battery alert: ${alert.message}`, alert, rule.type, userId);
          
          // Show system notification
          this.showSystemNotification(alert);
          
          console.log(`Battery alert triggered: ${rule.id} - ${alert.message}`);
        }
        
      } catch (error) {
        console.error(`Error checking alert rule ${rule.id}:`, error);
      }
    }
  }

  /**
   * Set main window reference (for notification click handling)
   */
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * Show system-level notification (appears on user's device, not just in-app)
   * @param {Object} alert - Alert object with message, type, and action
   */
  showSystemNotification(alert) {
    try {
      // Check if notifications are supported
      if (!Notification.isSupported()) {
        console.log('[Battery Notification] System notifications not supported on this platform');
        return;
      }
      
      // Determine urgency and icon based on alert type
      let urgency = 'normal';
      let icon = null;
      
      if (alert.type === 'critical') {
        urgency = 'critical';
      } else if (alert.type === 'warning') {
        urgency = 'normal';
      } else {
        urgency = 'low';
      }
      
      // Create notification
      const notification = new Notification({
        title: `FortiMorph Battery Alert - ${alert.type.toUpperCase()}`,
        body: `${alert.message}\n\n${alert.action}`,
        urgency: urgency,
        silent: alert.type === 'info', // Silent for info alerts
        timeoutType: alert.type === 'critical' ? 'never' : 'default',
        // Add custom sound for critical alerts
        sound: alert.type === 'critical' ? 'default' : undefined
      });
      
      // Add click handler to focus the app window
      notification.on('click', () => {
        if (this.mainWindow) {
          if (this.mainWindow.isMinimized()) {
            this.mainWindow.restore();
          }
          this.mainWindow.focus();
          this.mainWindow.show();
        }
      });
      
      // Show the notification
      notification.show();
      
      console.log(`[Battery Notification] System notification shown: ${alert.message}`);
      
    } catch (error) {
      console.error('[Battery Notification] Failed to show system notification:', error);
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
    const userId = this.getUserId ? this.getUserId() : null;
    this.db.addLog('battery', 'Battery alerts cleared', null, 'info', userId);
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
    
    const userId = this.getUserId ? this.getUserId() : null;
    this.db.addLog('battery', `Optimization mode changed: ${oldMode} → ${mode}`, {
      oldMode,
      newMode: mode,
      interval: this.pollingIntervals[mode]
    }, 'info', userId);
    
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
    
    const userId = this.getUserId ? this.getUserId() : null;
    this.db.addLog('battery', 'Alert thresholds updated', newThresholds, 'info', userId);
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
   * Schedule app usage data cleanup (runs daily)
   */
  scheduleAppUsageCleanup() {
    // Run cleanup daily at 3 AM
    const scheduleCleanup = () => {
      const now = new Date();
      const next3AM = new Date();
      next3AM.setHours(3, 0, 0, 0);
      
      if (next3AM < now) {
        next3AM.setDate(next3AM.getDate() + 1);
      }
      
      const timeUntil3AM = next3AM.getTime() - now.getTime();
      
      setTimeout(() => {
        try {
          this.db.cleanupOldAppUsageData();
          console.log('App usage data cleanup completed');
        } catch (error) {
          console.error('Error during app usage cleanup:', error);
        }
        
        // Schedule next cleanup
        scheduleCleanup();
      }, timeUntil3AM);
    };
    
    scheduleCleanup();
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
   * OPTIMIZED: Much faster now - uses Windows fallback immediately for better performance
   */
  async updateProcessTrackingAsync() {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Process Tracking] Starting background update...');
      }
      
      // On Windows, ALWAYS use the fast native method (tasklist)
      // systeminformation is too slow on Windows
      if (process.platform === 'win32') {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Process Tracking] Using fast Windows tasklist method');
        }
        await this.updateProcessTrackingWindows();
        return;
      }
      
      // On Linux/Mac, use systeminformation
      const si = require('systeminformation');
      
      // Get process info with timeout
      const processesPromise = si.processes();
      const timeoutPromise = new Promise((resolve) => 
        setTimeout(() => {
          if (process.env.NODE_ENV === 'development') {
            console.log('[Process Tracking] Timeout reached (5s)');
          }
          return resolve({ list: [] });
        }, 5000)
      );
      const processes = await Promise.race([processesPromise, timeoutPromise]);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Process Tracking] Got ${processes.list?.length || 0} processes from system`);
      }
      
      // Update tracking if we got data
      if (processes.list && processes.list.length > 0) {
        this.updateProcessTracking(processes.list);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Process Tracking] ✅ Updated: ${this.processTracking.size} processes being tracked`);
        }
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Process Tracking] ⚠️ No process data received - will retry on next cycle');
        }
      }
    } catch (error) {
      // Log but don't throw - this is background work
      console.error('[Process Tracking] ❌ Background update failed:', error.message);
      
      // Don't count process tracking errors towards service recovery
      // These are non-critical and expected to fail occasionally
    }
  }

  /**
   * Fallback process tracking using Windows tasklist command with REAL CPU data
   * OPTIMIZED: Uses pidusage for accurate CPU percentages
   */
  async updateProcessTrackingWindows() {
    try {
      console.log('[Process Tracking Windows] Using pidusage for accurate CPU tracking...');
      
      // Step 1: Get process list with PIDs and memory (fast)
      const { stdout } = await execAsync(
        'wmic process get ProcessId,CreationDate,Name,WorkingSetSize /FORMAT:CSV',
        { 
          timeout: 5000, // Increased timeout for stability
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 10
        }
      );

      const rawLines = stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (rawLines.length < 2) {
        console.log('[Process Tracking Windows] ⚠️ No CSV output from wmic');
        return;
      }

      // Parse CSV
      const headerLine = rawLines[0];
      const headers = headerLine.split(',').map(h => h.trim());
      const dataLines = rawLines.slice(1);
      const processMap = new Map(); // pid -> {name, mem, started}
      const pidsToCheck = [];

      for (const line of dataLines) {
        const parts = line.split(',');
        if (parts.length < headers.length) continue;

        const entry = {};
        for (let i = 0; i < headers.length && i < parts.length; i++) {
          entry[headers[i]] = parts[i].trim();
        }

        const name = entry.Name || entry.ProcessName || entry.Caption || '';
        const pid = parseInt(entry.ProcessId || entry.PID || entry.ProcessID || '0');
        const memBytes = parseInt(entry.WorkingSetSize || entry.Workingsetsize || '0');
        const creationRaw = entry.CreationDate || entry.Creationdate || '';

        // Parse creationDate
        let started = null;
        if (creationRaw) {
          const match = creationRaw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
          if (match) {
            const [ , y, mo, d, hh, mm, ss ] = match;
            try {
              started = new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}`);
              if (!isNaN(started.getTime())) started = started.getTime(); else started = null;
            } catch (e) {
              started = null;
            }
          }
        }

        // Filter: Only track processes with >10MB RAM
        if (pid > 0 && memBytes > 10 * 1024 * 1024 && name) {
          const memMB = memBytes / (1024 * 1024);
          const totalMemGB = require('os').totalmem() / (1024 * 1024 * 1024);
          const memPercent = (memMB / 1024 / totalMemGB) * 100;

          processMap.set(pid, { name, memPercent, started });
          pidsToCheck.push(pid);
        }
      }
      
      if (pidsToCheck.length === 0) {
        console.log('[Process Tracking Windows] ⚠️ No processes found with >10MB RAM');
        return;
      }

      // Step 2: Get REAL CPU usage for these PIDs using pidusage (fast, accurate)
      let pidusage;
      try {
        pidusage = require('pidusage');
      } catch (requireError) {
        console.error('[Process Tracking Windows] ❌ pidusage module not found! Install with: npm install pidusage');
        throw new Error('pidusage module required for CPU tracking');
      }
      
      let cpuStats = {};
      
      try {
        // Get CPU stats for all PIDs at once (efficient)
        cpuStats = await pidusage(pidsToCheck);
      } catch (error) {
        // Some PIDs may have exited, get stats individually
        console.log('[Process Tracking Windows] Batch CPU fetch failed, trying individually...');
        for (const pid of pidsToCheck) {
          try {
            cpuStats[pid] = await pidusage(pid);
          } catch (e) {
            // Process exited, skip it (this is normal)
          }
        }
      }

      // Step 3: Build process list with REAL CPU data
      const processes = [];
      for (const [pid, stats] of Object.entries(cpuStats)) {
        const pidNum = parseInt(pid);
        const processInfo = processMap.get(pidNum);
        if (!processInfo) continue;

        processes.push({
          pid: pidNum,
          name: processInfo.name,
          command: processInfo.name,
          cpu: stats.cpu || 0, // ✅ REAL CPU percentage!
          memVsTotal: processInfo.memPercent,
          started: processInfo.started
        });
      }
      
      if (processes.length > 0) {
        this.updateProcessTracking(processes);
        console.log(`[Process Tracking Windows] ✅ Tracked ${processes.length} processes with REAL CPU data (total tracking: ${this.processTracking.size})`);
        
        // Log sample of CPU data for verification
        const sampleProcesses = processes.slice(0, 3).filter(p => p.cpu > 0);
        if (sampleProcesses.length > 0) {
          console.log('[Process Tracking Windows] Sample CPU data:', 
            sampleProcesses.map(p => `${p.name}: ${p.cpu.toFixed(1)}%`).join(', ')
          );
        }
      } else {
        console.log('[Process Tracking Windows] ⚠️ No valid CPU data obtained');
      }
      
    } catch (error) {
      console.error('[Process Tracking Windows] ❌ Failed:', error.message);
      
      // Enhanced fallback: Try PowerShell for CPU data
      try {
        console.log('[Process Tracking Windows] Trying PowerShell fallback...');
        const psScript = `Get-Process | Select-Object Name, Id, CPU, WorkingSet64 | ConvertTo-Json -Compress`;
        const { stdout } = await execAsync(
          `powershell -NoProfile -Command "${psScript}"`,
          { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 * 10 }
        );
        
        const psData = JSON.parse(stdout);
        const processes = [];
        const totalMemGB = require('os').totalmem() / (1024 * 1024 * 1024);
        
        for (const proc of (Array.isArray(psData) ? psData : [psData])) {
          if (proc.Id && proc.WorkingSet64 > 10 * 1024 * 1024) {
            const memMB = proc.WorkingSet64 / (1024 * 1024);
            const memPercent = (memMB / 1024 / totalMemGB) * 100;
            
            processes.push({
              pid: proc.Id,
              name: proc.Name || 'Unknown',
              command: proc.Name || 'Unknown',
              cpu: proc.CPU || 0, // PowerShell gives total CPU seconds, convert to %
              memVsTotal: memPercent,
              started: null
            });
          }
        }
        
        if (processes.length > 0) {
          this.updateProcessTracking(processes);
          console.log(`[Process Tracking Windows] ✅ PowerShell fallback: tracked ${processes.length} processes`);
        }
      } catch (fallbackError) {
        console.error('[Process Tracking Windows] ❌ PowerShell fallback failed:', fallbackError.message);
        console.error('[Process Tracking Windows] ❌ All tracking methods failed - no process data available');
      }
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
   * CRITICAL FIX:
   * - ALWAYS tracks from when WE FIRST DISCOVER the process (NOW)
   * - NEVER uses Windows process start time (causes 19-day issue)
   * - Shows "time tracked by FortiMorph" not "time process has been running"
   * - This is what user wants: count starts when FortiMorph sees the app
   */
  updateProcessTracking(processList) {
    const now = Date.now();
    const currentPids = new Set();
    const isDev = process.env.NODE_ENV === 'development';
    
    // Update or add processes
    processList.forEach(proc => {
      if (proc.cpu > 0.05 || proc.memVsTotal > 0) { // Track even minimal activity for accuracy
        currentPids.add(proc.pid);
        
        if (!this.processTracking.has(proc.pid)) {
          // NEW PROCESS DETECTED
          // CRITICAL: ALWAYS use NOW as start time, completely ignore proc.started
          // This ensures we ONLY track from when WE discover the process
          // NOT from when Windows says it started (which could be 19 days ago)
          const processStartTime = now; // ALWAYS NOW, NEVER use proc.started
          
          if (isDev) {
            // Log for debugging but don't use the Windows start time
            if (proc.started) {
              try {
                let parsedTime;
                if (typeof proc.started === 'number') {
                  parsedTime = proc.started;
                } else {
                  const startDate = new Date(proc.started);
                  if (!isNaN(startDate.getTime())) {
                    parsedTime = startDate.getTime();
                  }
                }
                
                if (parsedTime) {
                  const windowsAge = (now - parsedTime) / 86400000; // days
                  console.log(`[Process Tracking] NEW: ${proc.name} (PID: ${proc.pid}) - Windows says ${windowsAge.toFixed(1)}d old, but tracking from NOW`);
                }
              } catch (e) {
                console.log(`[Process Tracking] NEW: ${proc.name} (PID: ${proc.pid}) - Tracking from NOW`);
              }
            } else {
              console.log(`[Process Tracking] NEW: ${proc.name} (PID: ${proc.pid}) - Tracking from NOW`);
            }
          }
          
          // Generate unique session ID for database linking
          const sessionId = `${proc.pid}_${processStartTime}_${Math.random().toString(36).substr(2, 9)}`;
          this.processSessionIds.set(proc.pid, sessionId);
          
          // Store new process - startTime is ALWAYS when WE discovered it
          this.processTracking.set(proc.pid, {
            name: proc.name || 'Unknown',
            command: proc.command || proc.name || 'N/A',
            startTime: processStartTime, // NOW - when we first saw this process
            totalCpu: proc.cpu || 0,
            totalMem: proc.memVsTotal || 0,
            samples: 1,
            lastSeen: now,
            peakCpu: proc.cpu || 0,
            peakMem: proc.memVsTotal || 0,
            sessionId
          });
          
          // Start database session with user ID
          try {
            const userId = this.getUserId ? this.getUserId() : null;
            this.db.startAppSession(sessionId, proc.name || 'Unknown', proc.command || proc.name || 'N/A', proc.pid, userId);
          } catch (err) {
            console.error('Failed to start app session in DB:', err);
          }
        } else {
          // UPDATE EXISTING PROCESS
          const tracked = this.processTracking.get(proc.pid);
          const cpuDelta = proc.cpu || 0;
          const memDelta = proc.memVsTotal || 0;
          
          tracked.totalCpu += cpuDelta;
          tracked.totalMem += memDelta;
          tracked.samples++;
          tracked.lastSeen = now;
          tracked.peakCpu = Math.max(tracked.peakCpu, cpuDelta);
          tracked.peakMem = Math.max(tracked.peakMem, memDelta);
          
          // Calculate battery impact for this sample
          const runningMinutes = (now - tracked.startTime) / 60000;
          const batteryImpact = (cpuDelta * 0.5) + (memDelta * 0.1); // Weighted impact score
          
          // Update database session
          try {
            const userId = this.getUserId ? this.getUserId() : null;
            this.db.updateAppSession(tracked.sessionId, cpuDelta, memDelta, batteryImpact);
            
            // Record snapshot for historical analytics with user ID
            const recorded = this.db.recordAppUsage(
              tracked.name,
              tracked.command,
              proc.pid,
              tracked.sessionId,
              cpuDelta,
              memDelta,
              batteryImpact,
              userId
            );
            
            // Log occasionally for debugging
            if (isDev && this._recordCount % 100 === 0) {
              console.log(`[DB] Recorded app usage: ${tracked.name} (CPU: ${cpuDelta.toFixed(1)}%, Impact: ${batteryImpact.toFixed(1)})`);
            }
            this._recordCount = (this._recordCount || 0) + 1;
          } catch (err) {
            console.error('Failed to update app session in DB:', err);
          }
        }
      }
    });
    
    // GHOST PROCESS PREVENTION: Remove processes that are no longer running
  // Check if process hasn't been seen in last ~24 seconds (3x tracking cycle)
  // This prevents flickering when scans are delayed while ensuring closed apps are removed
  const removalThreshold = now - 24000;
    const closedProcesses = [];
    
    for (const [pid, data] of this.processTracking.entries()) {
      if (data.lastSeen < removalThreshold && !currentPids.has(pid)) {
        closedProcesses.push({ pid, name: data.name, sessionId: data.sessionId });
        
        // End database session
        try {
          this.db.endAppSession(data.sessionId);
        } catch (err) {
          console.error('Failed to end app session in DB:', err);
        }
        
        this.processTracking.delete(pid);
        this.processSessionIds.delete(pid);
      }
    }
    
    // Log closed processes in dev mode
    if (isDev && closedProcesses.length > 0) {
      console.log(`[Process Tracking] CLOSED: ${closedProcesses.map(p => p.name).join(', ')}`);
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
    
    // Data now persists in database - no need for in-memory persistence across sessions
  }

  /**
   * Get top battery-draining processes with enhanced metrics
   * OPTIMIZED: Simple, fast calculation focused on current session impact
   */
  getTopBatteryDrainingProcesses() {
    const now = Date.now();
    const processes = [];
    
    console.log(`[Top Processes] Processing ${this.processTracking.size} tracked processes`);
    
    // If no processes tracked yet, return empty array
    if (this.processTracking.size === 0) {
      console.log('[Top Processes] ⚠️ No processes tracked yet - returning empty array');
      return [];
    }
    
    for (const [pid, data] of this.processTracking.entries()) {
      // Calculate running time from when we started tracking this process
      const runningTime = now - data.startTime; // milliseconds
      const runningMinutes = runningTime / 60000;
      const runningHours = runningTime / 3600000;
      
      // Calculate average CPU and memory usage
      const avgCpu = data.samples > 0 ? data.totalCpu / data.samples : 0;
      const avgMem = data.samples > 0 ? data.totalMem / data.samples : 0;
      
      // SIMPLIFIED BATTERY IMPACT CALCULATION:
      // Impact = Average CPU% * Minutes Running + Average Memory% * Minutes Running * 0.2
      // This is straightforward and shows real impact during current session
      const batteryImpact = (avgCpu * runningMinutes) + (avgMem * runningMinutes * 0.2);
      
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
          : runningHours < 24
          ? `${Math.floor(runningHours)}h ${Math.round(runningMinutes % 60)}m`
          : `${Math.floor(runningHours / 24)}d ${Math.floor(runningHours % 24)}h`,
        runningTimeMinutes: Math.round(runningMinutes),
        runningTimeHours: Math.round(runningHours * 10) / 10,
        batteryImpact: Math.round(batteryImpact),
        samples: data.samples
      });
    }
    
    // Sort by battery impact (highest first)
    processes.sort((a, b) => b.batteryImpact - a.batteryImpact);
    
    // Return ALL processes (no limit) - user wants to see everything
    console.log(`[Top Processes] ✅ Returning ALL ${processes.length} tracked processes`);
    if (processes.length > 0) {
      console.log(`[Top Processes] Top 3 by impact:`, 
        processes.slice(0, 3).map(p => 
          `${p.name}(${p.runningTime}, ${p.avgCpu}% CPU, impact:${p.batteryImpact})`
        ).join(' | ')
      );
    }
    
    return processes; // Return ALL, not limited
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
   * Get historical app usage analytics from database
   * @param {string} timeframe - 'today', 'yesterday', 'last_week', 'last_month'
   * @param {string} userId - User ID for filtering data
   * @returns {Object} Historical app usage data with percentages
   */
  async getHistoricalAppUsageAnalytics(timeframe = 'today', userId = null) {
    try {
      // Get current time for accurate logging
      const now = new Date();
      const timeRangeInfo = this.getTimeframeInfo(timeframe);
      
      console.log(`[Usage Analytics] Fetching ${timeframe}:`);
      console.log(`  Range: ${timeRangeInfo.startDate} to ${timeRangeInfo.endDate}`);
      
      // Get app usage data from database with user filtering
      const appUsageData = this.db.getHistoricalAppUsage(timeframe, userId);
      
      console.log(`[Usage Analytics] ${timeframe}: Found ${appUsageData ? appUsageData.length : 0} apps`);
      
      // CRITICAL FIX: For ALL timeframes, if no historical data exists, show current running apps
      // This ensures users ALWAYS see data immediately, not "no data available"
      if (!appUsageData || appUsageData.length === 0) {
        console.log(`[Usage Analytics] ${timeframe}: No historical data - using current process data`);
        
        // If we have current process tracking data, show it for ALL timeframes
        if (this.processTracking.size > 0) {
          const currentApps = this.getCurrentProcessesAsUsageData();
          const totalImpact = currentApps.reduce((sum, app) => sum + app.totalBatteryImpact, 0);
          
          return {
            timeframe,
            timeRange: timeRangeInfo,
            apps: currentApps,
            totalImpact: Math.round(totalImpact),
            message: `Showing current running apps (${timeframe} historical data will accumulate over time)`,
            isRealTime: true,
            totalAppsTracked: currentApps.length
          };
        }
        
        console.log(`[Usage Analytics] ${timeframe}: No data available`);
        return {
          timeframe,
          timeRange: timeRangeInfo,
          apps: [],
          totalImpact: 0,
          message: this.getNoDataMessage(timeframe)
        };
      }
      
      // Get total battery impact for percentage calculations (with user filtering)
      const totalImpact = this.db.getTotalBatteryImpact(timeframe, userId);
      
      console.log(`[Usage Analytics] ${timeframe}: Total impact = ${totalImpact.toFixed(1)}`);
      
      // Calculate percentages and format data
      const apps = appUsageData.map(app => {
        const percentOfTotal = totalImpact > 0 ? (app.total_battery_impact / totalImpact) * 100 : 0;
        
        // Determine impact category
        let impactCategory;
        if (percentOfTotal >= 20) {
          impactCategory = 'Heavy';
        } else if (percentOfTotal >= 10) {
          impactCategory = 'Moderate';
        } else if (percentOfTotal >= 5) {
          impactCategory = 'Light';
        } else {
          impactCategory = 'Minimal';
        }
        
        return {
          name: app.app_name,
          command: app.app_command,
          avgCpu: Math.round(app.avg_cpu * 10) / 10,
          avgMemory: Math.round(app.avg_memory * 10) / 10,
          totalBatteryImpact: Math.round(app.total_battery_impact),
          peakBatteryImpact: Math.round(app.peak_battery_impact),
          percentOfTotal: Math.round(percentOfTotal * 10) / 10,
          impactCategory: impactCategory
        };
      });
      
      // Sort by percent of total (highest first)
      apps.sort((a, b) => b.percentOfTotal - a.percentOfTotal);
      
      return {
        timeframe,
        timeRange: timeRangeInfo,
        apps: apps, // Return ALL tracked apps (no limit)
        totalImpact: Math.round(totalImpact),
        totalAppsTracked: appUsageData.length
      };
    } catch (error) {
      console.error('Error getting historical app usage analytics:', error);
      return {
        timeframe,
        apps: [],
        totalImpact: 0,
        error: error.message
      };
    }
  }

  /**
   * Get human-readable timeframe information
   */
  getTimeframeInfo(timeframe) {
    const now = new Date();
    let startDate, endDate;
    
    switch (timeframe) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        endDate = now;
        break;
      case 'yesterday':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        break;
      case 'last_week':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
        endDate = now;
        break;
      case 'last_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);
        endDate = now;
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        endDate = now;
    }
    
    return {
      startDate: startDate.toLocaleString(),
      endDate: endDate.toLocaleString(),
      days: Math.ceil((endDate - startDate) / 86400000)
    };
  }

  /**
   * Get appropriate no-data message for timeframe
   */
  getNoDataMessage(timeframe) {
    switch (timeframe) {
      case 'today':
        return 'No apps running yet. Launch some applications to see battery usage data instantly.';
      case 'yesterday':
        return 'No data from yesterday. Showing current running apps as reference.';
      case 'last_week':
        return 'No historical data from past 7 days. Showing current running apps as reference.';
      case 'last_month':
        return 'No historical data from past 30 days. Showing current running apps as reference.';
      default:
        return 'No data available. Open some applications to see usage statistics.';
    }
  }

  /**
   * Get comprehensive usage insights for all timeframes
   * OPTIMIZED: Minimal caching (5s) to show real-time data for new users
   * @param {string} userId - User ID for filtering data
   * @returns {Object} Usage insights for today, yesterday, last week, last month
   */
  async getAllTimeframeUsageInsights(userId = null) {
    try {
      const now = Date.now();
      
      // REDUCED CACHE: Only 5 seconds for responsive data (was 30s)
      // This ensures new users see data almost immediately after first process scan
      if (this.cachedUsageInsights && 
          this.cachedUsageInsights.userId === userId &&
          (now - this.cachedUsageInsights.timestamp) < 5000) {
        console.log('[Usage Insights] Returning cached data (age: ' + 
          Math.round((now - this.cachedUsageInsights.timestamp) / 1000) + 's)');
        return this.cachedUsageInsights.data;
      }
      
      console.log('[Usage Insights] Fetching fresh data from database...');
      
      // Fetch all timeframes (runs in parallel for speed) with user filtering
      const [today, yesterday, lastWeek, lastMonth] = await Promise.all([
        this.getHistoricalAppUsageAnalytics('today', userId),
        this.getHistoricalAppUsageAnalytics('yesterday', userId),
        this.getHistoricalAppUsageAnalytics('last_week', userId),
        this.getHistoricalAppUsageAnalytics('last_month', userId)
      ]);
      
      // If today has no data, try to populate with current running processes
      // This helps new users see immediate data instead of "no usage data"
      if (today.apps.length === 0 && this.processTracking.size > 0) {
        console.log('[Usage Insights] No historical data for today, showing current running processes');
        today.apps = this.getCurrentProcessesAsUsageData();
        today.totalImpact = today.apps.reduce((sum, app) => sum + app.totalBatteryImpact, 0);
        today.message = 'Showing currently running applications (historical data building up)';
        today.isRealTime = true;
      }
      
      // SMART PLACEHOLDER LOGIC: Show exact copy of today's data in other timeframes if they're empty
      // This provides a better user experience for new users
      // If yesterday/week/month returned isRealTime data, it means there's no real historical data
      // so we should replace it with today's data as placeholder
      
      // For yesterday: if it has isRealTime data OR no data at all, use today's data as placeholder
      if ((yesterday.isRealTime || yesterday.apps.length === 0) && today.apps.length > 0) {
        yesterday.apps = JSON.parse(JSON.stringify(today.apps)); // Deep clone
        yesterday.totalImpact = today.totalImpact;
        yesterday.totalAppsTracked = today.totalAppsTracked;
        yesterday.isPlaceholder = true;
        yesterday.placeholderSource = 'today';
        yesterday.message = 'Showing today\'s data as preview. Run FortiMorph for a full day to see actual yesterday\'s usage.';
        yesterday.dataAvailableIn = 'Available after running for 24 hours';
        yesterday.isRealTime = false; // Not real-time for placeholder
      }
      
      // For last week: if it has isRealTime data OR no data at all, use today's data as placeholder
      if ((lastWeek.isRealTime || lastWeek.apps.length === 0) && today.apps.length > 0) {
        lastWeek.apps = JSON.parse(JSON.stringify(today.apps)); // Deep clone
        lastWeek.totalImpact = today.totalImpact;
        lastWeek.totalAppsTracked = today.totalAppsTracked;
        lastWeek.isPlaceholder = true;
        lastWeek.placeholderSource = 'today';
        lastWeek.message = 'Showing today\'s data as preview. Run FortiMorph for 7 days to see weekly trends.';
        lastWeek.dataAvailableIn = 'Available after running for 7 days';
        lastWeek.isRealTime = false;
      }
      
      // For last month: if it has isRealTime data OR no data at all, use today's data as placeholder
      if ((lastMonth.isRealTime || lastMonth.apps.length === 0) && today.apps.length > 0) {
        lastMonth.apps = JSON.parse(JSON.stringify(today.apps)); // Deep clone
        lastMonth.totalImpact = today.totalImpact;
        lastMonth.totalAppsTracked = today.totalAppsTracked;
        lastMonth.isPlaceholder = true;
        lastMonth.placeholderSource = 'today';
        lastMonth.message = 'Showing today\'s data as preview. Run FortiMorph for 30 days to see monthly patterns.';
        lastMonth.dataAvailableIn = 'Available after running for 30 days';
        lastMonth.isRealTime = false;
      }
      
      // Determine if each timeframe has real historical data
      const hasYesterdayData = !yesterday.isPlaceholder && yesterday.apps.length > 0;
      const hasWeekData = !lastWeek.isPlaceholder && lastWeek.apps.length > 0;
      const hasMonthData = !lastMonth.isPlaceholder && lastMonth.apps.length > 0;
      
      const result = {
        today: {
          ...today,
          activeSessionsCount: this.db.getActiveSessionsCountForTimeframe('today', userId),
          hasRealData: true // Today always shows real or real-time data
        },
        yesterday: {
          ...yesterday,
          activeSessionsCount: this.db.getActiveSessionsCountForTimeframe('yesterday', userId),
          hasRealData: hasYesterdayData
        },
        lastWeek: {
          ...lastWeek,
          activeSessionsCount: this.db.getActiveSessionsCountForTimeframe('last_week', userId),
          hasRealData: hasWeekData
        },
        lastMonth: {
          ...lastMonth,
          activeSessionsCount: this.db.getActiveSessionsCountForTimeframe('last_month', userId),
          hasRealData: hasMonthData
        },
        activeSessionsCount: this.db.getActiveSessionsCount(userId),
        generatedAt: new Date().toLocaleString()
      };
      
      // Cache the result with user ID (5 second TTL)
      this.cachedUsageInsights = {
        timestamp: now,
        userId: userId,
        data: result
      };
      
      console.log('[Usage Insights] ✅ Data fetched and cached');
      console.log(`  - Today: ${today.apps.length} apps, ${today.totalImpact} impact${today.isRealTime ? ' (real-time)' : ''}`);
      console.log(`  - Yesterday: ${yesterday.apps.length} apps, ${yesterday.totalImpact} impact`);
      console.log(`  - Last Week: ${lastWeek.apps.length} apps, ${lastWeek.totalImpact} impact`);
      console.log(`  - Last Month: ${lastMonth.apps.length} apps, ${lastMonth.totalImpact} impact`);
      
      return result;
    } catch (error) {
      console.error('Error getting all timeframe usage insights:', error);
      return {
        today: { apps: [], totalImpact: 0, activeSessionsCount: 0, message: 'Error loading data' },
        yesterday: { apps: [], totalImpact: 0, activeSessionsCount: 0, message: 'Error loading data' },
        lastWeek: { apps: [], totalImpact: 0, activeSessionsCount: 0, message: 'Error loading data' },
        lastMonth: { apps: [], totalImpact: 0, activeSessionsCount: 0, message: 'Error loading data' },
        activeSessionsCount: 0,
        error: error.message
      };
    }
  }

  /**
   * Get current running processes formatted as usage data
   * Used as fallback when no historical data exists yet
   * @returns {Array} Array of app usage data from currently tracked processes
   */
  getCurrentProcessesAsUsageData() {
    const apps = [];
    const now = Date.now();
    
    for (const [pid, data] of this.processTracking.entries()) {
      const avgCpu = data.samples > 0 ? data.totalCpu / data.samples : 0;
      const avgMemory = data.samples > 0 ? data.totalMem / data.samples : 0;
      const totalBatteryImpact = (avgCpu * 0.5) + (avgMemory * 0.1);
      
      apps.push({
        name: data.name,
        command: data.command,
        avgCpu: Math.round(avgCpu * 10) / 10,
        avgMemory: Math.round(avgMemory * 10) / 10,
        totalBatteryImpact: Math.round(totalBatteryImpact),
        peakBatteryImpact: Math.round((data.peakCpu * 0.5) + (data.peakMem * 0.1)),
        percentOfTotal: 0, // Will be calculated after we have total
      });
    }
    
    // Calculate percentages and assign impact categories
    const totalImpact = apps.reduce((sum, app) => sum + app.totalBatteryImpact, 0);
    if (totalImpact > 0) {
      apps.forEach(app => {
        app.percentOfTotal = Math.round((app.totalBatteryImpact / totalImpact) * 1000) / 10;
        
        // Assign impact category based on percentage
        if (app.percentOfTotal >= 20) {
          app.impactCategory = 'Heavy';
        } else if (app.percentOfTotal >= 10) {
          app.impactCategory = 'Moderate';
        } else if (app.percentOfTotal >= 5) {
          app.impactCategory = 'Light';
        } else {
          app.impactCategory = 'Minimal';
        }
      });
    }
    
    // Sort by impact
    apps.sort((a, b) => b.totalBatteryImpact - a.totalBatteryImpact);
    
    return apps;
  }

  /**
   * Start health check monitor
   * Monitors service health and auto-restarts if needed
   */
  startHealthCheck() {
    // Check health every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      try {
        const now = Date.now();
        const timeSinceLastUpdate = now - this.lastSuccessfulUpdate;
        
        // If no successful update in 5 minutes, attempt recovery
        if (timeSinceLastUpdate > 300000 && !this.isRecovering) {
          console.warn('[Battery Health Check] No successful update in 5 minutes. Attempting recovery...');
          this.attemptRecovery();
        }
        
        // Dev logging every 5 minutes
        if (process.env.NODE_ENV === 'development') {
          const minutes = Math.floor(timeSinceLastUpdate / 60000);
          if (minutes > 0 && minutes % 5 === 0) {
            console.log(`[Battery Health Check] Service healthy. Last update: ${minutes}m ago`);
          }
        }
      } catch (error) {
        console.error('[Battery Health Check] Error during health check:', error);
      }
    }, 30000); // Every 30 seconds
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[Battery Health Check] Health monitoring started');
    }
  }

  /**
   * Stop health check monitor
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[Battery Health Check] Health monitoring stopped');
      }
    }
  }

  /**
   * Attempt to recover from errors
   * Auto-restarts monitoring if it has stopped
   */
  async attemptRecovery() {
    if (this.isRecovering) {
      return; // Already recovering
    }
    
    this.isRecovering = true;
    console.warn('[Battery Recovery] Attempting to recover battery service...');
    
    try {
      // Stop current monitoring
      this.stopMonitoring();
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Restart monitoring
      this.startMonitoring();
      
      // Reset error counter
      this.monitoringErrors = 0;
      this.lastSuccessfulUpdate = Date.now();
      
      console.log('[Battery Recovery] Service successfully restarted');
      const userId = this.getUserId ? this.getUserId() : null;
      this.db.addLog('battery', 'Battery service auto-recovered', {
        reason: 'Too many consecutive errors or stalled updates'
      }, 'info', userId);
      
    } catch (error) {
      console.error('[Battery Recovery] Recovery failed:', error);
      const userId = this.getUserId ? this.getUserId() : null;
      this.db.addLog('battery', 'Battery service recovery failed', {
        error: error.message
      }, 'error', userId);
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Gracefully handle missing battery data
   * Returns safe defaults to prevent crashes
   */
  getSafeBatteryData() {
    return {
      hasBattery: false,
      isCharging: false,
      percent: 0,
      timeRemaining: null,
      acConnected: false,
      type: 'Unknown',
      model: 'Unknown',
      manufacturer: 'Unknown',
      maxCapacity: null,
      currentCapacity: null,
      capacityUnit: null,
      voltage: null,
      capacityPercent: null,
      cycleCount: null,
      temperature: null,
      timestamp: Date.now(),
      dataAvailability: {
        hasCapacityData: false,
        hasCycleCount: false,
        hasTemperature: false,
        reason: 'Battery monitoring unavailable or device has no battery'
      }
    };
  }

  /**
   * Shutdown battery service
   */
  shutdown() {
    console.log('Shutting down battery service...');
    this.stopMonitoring();
    this.stopHealthCheck();
    
    // Clear auto-save interval
    if (this.trackingSaveInterval) {
      clearInterval(this.trackingSaveInterval);
      this.trackingSaveInterval = null;
    }
    
    this.saveSettings();
    
    // Final save of tracking data before shutdown (force immediate save)
    this.lastTrackingSave = 0; // Reset throttle
    this.savePersistentTracking();
    
    const userId = this.getUserId ? this.getUserId() : null;
    this.db.addLog('battery', 'Battery service shut down', null, 'info', userId);
  }

  /**
   * Get current process list for instant display in Processes tab
   * Uses the already-tracked process data (no additional system calls needed)
   * @returns {Array} List of processes with PID, name, CPU, memory info
   */
  getTrackedProcessList() {
    const processes = [];
    const totalMem = require('os').totalmem();
    
    for (const [pid, data] of this.processTracking.entries()) {
      // Calculate current-ish values from tracking data
      const avgCpu = data.samples > 0 ? data.totalCpu / data.samples : 0;
      const avgMem = data.samples > 0 ? data.totalMem / data.samples : 0;
      const memBytes = (avgMem / 100) * totalMem;
      
      processes.push({
        pid: pid,
        name: data.name,
        cpu: avgCpu.toFixed(2),
        cpuPercent: avgCpu,
        memory: memBytes,
        memoryFormatted: (memBytes / 1024 / 1024).toFixed(1) + ' MB',
        memoryPercent: avgMem.toFixed(2),
        memoryPercentNum: avgMem,
        priority: 'Normal',
        state: 'running',
        command: data.command || data.name,
        timestamp: Date.now()
      });
    }
    
    // Sort by memory (most common initial sort)
    processes.sort((a, b) => b.memoryPercentNum - a.memoryPercentNum);
    
    console.log(`[BatteryService] getTrackedProcessList: ${processes.length} processes`);
    return processes;
  }
}

module.exports = BatteryService;
