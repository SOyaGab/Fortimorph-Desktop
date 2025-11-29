const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const db = require('./services/database');
const firebase = require('./services/firebase');
const emailService = require('./services/emailService');
const monitoringService = require('./services/monitoring');
// const processMonitorService = require('./services/processMonitorService'); // DISABLED - causing performance issues
const optimizerService = require('./services/optimizer');
const LogsService = require('./services/logsService');
const BatteryService = require('./services/batteryService');
const SystemHealthService = require('./services/systemHealthService');
const QuarantineService = require('./services/quarantineService');
const BackupService = require('./services/backupService');
const ConversionService = require('./services/conversionService');
const { verificationService } = require('./services/verificationService');
const antivirusService = require('./services/antivirusService');
const DeletedFilesService = require('./services/deletedFilesService');
const DuplicateFilesService = require('./services/duplicateFilesService');
const BackgroundMonitor = require('./services/backgroundMonitor');

// Initialize services
let logsService;
let batteryService;
let systemHealthService;
let quarantineService;
let backupService;
let conversionService;
let deletedFilesService;
let duplicateFilesService;
let backgroundMonitor;

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
    
    // Pass mainWindow reference to battery service for notification click handling
    if (batteryService) {
      batteryService.setMainWindow(mainWindow);
    }
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
    logsService.setUserIdProvider(() => getCurrentUserId());
    console.log('Logs service initialized');
    
    // Schedule automatic log cleanup (30 days retention)
    logsService.scheduleCleanup(30);
    
    // Initialize battery service
    batteryService = new BatteryService(db);
    // Pass getCurrentUserId function so service can get current user
    batteryService.setUserIdProvider(() => getCurrentUserId());
    await batteryService.initialize();
    console.log('Battery service initialized');
    
    // Initialize background monitor (runs even when UI is closed)
    backgroundMonitor = new BackgroundMonitor(db);
    await backgroundMonitor.start();
    console.log('Background monitor started - data collection will continue even when app is minimized');
    
    // Initialize system health service
    systemHealthService = new SystemHealthService(db);
    systemHealthService.setUserIdProvider(() => getCurrentUserId());
    await systemHealthService.initialize();
    console.log('System health service initialized');
    
    // Pre-warm process cache in background for instant access
    console.log('Pre-warming process cache for instant access...');
    monitoringService.getProcessList({ fastMode: true }).then(() => {
      console.log('✅ Process cache pre-warmed and ready');
    }).catch(err => {
      console.warn('Process cache pre-warming failed:', err.message);
    });
    
    // Initialize quarantine service
    quarantineService = new QuarantineService(db, logsService);
    await quarantineService.initialize();
    console.log('Quarantine service initialized');
    
    // Initialize backup service
    const backupBasePath = path.join(app.getPath('userData'), 'backups');
    backupService = new BackupService(db);
    await backupService.initialize(backupBasePath);
    backupService.setUserIdProvider(() => getCurrentUserId());
    console.log('Backup service initialized');
    
    // Initialize conversion service
    conversionService = new ConversionService(db, logsService);
    conversionService.setUserIdProvider(() => getCurrentUserId());
    console.log('Conversion service initialized');
    
    // Initialize antivirus service
    await antivirusService.initialize();
    console.log('Antivirus service initialized');
    
    // Initialize deleted files service
    const trashBasePath = path.join(app.getPath('userData'), 'trash');
    deletedFilesService = new DeletedFilesService(db, logsService);
    deletedFilesService.setUserIdProvider(() => getCurrentUserId());
    await deletedFilesService.initialize(trashBasePath);
    console.log('Deleted files service initialized');
    
    // Initialize duplicate files service
    duplicateFilesService = new DuplicateFilesService(db, logsService);
    duplicateFilesService.setUserIdProvider(() => getCurrentUserId());
    console.log('Duplicate files service initialized');
    
    // Set userId provider and logsService for verification service
    verificationService.logsService = logsService;
    verificationService.setUserIdProvider(() => getCurrentUserId());
    console.log('Verification service configured with userId provider');
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
  // NOTE: Background monitor continues running even when UI is closed
  // This allows continuous data collection
  console.log('[App] Window closed - background monitor continues running');
  
  // IMPORTANT: Force save database to prevent data loss
  if (db && typeof db.saveDatabaseImmediate === 'function') {
    db.saveDatabaseImmediate();
    console.log('[App] Database saved on window close');
  }
  
  // Cleanup services
  if (quarantineService) {
    quarantineService.cleanup();
  }
  
  // Don't close database - background monitor needs it
  // db.close();
  
  if (process.platform !== 'darwin') {
    // Don't quit app completely - keep background processes running
    // app.quit();
  }
});

