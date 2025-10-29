const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const db = require('./services/database');
const firebase = require('./services/firebase');
const emailService = require('./services/emailService');
const monitoringService = require('./services/monitoring');
const optimizerService = require('./services/optimizer');
const LogsService = require('./services/logsService');
const BatteryService = require('./services/batteryService');
const SystemHealthService = require('./services/systemHealthService');

// Initialize services
let logsService;
let batteryService;
let systemHealthService;

// Initialize electron-store for secure configuration
const store = new Store();

// Set app user model ID for Windows
if (process.platform === 'win32') {
  app.setAppUserModelId('com.fortimorph.desktop');
}

// Configure cache directory to avoid permission issues
const cacheDir = path.join(app.getPath('userData'), 'Cache');
app.setPath('cache', cacheDir);

let mainWindow;
let sessionData = {
  isAuthenticated: false,
  user: null,
  sessionToken: null,
  sessionTimeout: null,
};

const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000; // 30 minutes

// Enable context isolation and secure headers
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#001D3D', // Ocean Vibe Deep Background
    webPreferences: {
      nodeIntegration: false, // Security: disable node integration
      contextIsolation: true, // Security: enable context isolation
      enableRemoteModule: false, // Security: disable remote module
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true, // Keep security enabled
      allowRunningInsecureContent: false, // Security: block insecure content
      devTools: true,
    },
    icon: path.join(__dirname, '../assets/icons/icon.png'),
    show: false, // Don't show until ready-to-show
  });

  // Set Content Security Policy for both dev and production
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const isDev = process.env.NODE_ENV === 'development';
    const csp = isDev
      ? [
          // Development CSP - allow Vite dev server and HMR
          "default-src 'self' http://localhost:5173 ws://localhost:5173; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; " +
          "style-src 'self' 'unsafe-inline' http://localhost:5173; " +
          "img-src 'self' data: http://localhost:5173; " +
          "font-src 'self' data: http://localhost:5173; " +
          "connect-src 'self' http://localhost:5173 ws://localhost:5173 https://*.googleapis.com https://*.firebaseio.com;",
        ]
      : [
          // Production CSP - stricter
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; " +
          "font-src 'self' data:; " +
          "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com;",
        ];

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': csp,
      },
    });
  });

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
    // Clear cache on development startup to prevent ERR_CACHE_READ_FAILURE
    mainWindow.webContents.session.clearCache().then(() => {
      console.log('Cache cleared successfully');
    }).catch((err) => {
      console.warn('Failed to clear cache:', err);
    });
    
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Initialize services
  try {
    console.log('Initializing services...');
    await db.initialize();
    console.log('Database initialized');
    
    const firebaseInitialized = firebase.initialize();
    if (firebaseInitialized) {
      console.log('Firebase initialized successfully');
    } else {
      console.warn('Firebase initialization skipped - check .env configuration');
    }
    
    emailService.initialize();
    console.log('Email service initialized');
    
    // Initialize logs service
    logsService = new LogsService(db);
    await logsService.initialize();
    console.log('Logs service initialized');
    
    // Schedule automatic log cleanup (30 days retention)
    logsService.scheduleCleanup(30);
    
    // Initialize battery service
    batteryService = new BatteryService(db);
    await batteryService.initialize();
    console.log('Battery service initialized');
    
    // Initialize system health service
    systemHealthService = new SystemHealthService(db);
    await systemHealthService.initialize();
    console.log('System health service initialized');
  } catch (error) {
    console.error('Failed to initialize services:', error);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Close database connection
  db.close();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Session management helpers
function startSessionTimeout() {
  clearTimeout(sessionData.sessionTimeout);
  sessionData.sessionTimeout = setTimeout(() => {
    sessionData.isAuthenticated = false;
    sessionData.user = null;
    sessionData.sessionToken = null;
    mainWindow?.webContents.send('session-expired');
  }, SESSION_TIMEOUT_MS);
}

function clearSession() {
  clearTimeout(sessionData.sessionTimeout);
  sessionData.isAuthenticated = false;
  sessionData.user = null;
  sessionData.sessionToken = null;
}

// IPC handlers for secure communication
ipcMain.handle('get-store-value', async (event, key) => {
  return store.get(key);
});

ipcMain.handle('set-store-value', async (event, key, value) => {
  store.set(key, value);
  return true;
});

ipcMain.handle('app-version', async () => {
  return app.getVersion();
});

// Authentication IPC handlers
ipcMain.handle('auth:signup', async (event, { email, password }) => {
  try {
    const result = await firebase.signup(email, password);
    return result;
  } catch (error) {
    console.error('Signup error:', error);
    return { success: false, error: error.message || 'An unexpected error occurred' };
  }
});

ipcMain.handle('auth:verify-email', async (_event, { email, code }) => {
  try {
    const result = await firebase.verifyEmail(email, code);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:check-email-verified', async () => {
  try {
    const result = await firebase.checkEmailVerified();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:resend-code', async (_event, { email }) => {
  try {
    const result = await firebase.resendVerificationByEmail(email);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:login', async (event, { email, password }) => {
  try {
    console.log('Login handler called for:', email);
    const result = await firebase.login(email, password);
    console.log('Firebase login result:', result);
    
    if (result.success) {
      sessionData.isAuthenticated = true;
      sessionData.user = result.user;
      sessionData.sessionToken = result.user.uid;
      startSessionTimeout();
      console.log('Session established for user:', result.user.uid);
    }
    
    return result;
  } catch (error) {
    console.error('Login handler error:', error);
    return { success: false, error: error.message || 'Login failed' };
  }
});

ipcMain.handle('auth:logout', async () => {
  try {
    await firebase.logout();
    clearSession();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:request-reset', async (_event, { email }) => {
  try {
    const result = await firebase.requestPasswordReset(email);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:reset-password', async (_event, _params) => {
  // Firebase handles password reset via email link
  // This is kept for compatibility
  return {
    success: true,
    message: 'Password reset link sent to your email',
  };
});

ipcMain.handle('auth:check-session', async () => {
  return {
    isAuthenticated: sessionData.isAuthenticated,
    user: sessionData.user,
  };
});

ipcMain.handle('auth:refresh-session', async () => {
  if (sessionData.isAuthenticated) {
    startSessionTimeout();
    return { success: true };
  }
  return { success: false, error: 'Not authenticated' };
});

ipcMain.handle('auth:resend-verification', async (_event, { email }) => {
  try {
    const result = await firebase.resendVerificationByEmail(email);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Debug/Admin handlers
ipcMain.handle('auth:debug-users', async () => {
  try {
    const users = db.getAllUsers();
    const firebaseUsers = db.getAllFirebaseUsers();
    const verificationCodes = db.getAllVerificationCodes();
    return { success: true, users, firebaseUsers, verificationCodes };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:manual-verify', async (_event, { uid }) => {
  try {
    const result = db.manuallyVerifyUser(uid);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:delete-user', async (_event, { uid, options }) => {
  try {
    console.log('Delete user request:', uid, options);
    const result = await firebase.deleteUserAccount(uid, options);
    return result;
  } catch (error) {
    console.error('Delete user error:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// System Monitoring IPC Handlers
// ========================================

ipcMain.handle('system:get-metrics', async () => {
  try {
    const metrics = await monitoringService.getSystemMetrics();
    return { success: true, data: metrics };
  } catch (error) {
    console.error('Error getting system metrics:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:get-processes', async () => {
  try {
    const processes = await monitoringService.getProcessList();
    return { success: true, data: processes };
  } catch (error) {
    console.error('Error getting process list:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:get-cpu', async () => {
  try {
    const cpuMetrics = await monitoringService.getCPUMetrics();
    return { success: true, data: cpuMetrics };
  } catch (error) {
    console.error('Error getting CPU metrics:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:get-memory', async () => {
  try {
    const memoryMetrics = await monitoringService.getMemoryMetrics();
    return { success: true, data: memoryMetrics };
  } catch (error) {
    console.error('Error getting memory metrics:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:get-battery', async () => {
  try {
    const batteryInfo = await monitoringService.getBatteryInfo();
    return { success: true, data: batteryInfo };
  } catch (error) {
    console.error('Error getting battery info:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// System Optimization IPC Handlers
// ========================================

/**
 * System Cooldown - Reduces CPU load and system temperature
 * This actively cools down the device by:
 * - Analyzing and suggesting resource-intensive processes
 * - Optimizing memory usage
 * - Setting power plan to power saver
 * - Providing cooling recommendations
 */
ipcMain.handle('system:cooldown', async () => {
  try {
    console.log('Starting system cooldown...');
    const result = await systemHealthService.coolDownSystem();
    
    console.log('Cooldown result:', result);
    
    if (result && result.success) {
      return { 
        success: true,
        data: result,
        message: 'System cooldown completed'
      };
    } else {
      // Return partial results even if not fully successful
      return {
        success: true,
        data: result,
        message: 'Cooldown completed with some limitations',
        warning: 'Some actions could not be completed'
      };
    }
  } catch (error) {
    console.error('Critical error during cooldown:', error);
    return { 
      success: false, 
      error: error.message || 'Unknown error occurred during cooldown',
      data: null 
    };
  }
});

/**
 * System Optimization - Clears temp files, cache, runs GC
 * This is DIFFERENT from Battery Optimization Mode (saver/balanced/performance)
 * - System Optimization: Frees disk space and memory (one-time action)
 * - Battery Optimization: Controls battery monitoring polling intervals (ongoing mode)
 */
ipcMain.handle('system:optimize', async () => {
  try {
    console.log('Starting system optimization...');
    const result = await optimizerService.optimizeSystem();
    
    console.log('Optimization result:', result);
    
    // Always return the result data for display
    if (result && result.success) {
      return { 
        success: true,
        data: result,
        message: result.summary || 'Optimization completed successfully'
      };
    } else {
      // Check if we have any successful actions despite overall failure
      const hasSuccessfulAction = result?.actions?.some(a => a.status === 'success');
      const hasWarnings = result?.actions?.some(a => a.status === 'warning');
      
      // If we have some success or warnings, treat as partial success
      if (hasSuccessfulAction || hasWarnings) {
        return {
          success: true,
          data: result,
          message: result.summary || 'Optimization completed with some limitations',
          warning: 'Some actions could not be completed'
        };
      }
      
      // True failure only if all actions failed
      return {
        success: false,
        data: result,
        error: result.summary || 'Optimization could not be completed',
        details: result.errors
      };
    }
  } catch (error) {
    console.error('Critical error during optimization:', error);
    return { 
      success: false, 
      error: error.message || 'Unknown error occurred during optimization',
      data: null 
    };
  }
});

ipcMain.handle('system:end-process', async (_event, { pid, force }) => {
  try {
    const result = await optimizerService.endProcess(pid, force);
    return { success: result.success, data: result };
  } catch (error) {
    console.error('Error ending process:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:end-processes', async (_event, { pids }) => {
  try {
    const results = await optimizerService.endProcesses(pids);
    return { success: true, data: results };
  } catch (error) {
    console.error('Error ending processes:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:clear-temp', async () => {
  try {
    const result = await optimizerService.clearTempFiles();
    return { success: true, data: result };
  } catch (error) {
    console.error('Error clearing temp files:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:clear-cache', async () => {
  try {
    const result = await optimizerService.clearAppCache();
    return { success: true, data: result };
  } catch (error) {
    console.error('Error clearing cache:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:get-suggestions', async () => {
  try {
    const metrics = await monitoringService.getSystemMetrics();
    const suggestions = optimizerService.getOptimizationSuggestions(metrics);
    return { success: true, data: suggestions };
  } catch (error) {
    console.error('Error getting optimization suggestions:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:get-optimization-history', async () => {
  try {
    const history = optimizerService.getOptimizationHistory();
    return { success: true, data: history };
  } catch (error) {
    console.error('Error getting optimization history:', error);
    return { success: false, error: error.message };
  }
});

// Get installed applications
ipcMain.handle('system:get-installed-apps', async () => {
  console.log('========================================');
  console.log('IPC: system:get-installed-apps called');
  console.log('========================================');
  
  try {
    console.log('Calling monitoringService.getInstalledApplications()...');
    const apps = await monitoringService.getInstalledApplications();
    
    console.log('========================================');
    console.log('Apps returned from monitoring service:', apps.length);
    if (apps.length > 0) {
      console.log('First app:', apps[0]);
      console.log('Last app:', apps[apps.length - 1]);
    }
    console.log('========================================');
    
    return { success: true, data: apps };
  } catch (error) {
    console.error('========================================');
    console.error('ERROR in system:get-installed-apps handler');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('========================================');
    return { success: false, error: error.message };
  }
});

// Get storage analysis (large files and folders)
ipcMain.handle('system:get-storage-analysis', async (_event, { minSizeMB }) => {
  try {
    const analysis = await monitoringService.getStorageAnalysis(minSizeMB || 100);
    return { success: true, data: analysis };
  } catch (error) {
    console.error('Error getting storage analysis:', error);
    return { success: false, error: error.message };
  }
});

// Open file with default application
ipcMain.handle('system:open-file', async (_event, { filePath }) => {
  try {
    const { shell } = require('electron');
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error opening file:', error);
    return { success: false, error: error.message };
  }
});

// Show file in folder (Windows Explorer)
ipcMain.handle('system:show-in-folder', async (_event, { filePath }) => {
  try {
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error showing file in folder:', error);
    return { success: false, error: error.message };
  }
});

// Delete file
ipcMain.handle('system:delete-file', async (_event, { filePath }) => {
  try {
    const { shell } = require('electron');
    // Move to recycle bin instead of permanent delete
    await shell.trashItem(filePath);
    return { success: true, message: 'File moved to Recycle Bin' };
  } catch (error) {
    console.error('Error deleting file:', error);
    return { success: false, error: error.message };
  }
});

// Open folder with default file explorer
ipcMain.handle('system:open-folder', async (_event, { folderPath }) => {
  try {
    const { shell } = require('electron');
    await shell.openPath(folderPath);
    return { success: true };
  } catch (error) {
    console.error('Error opening folder:', error);
    return { success: false, error: error.message };
  }
});

// Delete folder (move to recycle bin)
ipcMain.handle('system:delete-folder', async (_event, { folderPath }) => {
  try {
    const { shell } = require('electron');
    // Move to recycle bin instead of permanent delete
    await shell.trashItem(folderPath);
    return { success: true, message: 'Folder moved to Recycle Bin' };
  } catch (error) {
    console.error('Error deleting folder:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// Logs IPC Handlers
// ============================================================================

// Get filtered logs with pagination
ipcMain.handle('logs:getFiltered', async (_event, filters, page, pageSize) => {
  try {
    // Add current user to filters if authenticated
    if (sessionData.isAuthenticated && sessionData.user?.uid) {
      filters = { ...filters, userId: sessionData.user.uid };
    }
    const result = db.getLogsFiltered(filters, page, pageSize);
    return result;
  } catch (error) {
    console.error('Error getting filtered logs:', error);
    return { logs: [], total: 0, page: 1, pageSize, totalPages: 0 };
  }
});

// Get available log types
ipcMain.handle('logs:getTypes', async () => {
  try {
    return db.getLogTypes();
  } catch (error) {
    console.error('Error getting log types:', error);
    return [];
  }
});

// Export logs to CSV
ipcMain.handle('logs:exportCSV', async (_event, filters) => {
  try {
    const result = await logsService.exportToCSV(filters);
    return result;
  } catch (error) {
    console.error('Error exporting logs to CSV:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to JSON
ipcMain.handle('logs:exportJSON', async (_event, filters) => {
  try {
    const result = await logsService.exportToJSON(filters);
    return result;
  } catch (error) {
    console.error('Error exporting logs to JSON:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to XML
ipcMain.handle('logs:exportXML', async (_event, filters) => {
  try {
    const result = await logsService.exportToXML(filters);
    return result;
  } catch (error) {
    console.error('Error exporting logs to XML:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to TXT
ipcMain.handle('logs:exportTXT', async (_event, filters) => {
  try {
    const result = await logsService.exportToTXT(filters);
    return result;
  } catch (error) {
    console.error('Error exporting logs to TXT:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to HTML
ipcMain.handle('logs:exportHTML', async (_event, filters) => {
  try {
    const result = await logsService.exportToHTML(filters);
    return result;
  } catch (error) {
    console.error('Error exporting logs to HTML:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to Markdown
ipcMain.handle('logs:exportMarkdown', async (_event, filters) => {
  try {
    const result = await logsService.exportToMarkdown(filters);
    return result;
  } catch (error) {
    console.error('Error exporting logs to Markdown:', error);
    return { success: false, error: error.message };
  }
});

// Export diagnostic package
ipcMain.handle('logs:exportDiagnostic', async (_event, filters) => {
  try {
    const result = await logsService.exportDiagnosticZIP(filters);
    return result;
  } catch (error) {
    console.error('Error exporting diagnostic package:', error);
    return { success: false, error: error.message };
  }
});

// Open export folder
ipcMain.handle('logs:openExportFolder', async () => {
  try {
    const exportDir = logsService.getExportDir();
    await shell.openPath(exportDir);
    return { success: true };
  } catch (error) {
    console.error('Error opening export folder:', error);
    return { success: false, error: error.message };
  }
});

// Manually trigger log cleanup
ipcMain.handle('logs:cleanup', async (_event, retentionDays) => {
  try {
    const result = db.cleanupOldLogs(retentionDays);
    return result;
  } catch (error) {
    console.error('Error cleaning up logs:', error);
    return { success: false, error: error.message };
  }
});

// =======================
// BATTERY IPC HANDLERS
// =======================

// Get current battery data
ipcMain.handle('battery:getData', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const data = await batteryService.getBatteryData();
    return { success: true, data };
  } catch (error) {
    console.error('Error getting battery data:', error);
    return { success: false, error: error.message };
  }
});

// Get battery report (comprehensive)
ipcMain.handle('battery:getReport', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const report = await batteryService.getBatteryReport();
    return { success: true, ...report };
  } catch (error) {
    console.error('Error getting battery report:', error);
    return { success: false, error: error.message };
  }
});

// Get battery trend (24-hour history)
ipcMain.handle('battery:getTrend', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const trend = batteryService.getBatteryTrend();
    return { success: true, trend };
  } catch (error) {
    console.error('Error getting battery trend:', error);
    return { success: false, error: error.message };
  }
});

// Get battery statistics
ipcMain.handle('battery:getStats', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const stats = batteryService.getBatteryStats();
    return { success: true, stats };
  } catch (error) {
    console.error('Error getting battery stats:', error);
    return { success: false, error: error.message };
  }
});

// Get battery alerts
ipcMain.handle('battery:getAlerts', async (_event, limit = 20) => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const alerts = batteryService.getAlerts(limit);
    return { success: true, alerts };
  } catch (error) {
    console.error('Error getting battery alerts:', error);
    return { success: false, error: error.message };
  }
});

// Clear all battery alerts
ipcMain.handle('battery:clearAlerts', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    batteryService.clearAlerts();
    return { success: true };
  } catch (error) {
    console.error('Error clearing battery alerts:', error);
    return { success: false, error: error.message };
  }
});

// Dismiss specific battery alert
ipcMain.handle('battery:dismissAlert', async (_event, alertId) => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    batteryService.dismissAlert(alertId);
    return { success: true };
  } catch (error) {
    console.error('Error dismissing battery alert:', error);
    return { success: false, error: error.message };
  }
});

// Set optimization mode
ipcMain.handle('battery:setOptimizationMode', async (_event, mode) => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    await batteryService.setOptimizationMode(mode);
    return { success: true, mode };
  } catch (error) {
    console.error('Error setting optimization mode:', error);
    return { success: false, error: error.message };
  }
});

// Get optimization mode
ipcMain.handle('battery:getOptimizationMode', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const mode = batteryService.getOptimizationMode();
    return { success: true, mode };
  } catch (error) {
    console.error('Error getting optimization mode:', error);
    return { success: false, error: error.message };
  }
});

// Get optimization mode details
ipcMain.handle('battery:getOptimizationModeDetails', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const details = batteryService.getOptimizationModeDetails();
    return { success: true, ...details };
  } catch (error) {
    console.error('Error getting optimization mode details:', error);
    return { success: false, error: error.message };
  }
});

// Update alert thresholds
ipcMain.handle('battery:updateThresholds', async (_event, thresholds) => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    batteryService.updateThresholds(thresholds);
    return { success: true };
  } catch (error) {
    console.error('Error updating thresholds:', error);
    return { success: false, error: error.message };
  }
});

// Get alert thresholds
ipcMain.handle('battery:getThresholds', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const thresholds = batteryService.getThresholds();
    return { success: true, thresholds };
  } catch (error) {
    console.error('Error getting thresholds:', error);
    return { success: false, error: error.message };
  }
});

// Start battery monitoring
ipcMain.handle('battery:startMonitoring', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    batteryService.startMonitoring();
    return { success: true };
  } catch (error) {
    console.error('Error starting battery monitoring:', error);
    return { success: false, error: error.message };
  }
});

// Stop battery monitoring
ipcMain.handle('battery:stopMonitoring', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    batteryService.stopMonitoring();
    return { success: true };
  } catch (error) {
    console.error('Error stopping battery monitoring:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// System Health IPC Handlers
// ========================================

// Get comprehensive system health report
ipcMain.handle('systemHealth:getReport', async () => {
  try {
    if (!systemHealthService) {
      return { success: false, error: 'System health service not initialized' };
    }
    const report = await systemHealthService.getHealthReport();
    return { success: true, ...report };
  } catch (error) {
    console.error('Error getting system health report:', error);
    return { success: false, error: error.message };
  }
});

// Get current system health
ipcMain.handle('systemHealth:getCurrent', async () => {
  try {
    if (!systemHealthService) {
      return { success: false, error: 'System health service not initialized' };
    }
    const health = await systemHealthService.getSystemHealth();
    return { success: true, health };
  } catch (error) {
    console.error('Error getting current system health:', error);
    return { success: false, error: error.message };
  }
});

// Get health trend
ipcMain.handle('systemHealth:getTrend', async () => {
  try {
    if (!systemHealthService) {
      return { success: false, error: 'System health service not initialized' };
    }
    const trend = systemHealthService.getHealthTrend();
    return { success: true, trend };
  } catch (error) {
    console.error('Error getting health trend:', error);
    return { success: false, error: error.message };
  }
});

// Get cooling recommendations
ipcMain.handle('systemHealth:getCoolingRecommendations', async () => {
  try {
    if (!systemHealthService) {
      return { success: false, error: 'System health service not initialized' };
    }
    const recommendations = systemHealthService.getCoolingRecommendations();
    return { success: true, recommendations };
  } catch (error) {
    console.error('Error getting cooling recommendations:', error);
    return { success: false, error: error.message };
  }
});

// Get system health alerts
ipcMain.handle('systemHealth:getAlerts', async (_event, limit = 20) => {
  try {
    if (!systemHealthService) {
      return { success: false, error: 'System health service not initialized' };
    }
    const alerts = systemHealthService.getAlerts(limit);
    return { success: true, alerts };
  } catch (error) {
    console.error('Error getting system health alerts:', error);
    return { success: false, error: error.message };
  }
});

// Clear system health alerts
ipcMain.handle('systemHealth:clearAlerts', async () => {
  try {
    if (!systemHealthService) {
      return { success: false, error: 'System health service not initialized' };
    }
    systemHealthService.clearAlerts();
    return { success: true };
  } catch (error) {
    console.error('Error clearing system health alerts:', error);
    return { success: false, error: error.message };
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
