const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Store operations
  getStoreValue: (key) => ipcRenderer.invoke('get-store-value', key),
  setStoreValue: (key, value) => ipcRenderer.invoke('set-store-value', key, value),
  
  // App info
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  
  // Authentication
  auth: {
    signup: (email, password) => ipcRenderer.invoke('auth:signup', { email, password }),
    verifyEmail: (email, code) => ipcRenderer.invoke('auth:verify-email', { email, code }),
    resendCode: (email) => ipcRenderer.invoke('auth:resend-code', { email }),
    login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
    logout: () => ipcRenderer.invoke('auth:logout'),
    requestPasswordReset: (email) => ipcRenderer.invoke('auth:request-reset', { email }),
    resetPassword: (email, code, newPassword) => 
      ipcRenderer.invoke('auth:reset-password', { email, code, newPassword }),
    checkSession: () => ipcRenderer.invoke('auth:check-session'),
    refreshSession: () => ipcRenderer.invoke('auth:refresh-session'),
  },
  
  // Session events
  onSessionExpired: (callback) => {
    ipcRenderer.on('session-expired', callback);
  },
  
  // System operations (to be extended in Module C)
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  optimizeSystem: () => ipcRenderer.invoke('optimize-system'),
  
  // Process operations
  endProcess: (pid) => ipcRenderer.invoke('end-process', pid),
  
  // Notification
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  
  // File operations (to be extended in Module E)
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  createBackup: (config) => ipcRenderer.invoke('create-backup', config),
  restoreBackup: (backupId) => ipcRenderer.invoke('restore-backup', backupId),
});

// Log that preload has loaded
console.log('Preload script loaded with context isolation enabled');
