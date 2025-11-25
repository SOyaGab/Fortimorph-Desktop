import React, { useState, useEffect } from 'react';
import { Trash2, FolderOpen, RotateCcw, Trash, Clock, XCircle } from 'lucide-react';

const QuarantinePanel = () => {
  const [quarantinedFiles, setQuarantinedFiles] = useState([]);
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalSize: 0,
    restoredFiles: 0,
    purgedFiles: 0,
    queuedFiles: 0
  });
  const [retryQueue, setRetryQueue] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [conflictMode, setConflictMode] = useState('rename');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [quarantineReason, setQuarantineReason] = useState('');

  useEffect(() => {
    loadQuarantinedFiles();
    loadStats();
    loadRetryQueue();

    const interval = setInterval(() => {
      loadQuarantinedFiles();
      loadStats();
      loadRetryQueue();
    }, 30000);

    return () => clearInterval(interval);
  }, [searchTerm]);

  const loadQuarantinedFiles = async () => {
    try {
      const filters = { searchTerm };
      const files = await window.quarantineAPI.getQuarantinedFiles(filters);
      setQuarantinedFiles(files);
    } catch (error) {
      console.error('Failed to load quarantined files:', error);
      setError('Failed to load quarantined files');
    }
  };

  const loadStats = async () => {
    try {
      const newStats = await window.quarantineAPI.getStats();
      setStats(newStats);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadRetryQueue = async () => {
    try {
      const queue = await window.quarantineAPI.getRetryQueue();
      setRetryQueue(queue);
    } catch (error) {
      console.error('Failed to load retry queue:', error);
    }
  };

  const handleQuarantineFile = async () => {
    if (!selectedFilePath.trim()) {
      setError('Please enter a file path');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.quarantineAPI.quarantineFile(
        selectedFilePath,
        quarantineReason || 'Manual quarantine'
      );
      
      if (result.success) {
        setSelectedFilePath('');
        setQuarantineReason('');
        setShowFilePicker(false);
        await loadQuarantinedFiles();
        await loadStats();
      } else if (result.queued) {
        setError('File is locked and added to retry queue');
      } else {
        setError(result.message || 'Failed to quarantine file');
      }
    } catch (error) {
      console.error('Failed to quarantine file:', error);
      setError(error.message || 'Failed to quarantine file');
    } finally {
      setLoading(false);
    }
  };

  const handleBrowseFile = async () => {
    try {
      // Use Electron's dialog to select file
      const result = await window.electronAPI.showOpenDialog({
        properties: ['openFile'],
        title: 'Select File to Quarantine'
      });
      
      if (result && !result.canceled && result.filePaths.length > 0) {
        setSelectedFilePath(result.filePaths[0]);
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
      setError('Failed to open file browser');
    }
  };

  const handleOpenFolder = async () => {
    try {
      const result = await window.quarantineAPI.openFolder();
      if (!result.success) {
        setError('Failed to open quarantine folder');
      }
    } catch (error) {
      console.error('Failed to open quarantine folder:', error);
      setError('Failed to open quarantine folder');
    }
  };

  const handleRestoreFile = async (fileId) => {
    setLoading(true);
    setError(null);
    
    // Find the file name for the loading message
    const file = quarantinedFiles.find(f => f.id === fileId);
    const fileName = file?.original_name || `File ID ${fileId}`;
    setLoadingMessage(`Restoring ${fileName}...`);

    try {
      console.log('Starting restore for file ID:', fileId);
      
      // Create a timeout promise (35 seconds - slightly longer than backend)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Restore operation timed out after 35 seconds. The file may be corrupted or the disk may be slow.'));
        }, 35000);
      });
      
      // Race between the actual restore and the timeout
      const restorePromise = window.quarantineAPI.restoreFile(fileId, null, conflictMode);
      const result = await Promise.race([restorePromise, timeoutPromise]);
      
      console.log('Restore result:', result);
      
      if (result && result.success) {
        setError(null);
        alert(`✅ File restored successfully!\n\nRestored to: ${result.restoredPath || result.originalPath}`);
        await loadQuarantinedFiles();
        await loadStats();
        setSelectedFiles(new Set());
      } else if (result && result.skipped) {
        setError('File already exists and was skipped');
        alert('⚠️ File already exists and was skipped');
      } else {
        const errorMsg = result?.error || 'Failed to restore file';
        setError(errorMsg);
        alert(`❌ Failed to restore file:\n\n${errorMsg}`);
      }
    } catch (error) {
      console.error('Failed to restore file:', error);
      const errorMsg = error.message || 'Failed to restore file';
      setError(errorMsg);
      
      if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
        alert(`⏱️ Restore operation timed out\n\n${errorMsg}\n\nTry again or check if the file is corrupted.`);
      } else {
        alert(`❌ Error restoring file:\n\n${errorMsg}`);
      }
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const handlePurgeFile = async (fileId) => {
    setConfirmAction({
      type: 'purge',
      fileId,
      message: 'Are you sure you want to permanently delete this file? This action cannot be undone.'
    });
    setShowConfirmDialog(true);
  };

  const handleBulkRestore = async () => {
    if (selectedFiles.size === 0) return;

    setLoading(true);
    setError(null);
    let successCount = 0;
    let failCount = 0;
    const failedFiles = [];
    const totalFiles = selectedFiles.size;

    try {
      let currentFile = 0;
      for (const fileId of selectedFiles) {
        currentFile++;
        const file = quarantinedFiles.find(f => f.id === fileId);
        const fileName = file?.original_name || `File ${currentFile}`;
        setLoadingMessage(`Restoring ${currentFile}/${totalFiles}: ${fileName}...`);
        
        try {
          // Add timeout for each individual restore
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('Restore timeout'));
            }, 35000);
          });
          
          const restorePromise = window.quarantineAPI.restoreFile(fileId, null, conflictMode);
          const result = await Promise.race([restorePromise, timeoutPromise]);
          
          if (result && result.success) {
            successCount++;
          } else {
            failCount++;
            failedFiles.push({ fileId, error: result?.error || 'Unknown error' });
          }
        } catch (error) {
          failCount++;
          failedFiles.push({ fileId, error: error.message });
          console.error(`Failed to restore file ${fileId}:`, error);
        }
      }

      await loadQuarantinedFiles();
      await loadStats();
      setSelectedFiles(new Set());

      let message = `✅ Bulk restore completed!\n\nSuccessfully restored: ${successCount}\nFailed: ${failCount}`;
      
      if (failedFiles.length > 0 && failedFiles.length <= 3) {
        message += '\n\nFailed files:\n' + failedFiles.map(f => `- File ID ${f.fileId}: ${f.error}`).join('\n');
      }
      
      alert(message);
      
      if (failCount > 0) {
        setError(`Restored ${successCount} files, ${failCount} failed`);
      }
    } catch (error) {
      console.error('Bulk restore failed:', error);
      setError('Bulk restore operation failed');
      alert(`❌ Bulk restore failed:\n\n${error.message}`);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const handleBulkPurge = async () => {
    if (selectedFiles.size === 0) return;

    setConfirmAction({
      type: 'bulkPurge',
      message: `Are you sure you want to permanently delete ${selectedFiles.size} file(s)? This action cannot be undone.`,
      requireDoubleConfirm: true
    });
    setShowConfirmDialog(true);
  };

  const executeConfirmAction = async () => {
    setShowConfirmDialog(false);
    setLoading(true);
    setError(null);

    try {
      if (confirmAction.type === 'purge') {
        await window.quarantineAPI.purgeFile(confirmAction.fileId);
        await loadQuarantinedFiles();
        await loadStats();
      } else if (confirmAction.type === 'bulkPurge') {
        let successCount = 0;
        let failCount = 0;

        for (const fileId of selectedFiles) {
          try {
            await window.quarantineAPI.purgeFile(fileId);
            successCount++;
          } catch (error) {
            failCount++;
            console.error(`Failed to purge file ${fileId}:`, error);
          }
        }

        await loadQuarantinedFiles();
        await loadStats();
        setSelectedFiles(new Set());

        if (failCount > 0) {
          setError(`Purged ${successCount} files, ${failCount} failed`);
        }
      }
    } catch (error) {
      console.error('Action failed:', error);
      setError(error.message || 'Operation failed');
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  const toggleFileSelection = (fileId) => {
    const newSelection = new Set(selectedFiles);
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId);
    } else {
      newSelection.add(fileId);
    }
    setSelectedFiles(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedFiles.size === quarantinedFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(quarantinedFiles.map(f => f.id)));
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  return (
    <div className="space-y-6 relative">
      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#003566] rounded-lg p-8 border-2 border-[#0077B6] shadow-2xl">
            <div className="flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-[#FFC300] border-t-transparent"></div>
              <div className="text-white text-lg font-semibold">
                {loadingMessage || 'Processing...'}
              </div>
              <div className="text-slate-400 text-sm text-center max-w-md">
                {loadingMessage 
                  ? 'Decrypting and verifying file integrity...'
                  : 'Please wait...'}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Trash2 className="w-7 h-7 text-red-400" />
            Quarantine Manager
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Securely isolate and manage suspicious or unwanted files
          </p>
        </div>
        <button
          onClick={() => setShowFilePicker(!showFilePicker)}
          disabled={loading}
          className="px-4 py-2 bg-[#FFC300] hover:bg-[#FFD700] disabled:bg-slate-600 disabled:cursor-not-allowed text-[#001D3D] rounded-lg font-semibold transition-all duration-300 transform hover:scale-105"
        >
          + Quarantine File
        </button>
      </div>

      {/* File Picker Section */}
      {showFilePicker && (
        <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6]">
          <h3 className="text-lg font-semibold text-white mb-4">Select File to Quarantine</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-slate-300 text-sm mb-2">File Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={selectedFilePath}
                  onChange={(e) => setSelectedFilePath(e.target.value)}
                  placeholder="Enter file path or browse..."
                  className="flex-1 px-4 py-2 bg-[#001D3D] border border-[#0077B6] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#FFC300]"
                />
                <button
                  onClick={handleBrowseFile}
                  className="px-4 py-2 bg-[#0077B6] hover:bg-[#00A8E8] text-white rounded-lg transition-colors"
                >
                  Browse
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-300 text-sm mb-2">Reason (Optional)</label>
              <input
                type="text"
                value={quarantineReason}
                onChange={(e) => setQuarantineReason(e.target.value)}
                placeholder="Why are you quarantining this file?"
                className="w-full px-4 py-2 bg-[#001D3D] border border-[#0077B6] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#FFC300]"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowFilePicker(false);
                  setSelectedFilePath('');
                  setQuarantineReason('');
                }}
                className="px-4 py-2 bg-[#001D3D] hover:bg-[#003566] text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleQuarantineFile}
                disabled={!selectedFilePath.trim() || loading}
                className="px-4 py-2 bg-[#FFC300] hover:bg-[#FFD700] disabled:bg-slate-600 disabled:cursor-not-allowed text-[#001D3D] font-semibold rounded-lg transition-colors"
              >
                {loading ? 'Quarantining...' : 'Quarantine File'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-[#003566] rounded-lg p-4 border-2 border-[#0077B6]">
          <div className="text-slate-400 text-sm mb-1">Total Files</div>
          <div className="text-2xl font-bold text-white">{stats.totalFiles}</div>
        </div>
        <div className="bg-[#003566] rounded-lg p-4 border-2 border-[#0077B6]">
          <div className="text-slate-400 text-sm mb-1">Total Size</div>
          <div className="text-2xl font-bold text-white">{formatSize(stats.totalSize)}</div>
        </div>
        <div className="bg-[#003566] rounded-lg p-4 border-2 border-[#0077B6]">
          <div className="text-slate-400 text-sm mb-1">Restored</div>
          <div className="text-2xl font-bold text-green-400">{stats.restoredFiles}</div>
        </div>
        <div className="bg-[#003566] rounded-lg p-4 border-2 border-[#0077B6]">
          <div className="text-slate-400 text-sm mb-1">Purged</div>
          <div className="text-2xl font-bold text-red-400">{stats.purgedFiles}</div>
        </div>
        <div className="bg-[#003566] rounded-lg p-4 border-2 border-[#0077B6]">
          <div className="text-slate-400 text-sm mb-1">Retry Queue</div>
          <div className="text-2xl font-bold text-yellow-400">{stats.queuedFiles}</div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500 rounded-lg p-4 flex items-center justify-between">
          <span className="text-red-300">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6]">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          {/* Search */}
          <div className="flex-1">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search quarantined files..."
              className="w-full px-4 py-2 bg-[#001D3D] border border-[#0077B6] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#FFC300]"
            />
          </div>

          {/* Conflict Mode */}
          <div className="flex items-center gap-2">
            <label className="text-slate-300 text-sm">On Conflict:</label>
            <select
              value={conflictMode}
              onChange={(e) => setConflictMode(e.target.value)}
              className="px-3 py-2 bg-[#001D3D] border border-[#0077B6] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#FFC300]"
            >
              <option value="rename">Rename</option>
              <option value="overwrite">Overwrite</option>
              <option value="skip">Skip</option>
            </select>
          </div>

          {/* Bulk Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleOpenFolder}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
              title="Open Quarantine Folder"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Open Folder</span>
            </button>
            <button
              onClick={handleBulkRestore}
              disabled={selectedFiles.size === 0 || loading}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Restore ({selectedFiles.size})</span>
            </button>
            <button
              onClick={handleBulkPurge}
              disabled={selectedFiles.size === 0 || loading}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Purge ({selectedFiles.size})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Retry Queue Alert */}
      {retryQueue.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <Clock className="w-7 h-7 text-yellow-400" />
            <div>
              <div className="text-yellow-300 font-semibold">Retry Queue Active</div>
              <div className="text-yellow-400 text-sm">
                {retryQueue.length} locked file(s) waiting for retry
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            {retryQueue.map((item, index) => (
              <div key={index} className="text-sm text-yellow-300 pl-10">
                • {item.filePath} (Attempt {item.retryCount + 1}/5)
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files Table */}
      <div className="bg-[#003566] rounded-lg border-2 border-[#0077B6] overflow-hidden">
        {loading && (
          <div className="absolute inset-0 bg-[#001D3D]/50 flex items-center justify-center z-10">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FFC300]"></div>
          </div>
        )}

        {quarantinedFiles.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mb-4">
              <FolderOpen className="w-16 h-16 mx-auto text-slate-400" />
            </div>
            <div className="text-slate-400 text-lg">No quarantined files</div>
            <div className="text-slate-500 text-sm mt-2">
              Files moved to quarantine will appear here
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#001D3D]">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedFiles.size === quarantinedFiles.length && quarantinedFiles.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-slate-300 font-semibold">File Name</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-semibold">Original Path</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-semibold">Size</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-semibold">Quarantined</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-semibold">Reason</th>
                  <th className="px-4 py-3 text-right text-slate-300 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0077B6]">
                {quarantinedFiles.map((file) => (
                  <tr
                    key={file.id}
                    className="hover:bg-[#001D3D]/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file.id)}
                        onChange={() => toggleFileSelection(file.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-white font-medium">{file.originalName}</div>
                      <div className="text-slate-400 text-xs font-mono">{file.hash.substring(0, 16)}...</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-sm max-w-xs truncate" title={file.originalPath}>
                      {file.originalPath}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{formatSize(file.size)}</td>
                    <td className="px-4 py-3 text-slate-300 text-sm">
                      {formatDate(file.quarantinedAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-sm">{file.reason}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleRestoreFile(file.id)}
                          disabled={loading}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded text-sm transition-colors"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => handlePurgeFile(file.id)}
                          disabled={loading}
                          className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 text-white rounded text-sm transition-colors"
                        >
                          Purge
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#003566] rounded-lg p-6 max-w-md border-2 border-[#0077B6]">
            <h3 className="text-xl font-bold text-white mb-4">Confirm Action</h3>
            <p className="text-slate-300 mb-6">{confirmAction?.message}</p>
            {confirmAction?.requireDoubleConfirm && (
              <div className="bg-red-500/10 border border-red-500 rounded p-3 mb-4">
                <p className="text-red-300 text-sm font-semibold">⚠️ WARNING: This action is permanent!</p>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowConfirmDialog(false);
                  setConfirmAction(null);
                }}
                className="px-4 py-2 bg-[#001D3D] hover:bg-[#003566] text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeConfirmAction}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuarantinePanel;
