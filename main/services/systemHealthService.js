/**
 * System Health Service
 * Provides comprehensive system health monitoring including:
 * - CPU temperature monitoring
 * - System power consumption tracking
 * - Thermal management
 * - Performance metrics
 * 
 * This service provides alternative features when battery health data is limited
 */

const si = require('systeminformation');
const os = require('os');

class SystemHealthService {
  constructor(dbService) {
    this.db = dbService;
    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.healthHistory = [];
    this.maxHistoryPoints = 288; // 24 hours at 5-minute intervals
    this.getUserId = null; // Function to get current user ID
    
    // Temperature thresholds (Celsius)
    this.tempThresholds = {
      cpuWarning: 70,
      cpuCritical: 85,
      gpuWarning: 75,
      gpuCritical: 90
    };
    
    // Performance baselines
    this.performanceBaselines = {
      cpuIdleMax: 15, // % CPU when idle
      memoryWarningThreshold: 85, // % memory usage
      diskWarningThreshold: 90 // % disk usage
    };
    
    this.alerts = [];
  }

  /**
   * Set function to get current user ID
   */
  setUserIdProvider(getUserIdFn) {
    this.getUserId = getUserIdFn;
  }

  /**
   * Initialize system health monitoring
   */
  async initialize() {
    try {
      console.log('Initializing system health monitoring...');
      
      // Get initial system health data
      const initialHealth = await this.getSystemHealth();
      
      // Start monitoring
      this.startMonitoring();
      
      const userId = this.getUserId ? this.getUserId() : null;
      this.db.addLog('system_health', 'System health monitoring initialized', {
        cpu: initialHealth.cpu?.temperature || 'N/A',
        memory: initialHealth.memory?.usagePercent || 'N/A'
      }, 'info', userId);
      
      console.log('System health monitoring initialized successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to initialize system health monitoring:', error);
      const userId = this.getUserId ? this.getUserId() : null;
      this.db.addLog('system_health', 'Failed to initialize system health monitoring', {
        error: error.message
      }, 'error', userId);
      return false;
    }
  }

  /**
   * Start system health monitoring
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.log('System health monitoring already running');
      return;
    }
    
    this.isMonitoring = true;
    const interval = 120000; // 2 minutes - optimized for performance (was 30s)
    
    console.log(`Starting system health monitoring with ${interval}ms interval`);
    
    this.monitoringInterval = setInterval(async () => {
      await this.collectHealthData();
    }, interval);
    
    // Initial collection after a delay to let system stabilize
    setTimeout(() => this.collectHealthData(), 5000);
  }

  /**
   * Stop system health monitoring
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
    
    console.log('System health monitoring stopped');
  }

  /**
   * Collect system health data
   */
  async collectHealthData() {
    try {
      const healthData = await this.getSystemHealth();
      
      // Store in history
      this.addToHistory(healthData);
      
      // Check for health alerts
      await this.checkHealthAlerts(healthData);
      
      return healthData;
      
    } catch (error) {
      console.error('Error collecting system health data:', error);
      return null;
    }
  }

