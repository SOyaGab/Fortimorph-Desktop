const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
const db = require('./services/database');
const auth = require('./services/auth');
const email = require('./services/email');

// Initialize electron-store for secure configuration
const store = new Store();

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
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;",
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
app.whenReady().then(() => {
  // Initialize database
  try {
    db.initialize();
    email.initialize();
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
    const result = await auth.signup(email, password);
    
    if (result.success) {
      // Send verification email
      await email.sendVerificationCode(email, result.verificationCode);
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:verify-email', async (event, { email, code }) => {
  try {
    const result = auth.verifyEmail(email, code);
    
    if (result.success) {
      // Send welcome email
      await email.sendWelcomeEmail(email);
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:resend-code', async (event, { email }) => {
  try {
    const result = auth.resendVerificationCode(email);
    
    if (result.success) {
      await email.sendVerificationCode(email, result.verificationCode);
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:login', async (event, { email, password }) => {
  try {
    const result = await auth.login(email, password);
    
    if (result.success) {
      sessionData.isAuthenticated = true;
      sessionData.user = result.user;
      sessionData.sessionToken = result.sessionToken;
      startSessionTimeout();
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  clearSession();
  return { success: true };
});

ipcMain.handle('auth:request-reset', async (event, { email }) => {
  try {
    const result = auth.requestPasswordReset(email);
    
    if (result.success && result.resetCode) {
      await email.sendPasswordResetCode(email, result.resetCode);
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:reset-password', async (event, { email, code, newPassword }) => {
  try {
    const result = await auth.resetPassword(email, code, newPassword);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
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

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
