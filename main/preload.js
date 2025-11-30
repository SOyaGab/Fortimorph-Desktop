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
  
  // Database operations
  database: {
    healthCheck: () => ipcRenderer.invoke('database:health-check'),
  },
  
  // Session events
  onSessionExpired: (callback) => {
    ipcRenderer.on('session-expired', callback);
  },
  
  // System Monitoring
  system: {
    getMetrics: () => ipcRenderer.invoke('system:get-metrics'),
    getProcesses: (options) => ipcRenderer.invoke('system:get-processes', options),
    startProcessStream: () => ipcRenderer.invoke('system:start-process-stream'),
    stopProcessStream: () => ipcRenderer.invoke('system:stop-process-stream'),
    setTabVisibility: (isVisible) => ipcRenderer.send('system:tab-visibility-changed', isVisible),
    onProcessUpdate: (callback) => {
      ipcRenderer.on('process-update', (_event, data) => callback(data));
    },
    removeProcessUpdateListener: () => {
      ipcRenderer.removeAllListeners('process-update');
    },
    getCPU: () => ipcRenderer.invoke('system:get-cpu'),
    getMemory: () => ipcRenderer.invoke('system:get-memory'),
    getBattery: () => ipcRenderer.invoke('system:get-battery'),
    optimize: () => ipcRenderer.invoke('system:optimize'),
    endProcess: (pid, force) => ipcRenderer.invoke('system:end-process', { pid, force }),
    endProcessByName: (processName) => ipcRenderer.invoke('system:end-process-by-name', { processName }),
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
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  createBackup: (config) => ipcRenderer.invoke('create-backup', config),
  restoreBackup: (backupId) => ipcRenderer.invoke('restore-backup', backupId),
});

// Expose quarantine API
contextBridge.exposeInMainWorld('quarantineAPI', {
  quarantineFile: (filePath, reason) => 
    ipcRenderer.invoke('quarantine:quarantineFile', { filePath, reason }),
  restoreFile: (quarantineId, restorePath, conflictMode) => 
    ipcRenderer.invoke('quarantine:restoreFile', { quarantineId, restorePath, conflictMode }),
  purgeFile: (quarantineId) => 
    ipcRenderer.invoke('quarantine:purgeFile', { quarantineId }),
  getQuarantinedFiles: (filters) => 
    ipcRenderer.invoke('quarantine:getQuarantinedFiles', filters),
  getStats: () => 
    ipcRenderer.invoke('quarantine:getStats'),
  getRetryQueue: () => 
    ipcRenderer.invoke('quarantine:getRetryQueue'),
  openFolder: () => 
    ipcRenderer.invoke('quarantine:openFolder'),
});

// Expose backup API
contextBridge.exposeInMainWorld('backupAPI', {
  create: (params) => 
    ipcRenderer.invoke('backup:create', params),
  restore: (params) => 
    ipcRenderer.invoke('backup:restore', params),
  verify: (backupId) => 
    ipcRenderer.invoke('backup:verify', backupId),
  list: () => 
    ipcRenderer.invoke('backup:list'),
  delete: (backupId) => 
    ipcRenderer.invoke('backup:delete', backupId),
  generateRecoveryKey: () => 
    ipcRenderer.invoke('backup:generateRecoveryKey'),
  openFolder: () => 
    ipcRenderer.invoke('backup:openFolder'),
});

// Expose conversion API
contextBridge.exposeInMainWorld('conversionAPI', {
  execute: (options) => 
    ipcRenderer.invoke('conversion:execute', options),
  package: (options) => 
    ipcRenderer.invoke('conversion:package', options),
  getSupportedFormats: (inputPath) => 
    ipcRenderer.invoke('conversion:getSupportedFormats', inputPath),
  list: (limit) => 
    ipcRenderer.invoke('conversion:list', limit),
  verify: (conversionId) => 
    ipcRenderer.invoke('conversion:verify', conversionId),
  getStats: () => 
    ipcRenderer.invoke('conversion:getStats'),
  selectOutputDirectory: () => 
    ipcRenderer.invoke('conversion:selectOutputDirectory'),
  openFolder: (options) => 
    ipcRenderer.invoke('conversion:openFolder', options),
  openFile: (options) => 
    ipcRenderer.invoke('conversion:openFile', options),
});

// Expose deleted files API
contextBridge.exposeInMainWorld('deletedFilesAPI', {
  list: (filters) => 
    ipcRenderer.invoke('deletedFiles:list', filters),
  getStats: () => 
    ipcRenderer.invoke('deletedFiles:getStats'),
  restore: (fileId, options) => 
    ipcRenderer.invoke('deletedFiles:restore', fileId, options),
  permanentlyDelete: (fileId, options) => 
    ipcRenderer.invoke('deletedFiles:permanentlyDelete', fileId, options),
  emptyTrash: () => 
    ipcRenderer.invoke('deletedFiles:emptyTrash'),
});

