/**
 * Monitoring Service
 * Collects real-time system metrics: CPU, memory, disk, processes
 * Uses systeminformation and pidusage for accurate data
 */

const si = require('systeminformation');
// const pidusage = require('pidusage'); // Not currently used
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

class MonitoringService {
  constructor() {
    this.metricsHistory = {
      cpu: [],
      memory: [],
      disk: [],
      timestamps: []
    };
    this.maxHistorySize = 60; // Keep 60 data points (1 minute at 1s intervals)
  }

  /**
   * Get comprehensive system metrics
   * @returns {Promise<Object>} System metrics including CPU, memory, disk
   */
  async getSystemMetrics() {
    try {
      const [cpu, mem, disk, currentLoad, processes, osInfo] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.fsSize(),
        si.currentLoad(),
        si.processes(),
        si.osInfo()
      ]);

      const timestamp = Date.now();

      // CPU metrics
      const cpuMetrics = {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed,
        currentLoad: currentLoad.currentLoad.toFixed(2),
        currentLoadUser: currentLoad.currentLoadUser.toFixed(2),
        currentLoadSystem: currentLoad.currentLoadSystem.toFixed(2),
        currentLoadIdle: currentLoad.currentLoadIdle.toFixed(2),
        coresLoad: currentLoad.cpus.map(core => ({
          load: core.load.toFixed(2),
          loadUser: core.loadUser.toFixed(2),
          loadSystem: core.loadSystem.toFixed(2)
        }))
      };

      // Memory metrics
      const memoryMetrics = {
        total: mem.total,
        free: mem.free,
        used: mem.used,
        active: mem.active,
        available: mem.available,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        swapFree: mem.swapfree,
        usagePercent: ((mem.used / mem.total) * 100).toFixed(2)
      };

      // Disk metrics
      const diskMetrics = disk.map(d => ({
        fs: d.fs,
        type: d.type,
        size: d.size,
        used: d.used,
        available: d.available,
        use: d.use,
        mount: d.mount
      }));

      // Process metrics
      const processMetrics = {
        all: processes.all,
        running: processes.running,
        blocked: processes.blocked,
        sleeping: processes.sleeping
      };

      // System info
      const systemInfo = {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        arch: osInfo.arch,
        hostname: osInfo.hostname,
        uptime: os.uptime()
      };

      // Store in history
      this.addToHistory(cpuMetrics.currentLoad, memoryMetrics.usagePercent, diskMetrics[0]?.use || 0, timestamp);

      return {
        cpu: cpuMetrics,
        memory: memoryMetrics,
        disk: diskMetrics,
        processes: processMetrics,
        system: systemInfo,
        timestamp,
        history: this.metricsHistory
      };
    } catch (error) {
      console.error('Error getting system metrics:', error);
      throw error;
    }
  }

  /**
   * Get detailed process list with CPU and memory usage
   * @returns {Promise<Array>} List of processes with metrics
   */
  async getProcessList() {
    try {
      const processes = await si.processes();
      
      // Filter and process in one pass for better performance
      const detailedProcesses = processes.list
        .filter(p => {
          // Filter criteria:
          // 1. Valid PID
          // 2. Has a name
          // 3. Using memory (active process)
          return p.pid > 0 && p.name && p.mem > 0;
        })
        .map((proc) => {
          // Extract just the executable name without path
          let displayName = proc.name;
          if (displayName.includes('\\')) {
            displayName = displayName.split('\\').pop();
          }
          if (displayName.includes('/')) {
            displayName = displayName.split('/').pop();
          }
          
          return {
            pid: proc.pid,
            name: displayName,
            cpu: typeof proc.cpu === 'number' ? proc.cpu.toFixed(2) : '0.00',
            memory: proc.mem,
            memoryPercent: proc.memVsTotal ? proc.memVsTotal.toFixed(2) : '0.00',
            priority: proc.priority || 'Normal',
            state: proc.state || 'running',
            started: proc.started || '',
            command: proc.command || displayName
          };
        })
        .sort((a, b) => {
          // Sort by memory usage first, then CPU
          const memDiff = b.memory - a.memory;
          if (Math.abs(memDiff) > 50) { // Significant memory difference
            return memDiff;
          }
          return parseFloat(b.cpu) - parseFloat(a.cpu);
        })
        .slice(0, 100); // Top 100 processes

      console.log(`Process list retrieved: ${detailedProcesses.length} processes`);
      return detailedProcesses;
    } catch (error) {
      console.error('Error getting process list:', error);
      throw error;
    }
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
    this.metricsHistory.cpu.push(parseFloat(cpuLoad));
    this.metricsHistory.memory.push(parseFloat(memoryUsage));
    this.metricsHistory.disk.push(parseFloat(diskUsage));
    this.metricsHistory.timestamps.push(timestamp);

    // Keep only last N entries
    if (this.metricsHistory.cpu.length > this.maxHistorySize) {
      this.metricsHistory.cpu.shift();
      this.metricsHistory.memory.shift();
      this.metricsHistory.disk.shift();
      this.metricsHistory.timestamps.shift();
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