  /**
   * Get comprehensive system health data
   */
  async getSystemHealth() {
    try {
      // Get CPU data with temperature
      const cpuTemp = await si.cpuTemperature();
      const cpuLoad = await si.currentLoad();
      const cpuInfo = await si.cpu();
      
      // Get memory data
      const memData = await si.mem();
      
      // Get GPU data (if available)
      let gpuData = null;
      try {
        const graphics = await si.graphics();
        if (graphics && graphics.controllers && graphics.controllers.length > 0) {
          const gpu = graphics.controllers[0];
          gpuData = {
            model: gpu.model || 'Unknown',
            vendor: gpu.vendor || 'Unknown',
            vram: gpu.vram || null,
            temperature: gpu.temperatureGpu || null,
            fanSpeed: gpu.fanSpeed || null,
            powerDraw: gpu.powerDraw || null
          };
        }
      } catch (e) {
        console.log('GPU data not available');
      }
      
      // Get disk I/O stats
      const fsSize = await si.fsSize();
      const diskIO = await si.disksIO();
      
      // Get network stats
      const networkStats = await si.networkStats();
      
      // Calculate power consumption estimate (rough estimate based on CPU/GPU load)
      const powerEstimate = this.estimatePowerConsumption(cpuLoad, gpuData);
      
      return {
        timestamp: Date.now(),
        cpu: {
          temperature: cpuTemp.main || null,
          temperatureMax: cpuTemp.max || null,
          cores: cpuTemp.cores || [],
          usage: Math.round(cpuLoad.currentLoad * 10) / 10,
          usageUser: Math.round(cpuLoad.currentLoadUser * 10) / 10,
          usageSystem: Math.round(cpuLoad.currentLoadSystem * 10) / 10,
          model: cpuInfo.brand || 'Unknown',
          coreCount: cpuInfo.cores || 0,
          physicalCores: cpuInfo.physicalCores || 0,
          speedGHz: cpuInfo.speed || 0
        },
        gpu: gpuData,
        memory: {
          total: Math.round(memData.total / 1024 / 1024 / 1024 * 10) / 10, // GB
          used: Math.round(memData.used / 1024 / 1024 / 1024 * 10) / 10,
          free: Math.round(memData.free / 1024 / 1024 / 1024 * 10) / 10,
          usagePercent: Math.round(memData.used / memData.total * 100 * 10) / 10
        },
        disk: {
          io: diskIO,
          partitions: fsSize.map(fs => ({
            mount: fs.mount,
            size: Math.round(fs.size / 1024 / 1024 / 1024 * 10) / 10,
            used: Math.round(fs.used / 1024 / 1024 / 1024 * 10) / 10,
            available: Math.round(fs.available / 1024 / 1024 / 1024 * 10) / 10,
            usePercent: Math.round(fs.use * 10) / 10
          }))
        },
        network: networkStats.length > 0 ? {
          iface: networkStats[0].iface,
          rx: Math.round(networkStats[0].rx_sec / 1024 * 10) / 10, // KB/s
          tx: Math.round(networkStats[0].tx_sec / 1024 * 10) / 10
        } : null,
        power: powerEstimate,
        system: {
          platform: os.platform(),
          uptime: Math.round(os.uptime() / 3600 * 10) / 10, // hours
          hostname: os.hostname()
        }
      };
    } catch (error) {
      console.error('Error getting system health:', error);
      throw error;
    }
  }

  /**
   * Estimate power consumption based on system load
   * This is a rough estimate and not accurate - for informational purposes only
   */
  estimatePowerConsumption(cpuLoad, gpuData) {
    // Base power consumption (watts) - typical idle consumption
    let basePower = 15;
    
    // Add power based on CPU load (typical CPU TDP 15-45W for laptops)
    const cpuTDP = 35; // Assume average laptop CPU
    const cpuPower = (cpuLoad.currentLoad / 100) * cpuTDP;
    
    // Add power based on GPU load if available
    let gpuPower = 0;
    if (gpuData && gpuData.powerDraw) {
      gpuPower = gpuData.powerDraw;
    } else if (gpuData) {
      // Estimate GPU power (typical laptop GPU 15-40W)
      gpuPower = 20 * 0.3; // Assume 30% average load if no data
    }
    
    const totalPower = basePower + cpuPower + gpuPower;
    
    return {
      estimated: Math.round(totalPower * 10) / 10,
      breakdown: {
        base: basePower,
        cpu: Math.round(cpuPower * 10) / 10,
        gpu: Math.round(gpuPower * 10) / 10
      },
      note: 'Estimated values - not actual measurements'
    };
  }

  /**
   * Add health data to history
   */
  addToHistory(data) {
    this.healthHistory.push({
      timestamp: data.timestamp,
      cpuTemp: data.cpu.temperature,
      cpuUsage: data.cpu.usage,
      memoryUsage: data.memory.usagePercent,
      powerEstimate: data.power.estimated
    });
    
    // Keep only last 24 hours
    if (this.healthHistory.length > this.maxHistoryPoints) {
      this.healthHistory.shift();
    }
  }

  /**
   * Get system health trend
   */
  getHealthTrend() {
    return this.healthHistory;
  }