// Expose duplicate files API
contextBridge.exposeInMainWorld('duplicateFilesAPI', {
  scan: (dirPaths, options) => 
    ipcRenderer.invoke('duplicateFiles:scan', dirPaths, options),
  getCachedResults: () => 
    ipcRenderer.invoke('duplicateFiles:getCachedResults'),
  deleteDuplicates: (hash, filesToKeep) => 
    ipcRenderer.invoke('duplicateFiles:delete', hash, filesToKeep),
  getScanHistory: (limit) => 
    ipcRenderer.invoke('duplicateFiles:getScanHistory', limit),
  clearResults: () => 
    ipcRenderer.invoke('duplicateFiles:clearResults'),
});

// Expose verification API
contextBridge.exposeInMainWorld('verificationAPI', {
  generate: (options) => 
    ipcRenderer.invoke('verification:generate', options),
  verify: (tokenString) => 
    ipcRenderer.invoke('verification:verify', tokenString),
  getTokenInfo: (tokenId) => 
    ipcRenderer.invoke('verification:getTokenInfo', tokenId),
  listTokens: (filters) => 
    ipcRenderer.invoke('verification:listTokens', filters),
  deleteToken: (tokenId) => 
    ipcRenderer.invoke('verification:deleteToken', tokenId),
  cleanup: () => 
    ipcRenderer.invoke('verification:cleanup'),
  // NEW: Resource selection handlers
  getBackups: () => 
    ipcRenderer.invoke('verification:getBackups'),
  getConversionHistory: () => 
    ipcRenderer.invoke('verification:getConversionHistory'),
  getDiagnosticReports: () => 
    ipcRenderer.invoke('verification:getDiagnosticReports'),
  // NEW: File/Folder browser handlers
  openFileDialog: () => 
    ipcRenderer.invoke('verification:openFileDialog'),
  openFolderDialog: () => 
    ipcRenderer.invoke('verification:openFolderDialog'),
  calculateFileHash: (filePath) => 
    ipcRenderer.invoke('verification:calculateFileHash', filePath),
  calculateFolderHash: (folderPath) => 
    ipcRenderer.invoke('verification:calculateFolderHash', folderPath),
  parseQRCode: (imagePath) => 
    ipcRenderer.invoke('verification:parseQRCode', imagePath),
});

// Expose Bluetooth API for file transfers
contextBridge.exposeInMainWorld('bluetoothAPI', {
  prepareTransfer: (filePath) => 
    ipcRenderer.invoke('bluetooth:prepareTransfer', filePath),
  getChunk: (transferId, chunkIndex) => 
    ipcRenderer.invoke('bluetooth:getChunk', transferId, chunkIndex),
  completeTransfer: (transferId) => 
    ipcRenderer.invoke('bluetooth:completeTransfer', transferId),
  cancelTransfer: (transferId) => 
    ipcRenderer.invoke('bluetooth:cancelTransfer', transferId),
  receiveFile: (fileData) => 
    ipcRenderer.invoke('bluetooth:receiveFile', fileData),
  getStatus: (transferId) => 
    ipcRenderer.invoke('bluetooth:getStatus', transferId),
  getActiveTransfers: () => 
    ipcRenderer.invoke('bluetooth:getActiveTransfers'),
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
  'battery:getHistoricalUsage',
  'battery:getAllTimeframeInsights',
      // System health channels
      'system:cooldown',
      'system:optimize',
      'systemHealth:getReport',
      // Quarantine channels
      'quarantine:quarantineFile',
      'quarantine:restoreFile',
      'quarantine:purgeFile',
      'quarantine:getQuarantinedFiles',
      'quarantine:getStats',
      'quarantine:getRetryQueue',
      'quarantine:openFolder',
      // Backup channels
      'backup:create',
      'backup:restore',
      'backup:verify',
      'backup:list',
      'backup:delete',
      'backup:generateRecoveryKey',
      'backup:openFolder',
      // Conversion channels
      'conversion:execute',
      'conversion:package',
      'conversion:getSupportedFormats',
      'conversion:list',
      'conversion:verify',
      'conversion:getStats',
      'conversion:selectOutputDirectory',
      'conversion:openFolder',
      // Verification channels
      'verification:generate',
      'verification:verify',
      'verification:getTokenInfo',
      'verification:listTokens',
      'verification:deleteToken',
      'verification:cleanup',
      // Dialog channels
      'dialog:openDirectory',
      'dialog:openFileOrFolder',
      'dialog:openFolderForBackup',
      // Shell channels
      'shell:showItemInFolder',
      // System channels
      'system:getUserHome',
      // Deleted files channels
      'deletedFiles:list',
      'deletedFiles:getStats',
      'deletedFiles:restore',
      'deletedFiles:permanentlyDelete',
      'deletedFiles:emptyTrash',
      // Duplicate files channels
      'duplicateFiles:scan',
      'duplicateFiles:getCachedResults',
      'duplicateFiles:delete',
      'duplicateFiles:getScanHistory',
      'duplicateFiles:clearResults'
    ];
    
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error(`Invalid IPC channel: ${channel}`);
  },
  // Helper method for file selection (multiple files)
  selectFileOrFolder: () => ipcRenderer.invoke('dialog:openFileOrFolder'),
  // Helper method for folder selection (for backup)
  selectFolderForBackup: () => ipcRenderer.invoke('dialog:openFolderForBackup')
});

// Log that preload has loaded
console.log('Preload script loaded with context isolation enabled');