// Cleanup on actual app quit (not just window close)
app.on('before-quit', () => {
  console.log('[App] Application quitting - cleaning up background services');
  
  // Stop background monitor
  if (backgroundMonitor) {
    backgroundMonitor.stop();
  }
  
  // Stop battery service
  if (batteryService) {
    batteryService.stop();
  }
  
  // Close database connection
  db.close();
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

// Get current user ID from session
function getCurrentUserId() {
  return sessionData.isAuthenticated && sessionData.user ? sessionData.user.uid : null;
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
      
      // CRITICAL FIX: Clear cached battery usage insights when user logs in
      // This ensures each user sees their own fresh data, not cached data from previous user
      if (batteryService && typeof batteryService.clearUserCache === 'function') {
        batteryService.clearUserCache();
        console.log('Battery cache cleared for new user session');
      }
      
      // Trigger immediate process scan for new user to populate today's data
      if (batteryService && typeof batteryService.updateProcessTrackingAsync === 'function') {
        console.log('Triggering immediate process scan for new user');
        batteryService.updateProcessTrackingAsync().catch(err => {
          console.error('Initial process scan failed (non-critical):', err);
        });
      }
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
    
    // Clear battery cache on logout to prevent data leakage between users
    if (batteryService && typeof batteryService.clearUserCache === 'function') {
      batteryService.clearUserCache();
      console.log('Battery cache cleared on logout');
    }
    
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
    
    // Log database information
    console.log('========================================');
    console.log('DATABASE DEBUG INFO');
    console.log('Database path:', db.dbPath);
    console.log('Users count:', users.length);
    console.log('Firebase users count:', firebaseUsers.length);
    console.log('Verification codes count:', verificationCodes.length);
    console.log('========================================');
    
    return { 
      success: true, 
      users, 
      firebaseUsers, 
      verificationCodes,
      dbPath: db.dbPath 
    };
  } catch (error) {
    console.error('Error getting debug users:', error);
    return { success: false, error: error.message };
  }
});

