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
    checkEmailVerified: (email) => ipcRenderer.invoke('auth:check-email-verified', { email }),
    resendCode: (email) => ipcRenderer.invoke('auth:resend-code', { email }),
    login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
    logout: () => ipcRenderer.invoke('auth:logout'),
    requestPasswordReset: (email) => ipcRenderer.invoke('auth:request-reset', { email }),
    resetPassword: (email, code, newPassword) => 
      ipcRenderer.invoke('auth:reset-password', { email, code, newPassword }),
    checkSession: () => ipcRenderer.invoke('auth:check-session'),
    refreshSession: () => ipcRenderer.invoke('auth:refresh-session'),
    resendVerification: (email) => ipcRenderer.invoke('auth:resend-verification', { email }),
    debugUsers: () => ipcRenderer.invoke('auth:debug-users'),
    manualVerify: (uid) => ipcRenderer.invoke('auth:manual-verify', { uid }),
  },
  
  // Session events
  onSessionExpired: (callback) => {
    ipcRenderer.on('session-expired', callback);
  },
  
  // System Monitoring
  system: {
    getMetrics: () => ipcRenderer.invoke('system:get-metrics'),
    getProcesses: () => ipcRenderer.invoke('system:get-processes'),
    getCPU: () => ipcRenderer.invoke('system:get-cpu'),
    getMemory: () => ipcRenderer.invoke('system:get-memory'),
    getBattery: () => ipcRenderer.invoke('system:get-battery'),
    optimize: () => ipcRenderer.invoke('system:optimize'),
    endProcess: (pid, force) => ipcRenderer.invoke('system:end-process', { pid, force }),
    endProcesses: (pids) => ipcRenderer.invoke('system:end-processes', { pids }),
    clearTemp: () => ipcRenderer.invoke('system:clear-temp'),
    clearCache: () => ipcRenderer.invoke('system:clear-cache'),
    getSuggestions: () => ipcRenderer.invoke('system:get-suggestions'),
    getOptimizationHistory: () => ipcRenderer.invoke('system:get-optimization-history'),
    getInstalledApps: () => ipcRenderer.invoke('system:get-installed-apps'),
    getStorageAnalysis: (minSizeMB) => ipcRenderer.invoke('system:get-storage-analysis', { minSizeMB }),
    openFile: (filePath) => ipcRenderer.invoke('system:open-file', { filePath }),
    showInFolder: (filePath) => ipcRenderer.invoke('system:show-in-folder', { filePath }),
    deleteFile: (filePath) => ipcRenderer.invoke('system:delete-file', { filePath }),
    openFolder: (folderPath) => ipcRenderer.invoke('system:open-folder', { folderPath }),
    deleteFolder: (folderPath) => ipcRenderer.invoke('system:delete-folder', { folderPath }),
  },
  
  // Legacy system operations (kept for compatibility)
  getSystemInfo: () => ipcRenderer.invoke('system:get-metrics'),
  optimizeSystem: () => ipcRenderer.invoke('system:optimize'),
  
  // Process operations
  endProcess: (pid) => ipcRenderer.invoke('system:end-process', { pid, force: false }),
  
  // Notification
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  
  // File operations (to be extended in Module E)
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  createBackup: (config) => ipcRenderer.invoke('create-backup', config),
  restoreBackup: (backupId) => ipcRenderer.invoke('restore-backup', backupId),
});

// Expose logs API separately for cleaner access
contextBridge.exposeInMainWorld('electron', {
  invoke: (channel, ...args) => {
    // Whitelist channels for security
    const validChannels = [
      'logs:getFiltered',
      'logs:getTypes',
      'logs:exportCSV',
      'logs:exportJSON',
      'logs:exportXML',
      'logs:exportTXT',
      'logs:exportHTML',
      'logs:exportMarkdown',
      'logs:exportDiagnostic',
      'logs:openExportFolder',
      'logs:cleanup',
      // Battery channels
      'battery:getData',
      'battery:getReport',
      'battery:getTrend',
      'battery:getStats',
      'battery:getAlerts',
      'battery:clearAlerts',
      'battery:dismissAlert',
      'battery:setOptimizationMode',
      'battery:getOptimizationMode',
      'battery:getOptimizationModeDetails',
      'battery:updateThresholds',
      'battery:getThresholds',
      'battery:startMonitoring',
      'battery:stopMonitoring',
      // System health channels
      'system:cooldown',
      'system:optimize',
      'systemHealth:getReport'
    ];
    
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error(`Invalid IPC channel: ${channel}`);
  }
});

// Log that preload has loaded
console.log('Preload script loaded with context isolation enabled');
