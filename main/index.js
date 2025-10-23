const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
const db = require('./services/database');
const firebase = require('./services/firebase');
const emailService = require('./services/emailService');
const monitoringService = require('./services/monitoring');
const optimizerService = require('./services/optimizer');

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
      webSecurity: true,
      cache: false, // Disable cache in development
    },
    icon: path.join(__dirname, '../assets/icons/icon.png'),
    show: false, // Don't show until ready-to-show
  });

  // Set Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          process.env.NODE_ENV === 'development'
            ? "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline';"
            : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;",
        ],
      },
    });
  });

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
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

ipcMain.handle('auth:verify-email', async (_event, { code }) => {
  try {
    // Get current user to get UID
    const user = firebase.getCurrentUser();
    if (!user) {
      return { success: false, error: 'No user session found' };
    }

    const result = await firebase.verifyEmail(user.uid, code);
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

ipcMain.handle('auth:resend-code', async () => {
  try {
    // Get current user to get UID
    const user = firebase.getCurrentUser();
    if (!user) {
      return { success: false, error: 'No user session found' };
    }

    const result = await firebase.resendVerificationCode(user.uid, user.email);
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
    const verificationCodes = db.getAllVerificationCodes();
    return { success: true, users, verificationCodes };
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

ipcMain.handle('system:optimize', async () => {
  try {
    const result = await optimizerService.optimizeSystem();
    return { success: true, data: result };
  } catch (error) {
    console.error('Error optimizing system:', error);
    return { success: false, error: error.message };
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

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