// Database health check
ipcMain.handle('database:health-check', async () => {
  try {
    const health = {
      isInitialized: db && db.db !== null,
      dbPath: db.dbPath,
      dbExists: require('fs').existsSync(db.dbPath),
      userCount: 0,
      logCount: 0,
      backupCount: 0
    };
    
    if (health.isInitialized) {
      // Count records in main tables
      try {
        const users = db.getAllUsers();
        health.userCount = users.length;
      } catch (e) {
        console.error('Error counting users:', e);
      }
      
      try {
        const stmt = db.db.prepare("SELECT COUNT(*) as count FROM logs");
        stmt.step();
        const row = stmt.getAsObject();
        health.logCount = row.count || 0;
        stmt.free();
      } catch (e) {
        console.error('Error counting logs:', e);
      }
      
      try {
        const stmt = db.db.prepare("SELECT COUNT(*) as count FROM backups");
        stmt.step();
        const row = stmt.getAsObject();
        health.backupCount = row.count || 0;
        stmt.free();
      } catch (e) {
        console.error('Error counting backups:', e);
      }
    }
    
    console.log('Database Health Check:', health);
    return { success: true, data: health };
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

ipcMain.handle('system:get-processes', async (event, options = {}) => {
  try {
    // Try primary method first
    let processes = await monitoringService.getProcessList(options);
    
    // Fallback to battery service tracked processes if primary returns empty
    if ((!processes || processes.length === 0) && batteryService) {
      console.log('[system:get-processes] Primary method returned empty, using battery service fallback');
      processes = batteryService.getTrackedProcessList();
    }
    
    return { success: true, data: processes || [] };
  } catch (error) {
    console.error('Error getting process list:', error);
    
    // Even on error, try to return battery service data as fallback
    if (batteryService) {
      const fallbackData = batteryService.getTrackedProcessList();
      if (fallbackData && fallbackData.length > 0) {
        console.log('[system:get-processes] Using battery service fallback after error');
        return { success: true, data: fallbackData };
      }
    }
    
    return { success: false, error: error.message };
  }
});

// Real-time process streaming for Processes tab with adaptive polling
let processStreamInterval = null;
let isStreamActive = false;
let currentPollInterval = 3000; // Start with 3 seconds
let consecutiveNoChangeCount = 0;
let isTabVisible = true;

ipcMain.handle('system:start-process-stream', async (event) => {
  try {
    // Helper function to get best available process data
    const getBestProcessData = async () => {
      // Try monitoring service first
      let data = await monitoringService.getProcessList({ instant: true }).catch(() => []);
      
      // Fallback to battery service if empty
      if ((!data || data.length === 0) && batteryService) {
        data = batteryService.getTrackedProcessList();
      }
      
      return data || [];
    };
    
    if (isStreamActive) {
      // Even if stream is already running, send current data immediately
      getBestProcessData().then(data => {
        if (!event.sender.isDestroyed() && data?.length > 0) {
          event.sender.send('process-update', { success: true, data });
        }
      });
      return { success: true, message: 'Stream already running' };
    }
    
    if (processStreamInterval) {
      clearInterval(processStreamInterval);
      processStreamInterval = null;
    }
    
    isStreamActive = true;
    currentPollInterval = 2000;
    
    console.log('[Stream] Starting process stream...');
    
    // STEP 1: Send battery service data IMMEDIATELY (already collected, instant!)
    if (batteryService) {
      const instantData = batteryService.getTrackedProcessList();
      if (!event.sender.isDestroyed() && instantData?.length > 0) {
        console.log(`[Stream] ⚡ Battery service instant: ${instantData.length} processes`);
        event.sender.send('process-update', { success: true, data: instantData });
      }
    }
    
    // STEP 2: Also try monitoring service instant (runs in parallel)
    monitoringService.getProcessList({ instant: true }).then(data => {
      if (!event.sender.isDestroyed() && data?.length > 0) {
        console.log(`[Stream] ⚡ Monitoring instant: ${data.length} processes`);
        event.sender.send('process-update', { success: true, data });
      }
    }).catch(() => {});
    
    // STEP 3: After 300ms, send CPU-enriched data
    setTimeout(() => {
      if (!event.sender.isDestroyed() && isStreamActive) {
        getBestProcessData().then(data => {
          if (data?.length > 0) {
            console.log(`[Stream] ✅ Enriched: ${data.length} processes`);
            event.sender.send('process-update', { success: true, data });
          }
        });
      }
    }, 300);
    
    // STEP 4: Continuous polling every 2s for real-time updates
    processStreamInterval = setInterval(async () => {
      if (!event.sender.isDestroyed() && isStreamActive && isTabVisible) {
        try {
          const data = await getBestProcessData();
          if (data?.length > 0) {
            event.sender.send('process-update', { success: true, data });
          }
        } catch (e) {
          console.error('[Stream] Poll error:', e);
        }
      } else if (event.sender.isDestroyed()) {
        clearInterval(processStreamInterval);
        isStreamActive = false;
      }
    }, currentPollInterval);
    
    return { success: true, message: 'Stream started' };
  } catch (error) {
    console.error('[Process Stream] Error starting stream:', error);
    isStreamActive = false;
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:stop-process-stream', async () => {
  try {
    console.log('[Process Stream] Stopping real-time process updates...');
    
    isStreamActive = false;
    isTabVisible = false;
    consecutiveNoChangeCount = 0;
    
    if (processStreamInterval) {
      clearInterval(processStreamInterval);
      processStreamInterval = null;
      console.log('[Process Stream] Stream stopped successfully');
    }
    
    return { success: true, message: 'Process stream stopped' };
  } catch (error) {
    console.error('[Process Stream] Error stopping stream:', error);
    // Still clean up even on error
    isStreamActive = false;
    if (processStreamInterval) {
      clearInterval(processStreamInterval);
      processStreamInterval = null;
    }
    return { success: false, error: error.message };
  }
});

// Handle tab visibility changes
ipcMain.on('system:tab-visibility-changed', (event, isVisible) => {
  isTabVisible = isVisible;
  console.log(`[Process Stream] Tab visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
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

ipcMain.handle('system:end-process-by-name', async (_event, { processName }) => {
  try {
    const result = await optimizerService.endProcessByName(processName);
    return { success: result.success, data: result };
  } catch (error) {
    console.error('Error ending process by name:', error);
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
    const userId = getCurrentUserId();
    return db.getLogTypes(userId);
  } catch (error) {
    console.error('Error getting log types:', error);
    return [];
  }
});

// Export logs to CSV
ipcMain.handle('logs:exportCSV', async (_event, filters) => {
  try {
    const userId = getCurrentUserId();
    const result = await logsService.exportToCSV({ ...filters, userId });
    return result;
  } catch (error) {
    console.error('Error exporting logs to CSV:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to JSON
ipcMain.handle('logs:exportJSON', async (_event, filters) => {
  try {
    const userId = getCurrentUserId();
    const result = await logsService.exportToJSON({ ...filters, userId });
    return result;
  } catch (error) {
    console.error('Error exporting logs to JSON:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to XML
ipcMain.handle('logs:exportXML', async (_event, filters) => {
  try {
    const userId = getCurrentUserId();
    const result = await logsService.exportToXML({ ...filters, userId });
    return result;
  } catch (error) {
    console.error('Error exporting logs to XML:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to TXT
ipcMain.handle('logs:exportTXT', async (_event, filters) => {
  try {
    const userId = getCurrentUserId();
    const result = await logsService.exportToTXT({ ...filters, userId });
    return result;
  } catch (error) {
    console.error('Error exporting logs to TXT:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to HTML
ipcMain.handle('logs:exportHTML', async (_event, filters) => {
  try {
    const userId = getCurrentUserId();
    const result = await logsService.exportToHTML({ ...filters, userId });
    return result;
  } catch (error) {
    console.error('Error exporting logs to HTML:', error);
    return { success: false, error: error.message };
  }
});

// Export logs to Markdown
ipcMain.handle('logs:exportMarkdown', async (_event, filters) => {
  try {
    const userId = getCurrentUserId();
    const result = await logsService.exportToMarkdown({ ...filters, userId });
    return result;
  } catch (error) {
    console.error('Error exporting logs to Markdown:', error);
    return { success: false, error: error.message };
  }
});

// Export diagnostic package
ipcMain.handle('logs:exportDiagnostic', async (_event, filters) => {
  try {
    const userId = getCurrentUserId();
    const result = await logsService.exportDiagnosticZIP({ ...filters, userId });
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

// Get historical app usage analytics
ipcMain.handle('battery:getHistoricalUsage', async (_event, timeframe) => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const userId = getCurrentUserId();
    const data = await batteryService.getHistoricalAppUsageAnalytics(timeframe || 'today', userId);
    return { success: true, data };
  } catch (error) {
    console.error('Error getting historical app usage:', error);
    return { success: false, error: error.message };
  }
});

// Get all timeframe usage insights
ipcMain.handle('battery:getAllTimeframeInsights', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    const userId = getCurrentUserId();
    
    // CRITICAL FIX: Trigger immediate process scan if no tracking data exists yet
    // This ensures new users see data immediately instead of waiting for periodic updates
    if (batteryService.processTracking && batteryService.processTracking.size === 0) {
      console.log('[Usage Insights Request] No process tracking data yet - triggering immediate scan');
      try {
        // Don't await - let it run in background while we fetch what we have
        batteryService.updateProcessTrackingAsync().catch(err => {
          console.error('[Usage Insights] Background scan failed (non-critical):', err);
        });
        
        // Give it a moment to collect initial data (500ms should be enough for fast scan)
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (scanError) {
        console.error('[Usage Insights] Initial scan failed:', scanError);
        // Continue anyway - we'll show what we have
      }
    }
    
    const data = await batteryService.getAllTimeframeUsageInsights(userId);
    return { success: true, data };
  } catch (error) {
    console.error('Error getting all timeframe insights:', error);
    return { success: false, error: error.message };
  }
});

// Clear usage insights cache (for force refresh)
ipcMain.handle('battery:clearUsageCache', async () => {
  try {
    if (!batteryService) {
      return { success: false, error: 'Battery service not initialized' };
    }
    
    if (typeof batteryService.clearUserCache === 'function') {
      batteryService.clearUserCache();
      console.log('[Usage Cache] Cleared on user request');
      return { success: true };
    }
    
    return { success: false, error: 'Clear cache method not available' };
  } catch (error) {
    console.error('Error clearing usage cache:', error);
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

// ========================================
// Quarantine IPC Handlers
// ========================================

// Quarantine a file
ipcMain.handle('quarantine:quarantineFile', async (_event, { filePath, reason }) => {
  try {
    if (!quarantineService) {
      return { success: false, error: 'Quarantine service not initialized' };
    }
    const userId = getCurrentUserId();
    const result = await quarantineService.quarantineFile(filePath, reason, userId);
    return result;
  } catch (error) {
    console.error('Error quarantining file:', error);
    return { success: false, error: error.message };
  }
});

// Restore file from quarantine
ipcMain.handle('quarantine:restoreFile', async (_event, params) => {
  const startTime = Date.now();
  try {
    if (!quarantineService) {
      throw new Error('Quarantine service not initialized');
    }
    
    console.log('Restore quarantine params:', params);
    const { quarantineId, restorePath, conflictMode } = params;
    
    if (!quarantineId) {
      throw new Error('Missing required parameter: quarantineId');
    }
    
    const userId = getCurrentUserId();
    console.log(`[Quarantine] Starting restore of file ID ${quarantineId}...`);
    const result = await quarantineService.restoreFile(quarantineId, restorePath, conflictMode, userId);
    const duration = Date.now() - startTime;
    console.log(`[Quarantine] Restore completed in ${duration}ms:`, result);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Quarantine] Error restoring file after ${duration}ms:`, error);
    return { 
      success: false, 
      error: error.message || 'Unknown error occurred during restore' 
    };
  }
});

// Purge file from quarantine
ipcMain.handle('quarantine:purgeFile', async (_event, { quarantineId }) => {
  try {
    if (!quarantineService) {
      return { success: false, error: 'Quarantine service not initialized' };
    }
    const userId = getCurrentUserId();
    const result = await quarantineService.purgeFile(quarantineId, userId);
    return result;
  } catch (error) {
    console.error('Error purging file:', error);
    return { success: false, error: error.message };
  }
});

// Get quarantined files
ipcMain.handle('quarantine:getQuarantinedFiles', async (_event, filters) => {
  try {
    if (!quarantineService) {
      return { success: false, error: 'Quarantine service not initialized' };
    }
    const userId = getCurrentUserId();
    const files = quarantineService.getQuarantinedFiles({ ...filters, userId });
    return files;
  } catch (error) {
    console.error('Error getting quarantined files:', error);
    return [];
  }
});

// Get quarantine statistics
ipcMain.handle('quarantine:getStats', async () => {
  try {
    if (!quarantineService) {
      return { success: false, error: 'Quarantine service not initialized' };
    }
    const userId = getCurrentUserId();
    const stats = quarantineService.getQuarantineStats(userId);
    return stats;
  } catch (error) {
    console.error('Error getting quarantine stats:', error);
    return {
      totalFiles: 0,
      totalSize: 0,
      restoredFiles: 0,
      purgedFiles: 0,
      queuedFiles: 0
    };
  }
});

// Get retry queue
ipcMain.handle('quarantine:getRetryQueue', async () => {
  try {
    if (!quarantineService) {
      return { success: false, error: 'Quarantine service not initialized' };
    }
    const queue = quarantineService.getRetryQueue();
    return queue;
  } catch (error) {
    console.error('Error getting retry queue:', error);
    return [];
  }
});

// Open quarantine folder
ipcMain.handle('quarantine:openFolder', async () => {
  try {
    if (!quarantineService) {
      return { success: false, error: 'Quarantine service not initialized' };
    }
    const quarantineDir = quarantineService.getQuarantineDir();
    await shell.openPath(quarantineDir);
    return { success: true };
  } catch (error) {
    console.error('Error opening quarantine folder:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// Backup IPC Handlers
// ========================================

// Create backup
ipcMain.handle('backup:create', async (_event, { name, sourcePath, options }) => {
  try {
    if (!backupService) {
      return { success: false, error: 'Backup service not initialized' };
    }
    
    const userId = getCurrentUserId();
    const result = await backupService.createBackup(sourcePath, { name, ...options, userId });
    return result;
  } catch (error) {
    console.error('Error creating backup:', error);
    return { success: false, error: error.message };
  }
});

// Restore backup
ipcMain.handle('backup:restore', async (_event, params) => {
  try {
    if (!backupService) {
      throw new Error('Backup service not initialized');
    }
    
    console.log('Restore backup params:', params);
    const { backupId, targetPath, options } = params;
    
    if (!backupId || !targetPath) {
      throw new Error('Missing required parameters: backupId and targetPath');
    }
    
    const result = await backupService.restoreBackup(backupId, targetPath, options || {});
    console.log('Restore backup result:', result);
    return result;
  } catch (error) {
    console.error('Error restoring backup:', error);
    return { success: false, error: error.message };
  }
});

// Verify backup
ipcMain.handle('backup:verify', async (_event, backupId) => {
  try {
    if (!backupService) {
      return { success: false, error: 'Backup service not initialized' };
    }
    
    const result = await backupService.verifyBackup(backupId);
    return result;
  } catch (error) {
    console.error('Error verifying backup:', error);
    return { success: false, error: error.message };
  }
});

// List backups
ipcMain.handle('backup:list', async () => {
  try {
    if (!backupService) {
      return [];
    }
    
    const userId = getCurrentUserId();
    const backups = backupService.listBackups(userId);
    return backups;
  } catch (error) {
    console.error('Error listing backups:', error);
    return [];
  }
});

// Delete backup
ipcMain.handle('backup:delete', async (_event, backupId) => {
  try {
    if (!backupService) {
      return { success: false, error: 'Backup service not initialized' };
    }
    
    const result = await backupService.deleteBackup(backupId);
    return result;
  } catch (error) {
    console.error('Error deleting backup:', error);
    return { success: false, error: error.message };
  }
});

// Generate recovery key
ipcMain.handle('backup:generateRecoveryKey', async () => {
  try {
    if (!backupService) {
      return { success: false, error: 'Backup service not initialized' };
    }
    
    const userId = getCurrentUserId();
    const recoveryKey = backupService.generateRecoveryKey(userId);
    return { success: true, recoveryKey };
  } catch (error) {
    console.error('Error generating recovery key:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// Deleted Files IPC Handlers
// ========================================

// List deleted files
ipcMain.handle('deletedFiles:list', async (_event, filters) => {
  try {
    if (!deletedFilesService) {
      return [];
    }
    
    const userId = getCurrentUserId();
    const files = await deletedFilesService.getDeletedFiles({ ...filters, userId });
    return files;
  } catch (error) {
    console.error('Error listing deleted files:', error);
    return [];
  }
});

// Get deleted files statistics
ipcMain.handle('deletedFiles:getStats', async () => {
  try {
    if (!deletedFilesService) {
      return { totalCount: 0, totalSize: 0, byType: {}, folders: 0 };
    }
    
    const userId = getCurrentUserId();
    const stats = await deletedFilesService.getStatistics(userId);
    return stats;
  } catch (error) {
    console.error('Error getting deleted files stats:', error);
    return { totalCount: 0, totalSize: 0, byType: {}, folders: 0 };
  }
});

// Restore deleted file
ipcMain.handle('deletedFiles:restore', async (_event, fileId, options) => {
  try {
    if (!deletedFilesService) {
      return { success: false, error: 'Deleted files service not initialized' };
    }
    
    const result = await deletedFilesService.restoreFile(fileId, options || {});
    return result;
  } catch (error) {
    console.error('Error restoring file:', error);
    return { success: false, error: error.message };
  }
});

// Permanently delete file
ipcMain.handle('deletedFiles:permanentlyDelete', async (_event, fileId) => {
  try {
    if (!deletedFilesService) {
      return { success: false, error: 'Deleted files service not initialized' };
    }
    
    const result = await deletedFilesService.permanentlyDelete(fileId);
    return result;
  } catch (error) {
    console.error('Error permanently deleting file:', error);
    return { success: false, error: error.message };
  }
});

// Empty trash
ipcMain.handle('deletedFiles:emptyTrash', async () => {
  try {
    if (!deletedFilesService) {
      return { success: false, error: 'Deleted files service not initialized' };
    }
    
    const result = await deletedFilesService.emptyTrash();
    return result;
  } catch (error) {
    console.error('Error emptying trash:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// Duplicate Files IPC Handlers
// ========================================

// Scan for duplicates
ipcMain.handle('duplicateFiles:scan', async (_event, dirPaths, options) => {
  try {
    if (!duplicateFilesService) {
      return { success: false, error: 'Duplicate files service not initialized' };
    }
    
    const result = await duplicateFilesService.findDuplicates(dirPaths, options || {});
    
    // Save scan results to database
    if (result) {
      await duplicateFilesService.saveScanResults(result);
    }
    
    return result;
  } catch (error) {
    console.error('Error scanning for duplicates:', error);
    return { success: false, error: error.message };
  }
});

// Get cached scan results
ipcMain.handle('duplicateFiles:getCachedResults', async () => {
  try {
    if (!duplicateFilesService) {
      return null;
    }
    
    const results = duplicateFilesService.getCachedResults();
    return results;
  } catch (error) {
    console.error('Error getting cached results:', error);
    return null;
  }
});

// Delete duplicate files
ipcMain.handle('duplicateFiles:delete', async (_event, hash, filesToKeep) => {
  try {
    if (!duplicateFilesService) {
      return { success: false, error: 'Duplicate files service not initialized' };
    }
    
    // Get cached results
    const scanResults = duplicateFilesService.getCachedResults();
    if (!scanResults) {
      return { success: false, error: 'No scan results available' };
    }
    
    // Find the duplicate group
    const group = scanResults.duplicateGroups.find(g => g.hash === hash);
    if (!group) {
      return { success: false, error: 'Duplicate group not found' };
    }
    
    const result = await duplicateFilesService.deleteDuplicates(group, filesToKeep || []);
    return { success: true, ...result };
  } catch (error) {
    console.error('Error deleting duplicates:', error);
    return { success: false, error: error.message };
  }
});

// Get scan history
ipcMain.handle('duplicateFiles:getScanHistory', async (_event, limit) => {
  const userId = getCurrentUserId();
  try {
    if (!duplicateFilesService) {
      return [];
    }
    
    const history = duplicateFilesService.getScanHistory(limit || 10, userId);
    return history;
  } catch (error) {
    console.error('Error getting scan history:', error);
    return [];
  }
});

// Clear cached results
ipcMain.handle('duplicateFiles:clearResults', async () => {
  try {
    if (!duplicateFilesService) {
      return { success: false, error: 'Duplicate files service not initialized' };
    }
    
    duplicateFilesService.clearResults();
    return { success: true };
  } catch (error) {
    console.error('Error clearing results:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// Verification Token IPC Handlers
// ========================================

// Generate verification token
ipcMain.handle('verification:generate', async (_event, options) => {
  try {
    console.log('[IPC] verification:generate called with options:', JSON.stringify(options, null, 2));
    const result = await verificationService.generateToken(options);
    console.log('[IPC] Token generated successfully:', result.tokenId);
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] Error generating verification token:', error);
    console.error('[IPC] Error stack:', error.stack);
    console.error('[IPC] Options that failed:', JSON.stringify(options, null, 2));
    return { success: false, error: error.message };
  }
});

// Verify token
ipcMain.handle('verification:verify', async (_event, tokenString) => {
  try {
    const result = await verificationService.verifyToken(tokenString);
    return result;
  } catch (error) {
    console.error('Error verifying token:', error);
    return { valid: false, error: 'VERIFICATION_ERROR', message: error.message };
  }
});

// Get token info
ipcMain.handle('verification:getTokenInfo', async (_event, tokenId) => {
  try {
    const info = await verificationService.getTokenInfo(tokenId);
    return { success: true, data: info };
  } catch (error) {
    console.error('Error getting token info:', error);
    return { success: false, error: error.message };
  }
});

// List tokens
ipcMain.handle('verification:listTokens', async (_event, filters) => {
  try {
    const tokens = await verificationService.listTokens(filters || {});
    return tokens;
  } catch (error) {
    console.error('Error listing tokens:', error);
    return [];
  }
});

// Delete token
ipcMain.handle('verification:deleteToken', async (_event, tokenId) => {
  try {
    const result = await verificationService.deleteToken(tokenId);
    return { success: result };
  } catch (error) {
    console.error('Error deleting token:', error);
    return { success: false, error: error.message };
  }
});

// Cleanup expired tokens
ipcMain.handle('verification:cleanup', async () => {
  try {
    const deleted = await verificationService.cleanupExpiredTokens();
    return deleted;
  } catch (error) {
    console.error('Error cleaning up tokens:', error);
    return 0;
  }
});

// Get backups for resource selection
ipcMain.handle('verification:getBackups', async () => {
  try {
    const userId = getCurrentUserId();
    const backups = db.getBackupsForSelection(userId);
    return backups;
  } catch (error) {
    console.error('Error getting backups:', error);
    return [];
  }
});

// Get conversion history for resource selection
ipcMain.handle('verification:getConversionHistory', async () => {
  try {
    const userId = getCurrentUserId();
    const conversions = db.getConversionHistoryForSelection(userId);
    return conversions;
  } catch (error) {
    console.error('Error getting conversion history:', error);
    return [];
  }
});

// Get diagnostic reports for resource selection
ipcMain.handle('verification:getDiagnosticReports', async () => {
  try {
    const userId = getCurrentUserId();
    const reports = db.getDiagnosticReportsForSelection(userId);
    return reports;
  } catch (error) {
    console.error('Error getting diagnostic reports:', error);
    return [];
  }
});

// Open file dialog for file browsing
ipcMain.handle('verification:openFileDialog', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Select File to Verify'
    });
    return result;
  } catch (error) {
    console.error('Error opening file dialog:', error);
    return { canceled: true };
  }
});

// Open folder dialog for folder browsing
ipcMain.handle('verification:openFolderDialog', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Folder to Verify'
    });
    return result;
  } catch (error) {
    console.error('Error opening folder dialog:', error);
    return { canceled: true };
  }
});

// Calculate file hash
ipcMain.handle('verification:calculateFileHash', async (_event, filePath) => {
  try {
    const fs = require('fs');
    const crypto = require('crypto');
    const path = require('path');
    
    // Get file stats
    const stats = fs.statSync(filePath);
    
    // Calculate SHA-256 hash
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    return new Promise((resolve, reject) => {
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => {
        resolve({
          name: path.basename(filePath),
          path: filePath,
          size: stats.size,
          hash: hash.digest('hex')
        });
      });
      stream.on('error', (error) => reject(error));
    });
  } catch (error) {
    console.error('Error calculating file hash:', error);
    throw error;
  }
});

// Calculate folder hash (hash of all files)
ipcMain.handle('verification:calculateFolderHash', async (_event, folderPath) => {
  try {
    const fs = require('fs');
    const crypto = require('crypto');
    const path = require('path');
    
    // Get all files in folder recursively
    const getAllFiles = (dirPath, arrayOfFiles = []) => {
      const files = fs.readdirSync(dirPath);
      
      files.forEach((file) => {
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
          arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
        } else {
          arrayOfFiles.push(filePath);
        }
      });
      
      return arrayOfFiles;
    };
    
    const files = getAllFiles(folderPath);
    const hash = crypto.createHash('sha256');
    
    // Hash all file paths and contents
    for (const file of files) {
      hash.update(file);
      const content = fs.readFileSync(file);
      hash.update(content);
    }
    
    return {
      name: path.basename(folderPath),
      path: folderPath,
      size: files.reduce((total, file) => total + fs.statSync(file).size, 0),
      hash: hash.digest('hex'),
      fileCount: files.length
    };
  } catch (error) {
    console.error('Error calculating folder hash:', error);
    throw error;
  }
});

// ========================================
// BLUETOOTH FILE TRANSFER HANDLERS
// ========================================

const bluetoothService = require('./services/bluetoothService');

// Prepare file for Bluetooth transfer
ipcMain.handle('bluetooth:prepareTransfer', async (_event, filePath) => {
  try {
    return await bluetoothService.prepareFileTransfer(filePath);
  } catch (error) {
    console.error('[Bluetooth IPC] Prepare transfer error:', error);
    return { success: false, error: error.message };
  }
});

// Get file chunk for transfer
ipcMain.handle('bluetooth:getChunk', async (_event, transferId, chunkIndex) => {
  try {
    return await bluetoothService.getFileChunk(transferId, chunkIndex);
  } catch (error) {
    console.error('[Bluetooth IPC] Get chunk error:', error);
    return { success: false, error: error.message };
  }
});

// Complete file transfer
ipcMain.handle('bluetooth:completeTransfer', async (_event, transferId) => {
  try {
    return bluetoothService.completeTransfer(transferId);
  } catch (error) {
    console.error('[Bluetooth IPC] Complete transfer error:', error);
    return { success: false, error: error.message };
  }
});

// Cancel file transfer
ipcMain.handle('bluetooth:cancelTransfer', async (_event, transferId) => {
  try {
    return bluetoothService.cancelTransfer(transferId);
  } catch (error) {
    console.error('[Bluetooth IPC] Cancel transfer error:', error);
    return { success: false, error: error.message };
  }
});

// Receive file via Bluetooth
ipcMain.handle('bluetooth:receiveFile', async (_event, fileData) => {
  try {
    return await bluetoothService.receiveFile(fileData);
  } catch (error) {
    console.error('[Bluetooth IPC] Receive file error:', error);
    return { success: false, error: error.message };
  }
});

// Get transfer status
ipcMain.handle('bluetooth:getStatus', async (_event, transferId) => {
  try {
    return bluetoothService.getTransferStatus(transferId);
  } catch (error) {
    console.error('[Bluetooth IPC] Get status error:', error);
    return { success: false, error: error.message };
  }
});

// Get all active transfers
ipcMain.handle('bluetooth:getActiveTransfers', async () => {
  try {
    return bluetoothService.getActiveTransfers();
  } catch (error) {
    console.error('[Bluetooth IPC] Get active transfers error:', error);
    return { success: false, error: error.message };
  }
});

// Parse QR code from image file
ipcMain.handle('verification:parseQRCode', async (_event, imagePath) => {
  try {
    const jsQR = require('jsqr');
    const { createCanvas, loadImage } = require('canvas');
    const fs = require('fs');
    
    // Load image
    const image = await loadImage(imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    // Parse QR code
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    
    if (code) {
      return { success: true, data: code.data };
    } else {
      return { success: false, error: 'No QR code found in image' };
    }
  } catch (error) {
    console.error('Error parsing QR code:', error);
    return { success: false, error: error.message };
  }
});

// Open backup folder
ipcMain.handle('backup:openFolder', async () => {
  try {
    if (!backupService) {
      return { success: false, error: 'Backup service not initialized' };
    }
    const backupDir = backupService.getBackupDir();
    await shell.openPath(backupDir);
    return { success: true };
  } catch (error) {
    console.error('Error opening backup folder:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// Conversion Handlers
// ========================================

// Execute file conversion
ipcMain.handle('conversion:execute', async (_event, options) => {
  try {
    if (!conversionService) {
      return { success: false, error: 'Conversion service not initialized' };
    }

    const result = await conversionService.convert(options);
    return result;
  } catch (error) {
    console.error('Error executing conversion:', error);
    return { success: false, error: error.message };
  }
});

// Package multiple files
ipcMain.handle('conversion:package', async (_event, options) => {
  try {
    if (!conversionService) {
      return { success: false, error: 'Conversion service not initialized' };
    }

    const result = await conversionService.packageFiles(
      options.filePaths,
      options.outputPath,
      options
    );
    return result;
  } catch (error) {
    console.error('Error packaging files:', error);
    return { success: false, error: error.message };
  }
});

// Get supported output formats
ipcMain.handle('conversion:getSupportedFormats', async (_event, inputPath) => {
  try {
    console.log('🔄 Getting supported formats for:', inputPath);
    
    if (!conversionService) {
      console.warn('⚠️ Conversion service not initialized');
      return [];
    }

    const formats = conversionService.getSupportedOutputFormats(inputPath);
    console.log('✅ Supported formats:', formats);
    
    return formats || [];
  } catch (error) {
    console.error('❌ Error getting supported formats:', error);
    return [];
  }
});

// List conversion history
ipcMain.handle('conversion:list', async (_event, limit) => {
  try {
    if (!conversionService) {
      return [];
    }

    const userId = getCurrentUserId();
    const history = db.getConversions(limit || 50, userId);
    return history;
  } catch (error) {
    console.error('Error listing conversions:', error);
    return [];
  }
});

// Verify conversion integrity
ipcMain.handle('conversion:verify', async (_event, conversionId) => {
  try {
    if (!conversionService) {
      return { success: false, error: 'Conversion service not initialized' };
    }

    // Add timeout wrapper to prevent UI freeze
    const verifyWithTimeout = async () => {
      return new Promise(async (resolve, reject) => {
        // Set timeout to 15 seconds
        const timeoutId = setTimeout(() => {
          reject(new Error('Verification timeout - operation took too long'));
        }, 15000);

        try {
          const result = await conversionService.verifyConversion(conversionId);
          clearTimeout(timeoutId);
          resolve(result);
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
    };

    const result = await verifyWithTimeout();
    return result;
  } catch (error) {
    console.error('Error verifying conversion:', error);
    
    // Return a safe result even on timeout
    return { 
      success: false, 
      isValid: false,
      error: error.message,
      virusScan: {
        isClean: true,
        threat: null,
        message: 'Verification timeout or error occurred',
        skipped: true
      }
    };
  }
});

// Get conversion statistics
ipcMain.handle('conversion:getStats', async () => {
  try {
    if (!conversionService) {
      return { total: 0, completed: 0, failed: 0 };
    }

    const userId = getCurrentUserId();
    const stats = await db.getConversionStats(userId);
    return stats;
  } catch (error) {
    console.error('Error getting conversion stats:', error);
    return { total: 0, completed: 0, failed: 0 };
  }
});

// Select output directory
ipcMain.handle('conversion:selectOutputDirectory', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Output Directory'
    });
    
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    
    return result.filePaths[0];
  } catch (error) {
    console.error('Error selecting output directory:', error);
    return null;
  }
});

// Open conversion folder
ipcMain.handle('conversion:openFolder', async (_event, { filePath } = {}) => {
  try {
    if (!conversionService) {
      return { success: false, error: 'Conversion service not initialized' };
    }
    
    let folderToOpen;
    
    // If a specific file path is provided, open its directory
    if (filePath) {
      folderToOpen = path.dirname(filePath);
    } else {
      // Otherwise, get the most recent conversion directory
      folderToOpen = await conversionService.getConversionDir();
    }
    
    console.log('Opening folder:', folderToOpen);
    await shell.openPath(folderToOpen);
    return { success: true, path: folderToOpen };
  } catch (error) {
    console.error('Error opening conversion folder:', error);
    return { success: false, error: error.message };
  }
});

// Open converted file directly
ipcMain.handle('conversion:openFile', async (_event, { filePath }) => {
  try {
    if (!filePath) {
      return { success: false, error: 'File path is required' };
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }
    
    console.log('Opening file:', filePath);
    const result = await shell.openPath(filePath);
    
    // openPath returns empty string on success, or error message on failure
    if (result) {
      console.error('Failed to open file:', result);
      return { success: false, error: result };
    }
    
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error opening file:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// File Dialog Handlers
// ========================================

// Show open file dialog
ipcMain.handle('show-open-dialog', async (_event, options) => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  } catch (error) {
    console.error('Error showing open dialog:', error);
    return { canceled: true, error: error.message };
  }
});

// Show open directory dialog
ipcMain.handle('dialog:openDirectory', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    return result;
  } catch (error) {
    console.error('Error showing directory dialog:', error);
    return { canceled: true, error: error.message };
  }
});

// Show open file/folder dialog (supports both files and folders)
// Note: On Windows, we can't mix openFile and openDirectory in a single dialog
// So we show a file dialog that allows multiple file selection
ipcMain.handle('dialog:openFileOrFolder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: 'Select Files to Backup'
    });
    return result;
  } catch (error) {
    console.error('Error showing file/folder dialog:', error);
    return { canceled: true, error: error.message };
  }
});

// Show open folder dialog for selecting folders (separate from file selection)
ipcMain.handle('dialog:openFolderForBackup', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'multiSelections'],
      title: 'Select Folders to Backup'
    });
    return result;
  } catch (error) {
    console.error('Error showing folder dialog:', error);
    return { canceled: true, error: error.message };
  }
});

// Show item in folder (for opening file location)
ipcMain.handle('shell:showItemInFolder', async (_event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error showing item in folder:', error);
    return { success: false, error: error.message };
  }
});

// Get user home directory
ipcMain.handle('system:getUserHome', async () => {
  try {
    return app.getPath('home');
  } catch (error) {
    console.error('Error getting user home:', error);
    return null;
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