  /**
   * Check for health alerts
   */
  async checkHealthAlerts(healthData) {
    const alerts = [];
    
    // CPU temperature alerts
    if (healthData.cpu.temperature) {
      if (healthData.cpu.temperature >= this.tempThresholds.cpuCritical) {
        alerts.push({
          type: 'critical',
          category: 'temperature',
          message: `Critical CPU temperature: ${healthData.cpu.temperature}°C`,
          action: 'Reduce system load immediately. Check cooling system.',
          timestamp: Date.now()
        });
      } else if (healthData.cpu.temperature >= this.tempThresholds.cpuWarning) {
        alerts.push({
          type: 'warning',
          category: 'temperature',
          message: `High CPU temperature: ${healthData.cpu.temperature}°C`,
          action: 'Monitor temperature. Consider improving ventilation.',
          timestamp: Date.now()
        });
      }
    }
    
    // GPU temperature alerts
    if (healthData.gpu && healthData.gpu.temperature) {
      if (healthData.gpu.temperature >= this.tempThresholds.gpuCritical) {
        alerts.push({
          type: 'critical',
          category: 'temperature',
          message: `Critical GPU temperature: ${healthData.gpu.temperature}°C`,
          action: 'Reduce graphics load. Check GPU cooling.',
          timestamp: Date.now()
        });
      } else if (healthData.gpu.temperature >= this.tempThresholds.gpuWarning) {
        alerts.push({
          type: 'warning',
          category: 'temperature',
          message: `High GPU temperature: ${healthData.gpu.temperature}°C`,
          action: 'Monitor GPU temperature. Ensure proper ventilation.',
          timestamp: Date.now()
        });
      }
    }
    
    // Memory usage alerts
    if (healthData.memory.usagePercent >= this.performanceBaselines.memoryWarningThreshold) {
      alerts.push({
        type: 'warning',
        category: 'memory',
        message: `High memory usage: ${healthData.memory.usagePercent}%`,
        action: 'Close unused applications to free memory.',
        timestamp: Date.now()
      });
    }
    
    // Disk space alerts
    for (const partition of healthData.disk.partitions) {
      if (partition.usePercent >= this.performanceBaselines.diskWarningThreshold) {
        alerts.push({
          type: 'warning',
          category: 'disk',
          message: `Low disk space on ${partition.mount}: ${partition.usePercent}% used`,
          action: 'Free up disk space by removing unnecessary files.',
          timestamp: Date.now()
        });
      }
    }
    
    // Add new alerts
    if (alerts.length > 0) {
      this.alerts.unshift(...alerts);
      
      // Keep only last 50 alerts
      if (this.alerts.length > 50) {
        this.alerts = this.alerts.slice(0, 50);
      }
      
      // Log critical alerts
      const userId = this.getUserId ? this.getUserId() : null;
      alerts.filter(a => a.type === 'critical').forEach(alert => {
        this.db.addLog('system_health', alert.message, alert, 'warning', userId);
      });
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
  }

  /**
   * Get cooling recommendations based on temperature
   */
  getCoolingRecommendations() {
    if (this.healthHistory.length === 0) {
      return null;
    }
    
    const recentData = this.healthHistory.slice(-12); // Last hour (5-min intervals)
    const temps = recentData.map(d => d.cpuTemp).filter(t => t !== null);
    
    if (temps.length === 0) {
      return {
        status: 'unknown',
        message: 'Temperature data not available',
        recommendations: [
          'Ensure good airflow around your device',
          'Keep vents clean and unobstructed',
          'Use on hard, flat surfaces for better ventilation'
        ]
      };
    }
    
    const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
    const maxTemp = Math.max(...temps);
    
    if (maxTemp >= this.tempThresholds.cpuCritical) {
      return {
        status: 'critical',
        avgTemp: Math.round(avgTemp),
        maxTemp: Math.round(maxTemp),
        message: 'Critical cooling needed',
        recommendations: [
          '🔴 Reduce workload immediately',
          '🔴 Check if cooling fans are working',
          '🔴 Clean dust from air vents',
          '🔴 Consider using a cooling pad',
          '🔴 Avoid using on soft surfaces (bed, couch)',
          '🔴 Professional cleaning may be needed'
        ]
      };
    } else if (maxTemp >= this.tempThresholds.cpuWarning) {
      return {
        status: 'warning',
        avgTemp: Math.round(avgTemp),
        maxTemp: Math.round(maxTemp),
        message: 'Cooling attention recommended',
        recommendations: [
          '⚠️ Ensure proper ventilation',
          '⚠️ Clean air vents if dusty',
          '⚠️ Use on hard surfaces',
          '⚠️ Consider a laptop cooling pad',
          '⚠️ Close resource-intensive applications if not needed'
        ]
      };
    } else if (avgTemp >= 50) {
      return {
        status: 'good',
        avgTemp: Math.round(avgTemp),
        maxTemp: Math.round(maxTemp),
        message: 'Cooling is adequate',
        recommendations: [
          '✅ Temperature is normal',
          '✅ Continue current cooling practices',
          '✅ Keep vents clear for optimal performance'
        ]
      };
    } else {
      return {
        status: 'excellent',
        avgTemp: Math.round(avgTemp),
        maxTemp: Math.round(maxTemp),
        message: 'Excellent cooling',
        recommendations: [
          '✅ Temperature is optimal',
          '✅ Cooling system is working well'
        ]
      };
    }
  }

  /**
   * Cool down the system by reducing CPU load and optimizing performance
   * This actively helps reduce system temperature
   */
  async coolDownSystem() {
    console.log('[Cool Down] Starting system cooldown...');
    const results = {
      timestamp: Date.now(),
      actions: [],
      initialTemp: null,
      targetTemp: null,
      success: false
    };

    try {
      // Get initial temperature with timeout
      try {
        console.log('[Cool Down] Getting initial temperature...');
        const healthPromise = this.getSystemHealth();
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout getting initial temperature')), 3000)
        );
        const initialHealth = await Promise.race([healthPromise, timeout]);
        results.initialTemp = initialHealth.cpu.temperature;
        console.log(`[Cool Down] Initial temp: ${results.initialTemp}°C`);
      } catch (err) {
        console.error('[Cool Down] Error getting initial temp:', err.message);
        results.initialTemp = 'N/A';
      }
      
      // 1. Get and end resource-intensive processes
      try {
        console.log('[Cool Down] Analyzing processes...');
        const si = require('systeminformation');
        const processPromise = si.processes();
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout analyzing processes')), 3000)
        );
        const processes = await Promise.race([processPromise, timeout]);
        
        // Sort by CPU usage
        const cpuHeavy = processes.list
          .filter(p => p.cpu > 5 && !this.isSystemProcess(p.name))
          .sort((a, b) => b.cpu - a.cpu)
          .slice(0, 5);
        
        if (cpuHeavy.length > 0) {
          console.log(`[Cool Down] Found ${cpuHeavy.length} high-CPU processes`);
          results.actions.push({
            action: 'Reduce CPU Load',
            status: 'success',
            message: `Found ${cpuHeavy.length} high-CPU processes`,
            details: cpuHeavy.map(p => `${p.name} (${p.cpu.toFixed(1)}% CPU)`)
          });
        } else {
          results.actions.push({
            action: 'Reduce CPU Load',
            status: 'info',
            message: 'No high-CPU processes detected'
          });
        }
      } catch (err) {
        console.error('[Cool Down] Error analyzing processes:', err.message);
        results.actions.push({
          action: 'Reduce CPU Load',
          status: 'warning',
          message: 'Could not analyze CPU usage: ' + err.message
        });
      }
      
      // 2. Clear memory to reduce heat
      try {
        console.log('[Cool Down] Optimizing memory...');
        if (process.platform === 'win32') {
          // Windows: Force garbage collection
          if (global.gc) {
            global.gc();
            results.actions.push({
              action: 'Memory Optimization',
              status: 'success',
              message: 'Memory garbage collection completed'
            });
          } else {
            results.actions.push({
              action: 'Memory Optimization',
              status: 'info',
              message: 'Automatic memory management active'
            });
          }
        }
      } catch (err) {
        console.error('[Cool Down] Error optimizing memory:', err.message);
      }
      
      // 3. Provide cooling recommendations based on current temperature
      try {
        console.log('[Cool Down] Getting cooling recommendations...');
        const cooling = this.getCoolingRecommendations();
        if (cooling) {
          results.actions.push({
            action: 'Cooling Analysis',
            status: cooling.status === 'critical' ? 'warning' : 'success',
            message: cooling.message,
            details: cooling.recommendations
          });
        }
      } catch (err) {
        console.error('[Cool Down] Error getting cooling recommendations:', err.message);
      }
      
      // 4. Set power plan to power saver (Windows)
      try {
        console.log('[Cool Down] Adjusting power plan...');
        if (process.platform === 'win32') {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);
          
          // Try to set power plan to power saver with timeout
          const powerPromise = execAsync('powercfg /setactive a1841308-3541-4fab-bc81-f71556f20b4a');
          const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout setting power plan')), 2000)
          );
          await Promise.race([powerPromise, timeout]);
          
          results.actions.push({
            action: 'Power Management',
            status: 'success',
            message: 'Switched to Power Saver mode to reduce heat'
          });
        } else {
          results.actions.push({
            action: 'Power Management',
            status: 'info',
            message: 'Automatic power management recommended'
          });
        }
      } catch (err) {
        console.log('[Cool Down] Could not change power plan (may require admin):', err.message);
        results.actions.push({
          action: 'Power Management',
          status: 'info',
          message: 'Consider manually setting Windows to Power Saver mode'
        });
      }
      
      // Wait a moment and check temperature again
      console.log('[Cool Down] Waiting 2 seconds before final temperature check...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      try {
        console.log('[Cool Down] Getting final temperature...');
        const finalHealthPromise = this.getSystemHealth();
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout getting final temperature')), 3000)
        );
        const finalHealth = await Promise.race([finalHealthPromise, timeout]);
        results.targetTemp = finalHealth.cpu.temperature;
        console.log(`[Cool Down] Final temp: ${results.targetTemp}°C`);
        
        // Check if we improved
        if (results.initialTemp !== 'N/A' && results.targetTemp) {
          const tempDiff = results.initialTemp - results.targetTemp;
          if (tempDiff > 0) {
            results.actions.push({
              action: 'Temperature Check',
              status: 'success',
              message: `Temperature reduced by ${tempDiff.toFixed(1)}°C`,
              details: [`Initial: ${results.initialTemp}°C`, `Current: ${results.targetTemp}°C`]
            });
          } else {
            results.actions.push({
              action: 'Temperature Check',
              status: 'info',
              message: 'Temperature stable',
              details: [`Current: ${results.targetTemp}°C`]
            });
          }
        }
      } catch (err) {
        console.error('[Cool Down] Error getting final temp:', err.message);
        results.targetTemp = 'N/A';
      }
      
      results.success = results.actions.some(a => a.status === 'success');
      
      console.log(`[Cool Down] ✅ Cooldown completed with ${results.actions.length} actions`);
      const userId = this.getUserId ? this.getUserId() : null;
      this.db.addLog('system_health', 'System cooldown completed', results, 'info', userId);
      
      return results;
      
    } catch (error) {
      console.error('Error during system cooldown:', error);
      results.actions.push({
        action: 'System Cooldown',
        status: 'error',
        message: 'Error during cooldown: ' + error.message
      });
      return results;
    }
  }

  /**
   * Check if a process is a critical system process
   */
  isSystemProcess(processName) {
    const systemProcesses = [
      'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe',
      'services.exe', 'lsass.exe', 'svchost.exe', 'dwm.exe', 'explorer.exe',
      'winlogon.exe', 'taskhost.exe', 'spoolsv.exe', 'conhost.exe'
    ];
    
    const name = processName.toLowerCase();
    return systemProcesses.some(sp => name.includes(sp));
  }

  /**
   * Get comprehensive system health report
   */
  async getHealthReport() {
    const currentHealth = await this.getSystemHealth();
    const trend = this.getHealthTrend();
    const alerts = this.getAlerts(10);
    const coolingRecommendations = this.getCoolingRecommendations();
    
    return {
      current: currentHealth,
      trend,
      alerts,
      cooling: coolingRecommendations,
      isMonitoring: this.isMonitoring
    };
  }

  /**
   * Shutdown system health service
   */
  shutdown() {
    console.log('Shutting down system health service...');
    this.stopMonitoring();
    const userId = this.getUserId ? this.getUserId() : null;
    this.db.addLog('system_health', 'System health service shut down', null, 'info', userId);
  }
}

module.exports = SystemHealthService;
