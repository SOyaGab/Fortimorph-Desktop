import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { FolderOpen, Save, RefreshCw, Trash2, CheckCircle, AlertCircle, Download, HardDrive, Lock, Unlock, QrCode, Copy, Search, FileText } from 'lucide-react';
import TokenConfigModal from './TokenConfigModal';
import BackupRecoveryKeyModal from './BackupRecoveryKeyModal'; // OPTION B: Simplified modal
import DeletedFilesManager from './DeletedFilesManager';
import DuplicateFilesManager from './DuplicateFilesManager';

/**
 * Memoized BackupItem component to prevent unnecessary re-renders
 */
const BackupItem = memo(({ backup, onRestore, onVerify, onDelete, onGenerateToken, formatBytes, formatDate, verifyInProgress }) => {
  return (
    <div className="p-6 hover:bg-gray-750 transition">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-xl font-semibold text-white">{backup.name}</h3>
            {backup.encrypted === 1 && (
              <Lock className="w-4 h-4 text-green-400" title="Encrypted" />
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm text-gray-400 mt-3">
            <div>
              <span className="font-medium">Source:</span>{' '}
              <span className="text-gray-300">{backup.source_path}</span>
            </div>
            <div>
              <span className="font-medium">Created:</span>{' '}
              <span className="text-gray-300">{formatDate(backup.created_at)}</span>
            </div>
            <div>
              <span className="font-medium">Files:</span>{' '}
              <span className="text-gray-300">{backup.file_count}</span>
            </div>
            <div>
              <span className="font-medium">Size:</span>{' '}
              <span className="text-gray-300">{formatBytes(backup.size)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 ml-4">
          <button
            onClick={() => onRestore(backup)}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg transition flex items-center gap-2"
            title="Restore backup"
          >
            <Download className="w-4 h-4" />
            Restore
          </button>
          <button
            onClick={() => onVerify(backup)}
            disabled={verifyInProgress}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition flex items-center gap-2 disabled:opacity-50"
            title="Verify backup integrity"
          >
            <CheckCircle className="w-4 h-4" />
            Verify
          </button>
          {/* 
            OPTION A (Current): Uses TokenConfigModal - Full featured but complex
            OPTION B (Alternative): Uses BackupRecoveryKeyModal - Simpler, more user-friendly
            
            To switch to Option B:
            1. Replace onGenerateToken with onGenerateRecoveryKey in BackupItem props
            2. Update the handler call below
          */}
          <button
            onClick={() => onGenerateToken(backup)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg transition flex flex-col items-center gap-1 group relative"
            title="Generate recovery key for cross-device restore"
          >
            <QrCode className="w-4 h-4" />
            <span className="text-xs">Recovery Key</span>
            {/* OPTION A: Tooltip on hover */}
            <span className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
              For device transfers →
            </span>
          </button>
          <button
            onClick={() => onDelete(backup)}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg transition flex items-center gap-2"
            title="Delete backup"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
});

BackupItem.displayName = 'BackupItem';

/**
 * BackupManager - UI component for backup and restore operations
 * Features:
 * - Create encrypted backups with progress tracking
 * - View backup history with details
 * - Restore backups with conflict handling
 * - Verify backup integrity
 * - Delete old backups
 */
export default function BackupManager() {
  // Tab state
  const [activeTab, setActiveTab] = useState('backups'); // 'backups', 'deleted', 'duplicates'
  
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [restoreInProgress, setRestoreInProgress] = useState(false);
  const [verifyInProgress, setVerifyInProgress] = useState(false);
  const [progress, setProgress] = useState(null);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  
  // Token modal state (OPTION A: Complex modal)
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenModalData, setTokenModalData] = useState({});
  
  // OPTION B: Simplified Recovery Key Modal
  const [showRecoveryKeyModal, setShowRecoveryKeyModal] = useState(false);
  const [selectedBackupForKey, setSelectedBackupForKey] = useState(null);
  
  // Verification confirmation modal state
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false);
  const [backupToVerify, setBackupToVerify] = useState(null);

  // Form states
  const [backupName, setBackupName] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [restorePath, setRestorePath] = useState('');
  const [encryptBackup, setEncryptBackup] = useState(true);
  const [compressBackup, setCompressBackup] = useState(true);
  const [incrementalBackup, setIncrementalBackup] = useState(true);
  const [conflictStrategy, setConflictStrategy] = useState('rename');

  // Load backups on mount
  useEffect(() => {
    loadBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.backupAPI.list();
      setBackups(result || []);
    } catch (error) {
      console.error('Failed to load backups:', error);
      alert('Failed to load backups: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectSourcePath = useCallback(async () => {
    try {
      // Select files (individual files)
      const result = await window.electron.selectFileOrFolder();
      if (result && !result.canceled && result.filePaths.length > 0) {
        // Support multiple selections: join paths with semicolon
        const selectedPaths = result.filePaths.join(';');
        // Append to existing selection if any
        setSourcePath(prev => prev ? `${prev};${selectedPaths}` : selectedPaths);
      }
    } catch (error) {
      console.error('Failed to select files:', error);
    }
  }, []);

  const handleSelectFolderPath = useCallback(async () => {
    try {
      // Select folders
      const result = await window.electron.selectFolderForBackup();
      if (result && !result.canceled && result.filePaths.length > 0) {
        // Support multiple selections: join paths with semicolon
        const selectedPaths = result.filePaths.join(';');
        // Append to existing selection if any
        setSourcePath(prev => prev ? `${prev};${selectedPaths}` : selectedPaths);
      }
    } catch (error) {
      console.error('Failed to select folders:', error);
    }
  }, []);

  const handleSelectRestorePath = useCallback(async () => {
    try {
      const result = await window.electron.invoke('dialog:openDirectory');
      if (result && !result.canceled && result.filePaths.length > 0) {
        setRestorePath(result.filePaths[0]);
      }
    } catch (error) {
      console.error('Failed to select directory:', error);
    }
  }, []);

  const handleCreateBackup = useCallback(async () => {
    if (!backupName || !sourcePath) {
      alert('Please provide a backup name and select a source directory');
      return;
    }

    setBackupInProgress(true);
    setProgress({ phase: 'init', message: 'Initializing backup...' });

    try {
      const result = await window.backupAPI.create({
        name: backupName,
        sourcePath,
        options: {
          encrypt: encryptBackup,
          compress: compressBackup,
          incremental: incrementalBackup
        }
      });

      if (result.success) {
        alert(`Backup created successfully!\nFiles backed up: ${result.filesBackedUp}\nTotal size: ${formatBytes(result.totalSize)}`);
        setShowCreateDialog(false);
        setBackupName('');
        setSourcePath('');
        loadBackups();
      }
    } catch (error) {
      console.error('Backup failed:', error);
      alert('Backup failed: ' + error.message);
    } finally {
      setBackupInProgress(false);
      setProgress(null);
    }
  }, [backupName, sourcePath, encryptBackup, compressBackup, incrementalBackup, loadBackups]);

  const handleRestoreBackup = useCallback(async () => {
    if (!selectedBackup || !restorePath) {
      alert('Please select a backup and a restore location');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to restore this backup to:\n${restorePath}\n\nConflict strategy: ${conflictStrategy}`
    );

    if (!confirmed) return;

    setRestoreInProgress(true);
    setProgress({ phase: 'init', message: 'Initializing restore...' });

    try {
      const result = await window.backupAPI.restore({
        backupId: selectedBackup.id,
        targetPath: restorePath,
        options: {
          verify: true,
          conflictStrategy
        }
      });

      if (result.success) {
        const hashMismatches = result.verificationResults?.filter(v => !v.hashMatch && !v.failed && !v.skipped).length || 0;
        const failed = result.verificationResults?.filter(v => v.failed).length || 0;
        const skipped = result.verificationResults?.filter(v => v.skipped).length || 0;
        const totalFiles = result.verificationResults?.length || 0;
        
        // Determine if restore is truly successful
        const isSuccess = result.filesRestored > 0 || (failed === 0 && totalFiles > 0);
        
        if (!isSuccess) {
          // If no files were restored and there were failures, treat as error
          let errorMessage = `❌ Restore failed!\n\n`;
          errorMessage += `Files attempted: ${totalFiles}\n`;
          errorMessage += `Files restored: ${result.filesRestored}\n`;
          if (failed > 0) {
            errorMessage += `Files failed: ${failed}\n\n`;
            errorMessage += `This may be due to:\n`;
            errorMessage += `- Missing source files in backup\n`;
            errorMessage += `- Corrupted backup data\n`;
            errorMessage += `- Insufficient permissions\n`;
            errorMessage += `- Disk space issues`;
          }
          alert(errorMessage);
        } else {
          // Success case
          let message = `✅ Restore completed successfully!\n\nFiles restored: ${result.filesRestored}\nRestore location: ${restorePath}`;
          
          if (skipped > 0) {
            message += `\n\n⏭️ Skipped: ${skipped} files (already exist)`;
          }
          if (hashMismatches > 0) {
            message += `\n\n⚠️ Warning: ${hashMismatches} files had hash mismatches`;
          }
          if (failed > 0) {
            message += `\n\n❌ Warning: ${failed} files failed to restore`;
          }
          
          message += `\n\nNote: The backup remains available for future restores.`;
          
          alert(message);
        }
      } else {
        // Handle failure case
        alert(`❌ Restore failed: ${result.error || 'Unknown error occurred'}`);
      }
      
      // Always reset the dialog and state after showing feedback
      setShowRestoreDialog(false);
      setSelectedBackup(null);
      setRestorePath('');
      loadBackups(); // Refresh the backup list
    } catch (error) {
      console.error('Restore failed:', error);
      alert('❌ Restore failed: ' + error.message);
      // Also reset on error
      setShowRestoreDialog(false);
      setSelectedBackup(null);
      setRestorePath('');
    } finally {
      setRestoreInProgress(false);
      setProgress(null);
    }
  }, [selectedBackup, restorePath, conflictStrategy, loadBackups]);

  const handleVerifyBackup = useCallback(async (backup) => {
    setBackupToVerify(backup);
    setShowVerifyConfirm(true);
  }, []);

  const confirmVerifyBackup = useCallback(async () => {
    if (!backupToVerify) return;

    setShowVerifyConfirm(false);
    setVerifyInProgress(true);
    setVerificationResult(null);

    try {
      const result = await window.backupAPI.verify(backupToVerify.id);
      setVerificationResult(result);
      
      const virusScanSummary = result.virusScan ? 
        `\n\n🦠 Virus Scan:\n` +
        `Scanned: ${result.virusScan.scanned} files\n` +
        `Clean: ${result.virusScan.clean} files\n` +
        `Threats: ${result.virusScan.threats} threats\n` +
        (result.virusScan.skipped > 0 ? `Skipped: ${result.virusScan.skipped} files (scanning not available)\n` : '') +
        (result.virusScan.errors > 0 ? `Errors: ${result.virusScan.errors}\n` : '')
        : '';
      
      alert(
        `Verification Complete\n\n` +
        `Files checked: ${result.filesChecked}\n` +
        `Valid: ${result.filesValid}\n` +
        `Invalid: ${result.filesInvalid}\n` +
        `Missing: ${result.filesMissing}` +
        virusScanSummary
      );
    } catch (error) {
      console.error('Verification failed:', error);
      alert('Verification failed: ' + error.message);
    } finally {
      setVerifyInProgress(false);
      setBackupToVerify(null);
    }
  }, [backupToVerify]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const result = await window.backupAPI.openFolder();
      if (!result.success) {
        alert('Failed to open backup folder');
      }
    } catch (error) {
      console.error('Failed to open backup folder:', error);
      alert('Failed to open backup folder');
    }
  }, []);

  const handleDeleteBackup = useCallback(async (backup) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete this backup?\n\nName: ${backup.name}\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await window.backupAPI.delete(backup.id);
      alert('Backup deleted successfully');
      loadBackups();
    } catch (error) {
      console.error('Failed to delete backup:', error);
      alert('Failed to delete backup: ' + error.message);
    }
  }, [loadBackups]);

  // OPTION A: Complex token modal handler
  const handleGenerateToken = useCallback((backup) => {
    setTokenModalData({
      type: 'backup',
      resourceSelectionMode: 'database', // Set to database mode to use dropdown
      resourceId: backup.id.toString(), // Use the backup ID as string for dropdown
      resourceName: backup.name,
      ttl: 86400, // 24 hours default
      oneTimeUse: false,
      metadata: {
        backupId: backup.id,
        sourcePath: backup.source_path,
        fileCount: backup.file_count,
        size: backup.size,
        createdAt: backup.created_at,
        encrypted: backup.encrypted === 1
      }
    });
    setShowTokenModal(true);
  }, []);

  // OPTION B: Simplified recovery key handler (UNCOMMENT TO USE)
  const handleGenerateRecoveryKey = useCallback((backup) => {
    setSelectedBackupForKey(backup);
    setShowRecoveryKeyModal(true);
  }, []);

  const handleTokenGenerated = useCallback((result) => {
    // Success callback after token is generated
    console.log('Token generated successfully:', result.tokenId);
  }, []);

  const formatBytes = useCallback((bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }, []);

  const formatDate = useCallback((timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  }, []);

  // Handler for opening restore dialog
  const handleRestoreClick = useCallback((backup) => {
    setSelectedBackup(backup);
    setShowRestoreDialog(true);
  }, []);

  return (
    <div className="space-y-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <HardDrive className="w-8 h-8 text-blue-400" />
            Backup & Storage Manager
          </h1>
          <p className="text-gray-400 mt-2">Manage backups, deleted files, and find duplicates</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('backups')}
            className={`px-6 py-3 font-medium transition flex items-center gap-2 ${
              activeTab === 'backups'
                ? 'text-[#FFC300] border-b-2 border-[#FFC300]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <HardDrive className="w-5 h-5" />
            Backups
          </button>
          <button
            onClick={() => setActiveTab('deleted')}
            className={`px-6 py-3 font-medium transition flex items-center gap-2 ${
              activeTab === 'deleted'
                ? 'text-[#FFC300] border-b-2 border-[#FFC300]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Trash2 className="w-5 h-5" />
            Deleted Files
          </button>
          <button
            onClick={() => setActiveTab('duplicates')}
            className={`px-6 py-3 font-medium transition flex items-center gap-2 ${
              activeTab === 'duplicates'
                ? 'text-[#FFC300] border-b-2 border-[#FFC300]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Copy className="w-5 h-5" />
            Duplicate Files
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'backups' && (
          <>
            {/* Backup Tab Header Actions */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Backups</h2>
                <p className="text-gray-400 mt-1">Secure encrypted backups with incremental support</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleOpenFolder}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition flex items-center gap-2"
                  title="Open Backups Folder"
                >
                  <FolderOpen className="w-4 h-4" />
                  Open Folder
                </button>
                <button
                  onClick={loadBackups}
                  disabled={loading}
                  className="px-4 py-2 bg-[#003566] hover:bg-[#0077B6] text-white rounded-lg transition flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  onClick={() => setShowCreateDialog(true)}
                  disabled={backupInProgress}
                  className="px-6 py-2 bg-[#FFC300] hover:bg-[#FFD60A] text-[#001D3D] font-semibold rounded-lg transition flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  Create Backup
                </button>
              </div>
            </div>

        {/* Progress Display */}
        {progress && (
          <div className="mb-6 p-4 bg-[#003566] border-2 border-[#0077B6] rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[#FFC300]" />
              <span className="font-medium text-white">{progress.phase}</span>
            </div>
            {progress.currentFile && (
              <div className="text-sm text-slate-400">
                {progress.currentFile} ({progress.current}/{progress.total})
              </div>
            )}
            {progress.progress && (
              <div className="mt-2 w-full bg-[#001D3D] rounded-full h-2">
                <div
                  className="bg-[#FFC300] h-2 rounded-full transition-all"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Create Backup Dialog */}
        {showCreateDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-[#003566] border-2 border-[#0077B6] rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4 text-white">Create New Backup</h2>
              
              <div className="space-y-4">
                {/* Backup Name */}
                <div>
                  <label className="block text-sm font-medium mb-2 text-white">Backup Name</label>
                  <input
                    type="text"
                    value={backupName}
                    onChange={(e) => setBackupName(e.target.value)}
                    placeholder="My Documents Backup"
                    className="w-full px-4 py-2 bg-[#001D3D] border-2 border-[#0077B6] text-white rounded-lg focus:border-[#FFC300] focus:outline-none transition"
                  />
                </div>

                {/* Source Path */}
                <div>
                  <label className="block text-sm font-medium mb-2 text-white">Select Files or Folders</label>
                  <p className="text-xs text-gray-400 mb-2">Select individual files or entire folders to backup. You can add multiple items.</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sourcePath}
                      readOnly
                      placeholder="Click buttons to select files or folders..."
                      className="flex-1 px-4 py-2 bg-[#001D3D] border-2 border-[#0077B6] text-white rounded-lg cursor-not-allowed text-sm"
                    />
                    <button
                      onClick={handleSelectSourcePath}
                      className="px-3 py-2 bg-[#0077B6] hover:bg-[#00B4D8] text-white rounded-lg transition flex items-center gap-2 text-sm"
                      title="Select individual files"
                    >
                      <FileText className="w-4 h-4" />
                      Files
                    </button>
                    <button
                      onClick={handleSelectFolderPath}
                      className="px-3 py-2 bg-[#003566] hover:bg-[#0077B6] text-white rounded-lg transition flex items-center gap-2 text-sm"
                      title="Select folders"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Folders
                    </button>
                    {sourcePath && (
                      <button
                        onClick={() => setSourcePath('')}
                        className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition flex items-center gap-1 text-sm"
                        title="Clear selection"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {sourcePath && (
                    <div className="mt-2 p-2 bg-gray-700 rounded text-xs text-gray-300 max-h-20 overflow-y-auto">
                      <p className="font-medium text-white mb-1">Selected items ({sourcePath.split(';').length}):</p>
                      {sourcePath.split(';').map((p, i) => (
                        <div key={i} className="truncate">• {p}</div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Options */}
                <div className="space-y-3 p-4 bg-gray-700 rounded-lg">
                  <h3 className="font-medium mb-2">Backup Options</h3>
                  
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={encryptBackup}
                      onChange={(e) => setEncryptBackup(e.target.checked)}
                      className="w-5 h-5 mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4" />
                        <span>Encrypt backup (AES-256)</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Protects your backup with military-grade encryption. Recommended for sensitive data.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={compressBackup}
                      onChange={(e) => setCompressBackup(e.target.checked)}
                      className="w-5 h-5 mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        <span>Compress files (GZIP)</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Reduces backup size by 20-80%. Saves storage space with minimal performance impact.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={incrementalBackup}
                      onChange={(e) => setIncrementalBackup(e.target.checked)}
                      className="w-5 h-5 mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" />
                        <span>Incremental (only backup changed files)</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Much faster backups after the first one. Only backs up new or modified files.</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  disabled={backupInProgress}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateBackup}
                  disabled={backupInProgress || !backupName || !sourcePath}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition disabled:opacity-50"
                >
                  {backupInProgress ? 'Creating...' : 'Create Backup'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Restore Dialog */}
        {showRestoreDialog && selectedBackup && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4">
              <h2 className="text-2xl font-bold mb-4">Restore Backup</h2>
              
              <div className="space-y-4">
                <div className="p-4 bg-gray-700 rounded-lg">
                  <div className="text-sm text-gray-400">Backup Name</div>
                  <div className="font-medium">{selectedBackup.name}</div>
                  <div className="text-sm text-gray-400 mt-2">Created</div>
                  <div>{formatDate(selectedBackup.created_at)}</div>
                </div>

                {/* Restore Path */}
                <div>
                  <label className="block text-sm font-medium mb-2">Restore Location</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={restorePath}
                      readOnly
                      placeholder="Select directory to restore to"
                      className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg"
                    />
                    <button
                      onClick={handleSelectRestorePath}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition flex items-center gap-2"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Browse
                    </button>
                  </div>
                </div>

                {/* Conflict Strategy */}
                <div>
                  <label className="block text-sm font-medium mb-2">If file exists</label>
                  <select
                    value={conflictStrategy}
                    onChange={(e) => setConflictStrategy(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:border-blue-500 focus:outline-none"
                  >
                    <option value="rename">Rename restored file</option>
                    <option value="overwrite">Overwrite existing</option>
                    <option value="skip">Skip file</option>
                  </select>
                </div>

                {/* Information Notice */}
                <div className="p-4 bg-blue-900 bg-opacity-30 border border-blue-500 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-100">
                      <p className="font-medium mb-1">About Backup Restoration</p>
                      <p className="text-blue-200">
                        Restoring a backup does not delete or modify the backup itself. 
                        The backup remains available for future restores. This allows you to 
                        restore the same backup multiple times to different locations if needed.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowRestoreDialog(false);
                    setSelectedBackup(null);
                  }}
                  disabled={restoreInProgress}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRestoreBackup}
                  disabled={restoreInProgress || !restorePath}
                  className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg transition disabled:opacity-50"
                >
                  {restoreInProgress ? 'Restoring...' : 'Restore Backup'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Backups List */}
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
              Loading backups...
            </div>
          ) : backups.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <HardDrive className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No backups found</p>
              <p className="text-sm mt-2">Create your first backup to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {backups.map((backup) => (
                <BackupItem
                  key={backup.id}
                  backup={backup}
                  onRestore={handleRestoreClick}
                  onVerify={handleVerifyBackup}
                  onDelete={handleDeleteBackup}
                  onGenerateToken={handleGenerateToken}
                  formatBytes={formatBytes}
                  formatDate={formatDate}
                  verifyInProgress={verifyInProgress}
                />
              ))}
            </div>
          )}
        </div>

        {/* Verification Result */}
        {verificationResult && (
          <div className="mt-6 p-6 bg-gray-800 rounded-lg border border-blue-500">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <CheckCircle className="w-6 h-6 text-blue-400" />
              Verification Results
            </h3>
            <div className="grid grid-cols-4 gap-4 text-center mb-6">
              <div className="p-4 bg-gray-700 rounded-lg">
                <div className="text-2xl font-bold">{verificationResult.filesChecked}</div>
                <div className="text-sm text-gray-400">Checked</div>
              </div>
              <div className="p-4 bg-green-900 bg-opacity-30 rounded-lg">
                <div className="text-2xl font-bold text-green-400">{verificationResult.filesValid}</div>
                <div className="text-sm text-gray-400">Valid</div>
              </div>
              <div className="p-4 bg-red-900 bg-opacity-30 rounded-lg">
                <div className="text-2xl font-bold text-red-400">{verificationResult.filesInvalid}</div>
                <div className="text-sm text-gray-400">Invalid</div>
              </div>
              <div className="p-4 bg-yellow-900 bg-opacity-30 rounded-lg">
                <div className="text-2xl font-bold text-yellow-400">{verificationResult.filesMissing}</div>
                <div className="text-sm text-gray-400">Missing</div>
              </div>
            </div>

            {/* Virus Scan Results */}
            {verificationResult.virusScan && (
              <div className="p-4 bg-gray-750 rounded-lg border border-purple-500/50">
                <h4 className="text-lg font-semibold mb-3 flex items-center gap-2 text-purple-300">
                  🦠 Virus Scan Results
                </h4>
                <div className="grid grid-cols-5 gap-3 text-center text-sm">
                  <div className="p-3 bg-blue-900 bg-opacity-30 rounded">
                    <div className="text-xl font-bold text-blue-300">{verificationResult.virusScan.scanned || 0}</div>
                    <div className="text-xs text-gray-400">Scanned</div>
                  </div>
                  <div className="p-3 bg-green-900 bg-opacity-30 rounded">
                    <div className="text-xl font-bold text-green-400">{verificationResult.virusScan.clean || 0}</div>
                    <div className="text-xs text-gray-400">Clean</div>
                  </div>
                  <div className="p-3 bg-red-900 bg-opacity-30 rounded">
                    <div className="text-xl font-bold text-red-400">{verificationResult.virusScan.threats || 0}</div>
                    <div className="text-xs text-gray-400">Threats</div>
                  </div>
                  <div className="p-3 bg-yellow-900 bg-opacity-30 rounded">
                    <div className="text-xl font-bold text-yellow-400">{verificationResult.virusScan.errors || 0}</div>
                    <div className="text-xs text-gray-400">Errors</div>
                  </div>
                  <div className="p-3 bg-gray-700 bg-opacity-50 rounded">
                    <div className="text-xl font-bold text-gray-400">{verificationResult.virusScan.skipped || 0}</div>
                    <div className="text-xs text-gray-400">Skipped</div>
                  </div>
                </div>

                {/* Status message based on scan results */}
                <div className="mt-3">
                  {verificationResult.virusScan.scanned === 0 && verificationResult.virusScan.skipped > 0 ? (
                    <div className="p-3 bg-yellow-500/20 border border-yellow-500/50 rounded">
                      <p className="text-yellow-300 text-sm flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5" />
                        ⚠️ Virus scanning not available - Windows Defender not accessible
                      </p>
                    </div>
                  ) : verificationResult.virusScan.threats > 0 ? (
                    <div className="p-3 bg-red-500/20 border border-red-500/50 rounded">
                      <p className="text-red-300 font-semibold flex items-center gap-2">
                        <AlertCircle className="w-5 h-5" />
                        ❌ {verificationResult.virusScan.threats} threat(s) detected in backup files!
                      </p>
                      <p className="text-sm text-red-200 mt-1">
                        Review the threat details and take appropriate action.
                      </p>
                    </div>
                  ) : verificationResult.virusScan.scanned > 0 && verificationResult.virusScan.clean === verificationResult.virusScan.scanned ? (
                    <div className="p-3 bg-green-500/20 border border-green-500/50 rounded">
                      <p className="text-green-300 text-sm flex items-center gap-2">
                        <CheckCircle className="w-5 h-5" />
                        ✅ All scanned files are clean - no threats detected
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}
          </>
        )}

        {/* Deleted Files Tab */}
        {activeTab === 'deleted' && (
          <DeletedFilesManager />
        )}

        {/* Duplicate Files Tab */}
        {activeTab === 'duplicates' && (
          <DuplicateFilesManager />
        )}
      </div>
      
      {/* Verification Confirmation Modal */}
      {showVerifyConfirm && backupToVerify && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 max-w-md w-full">
            {/* Modal Header */}
            <div className="flex items-center gap-3 p-6 border-b border-gray-700">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <CheckCircle className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2"><Search className="w-5 h-5" /> Verify Backup</h3>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              <p className="text-gray-300">
                Do you want to verify the integrity of this backup?
              </p>
              
              <div className="bg-gray-700/50 rounded-lg p-3">
                <p className="text-sm font-medium text-white mb-1">{backupToVerify.name}</p>
                <p className="text-xs text-gray-400">{formatBytes(backupToVerify.size)} • {backupToVerify.file_count} files</p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-sm text-blue-200 font-medium mb-2">This will check:</p>
                <ul className="text-sm text-blue-100 space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="text-blue-400">•</span> File integrity (SHA-256 hashes)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-blue-400">•</span> Missing files
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-blue-400">•</span> Virus scan (if available)
                  </li>
                </ul>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex gap-3 p-6 border-t border-gray-700">
              <button
                onClick={() => {
                  setShowVerifyConfirm(false);
                  setBackupToVerify(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmVerifyBackup}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Verify Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OPTION B: Simplified Recovery Key Modal */}
      {showRecoveryKeyModal && selectedBackupForKey && (
        <BackupRecoveryKeyModal
          isOpen={showRecoveryKeyModal}
          onClose={() => {
            setShowRecoveryKeyModal(false);
            setSelectedBackupForKey(null);
          }}
          backup={selectedBackupForKey}
          onSuccess={(result) => {
            console.log('Recovery key generated:', result.tokenId);
          }}
        />
      )}
      
      {/* Token Configuration Modal */}
      <TokenConfigModal
        isOpen={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        initialData={tokenModalData}
        onSuccess={handleTokenGenerated}
      />
    </div>
  );
}
