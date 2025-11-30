import { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, RefreshCw, RotateCcw, XCircle, Search, Filter, Calendar, FileText, Image, Film, Music, Archive, Package, Folder, AlertCircle, Eye } from 'lucide-react';

/**
 * DeletedFilesManager - UI component for viewing and restoring deleted files
 * Features:
 * - View all deleted files with filtering
 * - Restore files to original or custom location
 * - Permanently delete files
 * - Search by filename
 * - Filter by date and type
 * - Empty trash functionality
 */
export default function DeletedFilesManager() {
  const [deletedFiles, setDeletedFiles] = useState([]);
  const [displayedFiles, setDisplayedFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [statistics, setStatistics] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20); // Show 20 items per page
  const [restoringFiles, setRestoringFiles] = useState(new Set()); // Track files being restored
  const restoredRecycleBinPaths = useRef(new Set()); // Track restored Recycle Bin files to hide them

  useEffect(() => {
    loadDeletedFiles();
    loadStatistics();
  }, []);

  // Apply pagination
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setDisplayedFiles(deletedFiles.slice(startIndex, endIndex));
  }, [deletedFiles, currentPage, itemsPerPage]);

  const loadDeletedFiles = useCallback(async (filters = {}) => {
    setLoading(true);
    try {
      const result = await window.deletedFilesAPI.list(filters);
      // Filter out Recycle Bin files that were already restored in this session
      const filteredResult = (result || []).filter(file => {
        if (file.source === 'recycle-bin' && file.recycleBinPath) {
          return !restoredRecycleBinPaths.current.has(file.recycleBinPath);
        }
        return true;
      });
      setDeletedFiles(filteredResult);
    } catch (error) {
      console.error('Failed to load deleted files:', error);
      alert('Failed to load deleted files: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatistics = useCallback(async () => {
    try {
      const stats = await window.deletedFilesAPI.getStats();
      setStatistics(stats);
    } catch (error) {
      console.error('Failed to load statistics:', error);
    }
  }, []);

  // Open file directly (for viewing deleted files before restore)
  const handleOpenFile = useCallback(async (file) => {
    const filePath = file.recycleBinPath || file.trash_path;
    if (!filePath) {
      alert('Cannot open this file - path not available');
      return;
    }
    try {
      await window.electronAPI.system.openFile(filePath);
    } catch (error) {
      console.error('Failed to open file:', error);
      alert('Failed to open file: ' + error.message);
    }
  }, []);

  const handleSearch = useCallback(() => {
    setCurrentPage(1); // Reset to first page
    const filters = {};
    
    if (searchTerm) {
      filters.searchTerm = searchTerm;
    }
    
    if (selectedType !== 'all') {
      filters.fileType = selectedType;
    }
    
    if (dateRange !== 'all') {
      const now = Date.now();
      const ranges = {
        today: now - 86400000,
        week: now - 604800000,
        month: now - 2592000000
      };
      filters.startDate = ranges[dateRange];
    }
    
    loadDeletedFiles(filters);
  }, [searchTerm, selectedType, dateRange, loadDeletedFiles]);

  const totalPages = Math.ceil(deletedFiles.length / itemsPerPage);

  const handleRestore = useCallback(async (file) => {
    const fileName = file.file_name || file.fileName;
    const isRecycleBin = file.source === 'recycle-bin';
    const fileId = file.id || `recycle-${file.recycleBinPath}`;
    
    const confirmed = window.confirm(
      `Restore "${fileName}"?\n\nThe file will be restored to its original location.\nIf a file already exists there, it will be renamed automatically.`
    );

    if (!confirmed) return;

    // Mark file as being restored (for UI feedback)
    setRestoringFiles(prev => new Set([...prev, fileId]));

    try {
      let result;
      if (isRecycleBin) {
        // For Recycle Bin files, pass the necessary paths
        result = await window.deletedFilesAPI.restore(null, {
          recycleBinPath: file.recycleBinPath,
          originalPath: file.originalPath
        });
      } else {
        // For internal trash files
        result = await window.deletedFilesAPI.restore(file.id);
      }
      
      if (result.success) {
        // Track restored Recycle Bin files to prevent them from reappearing
        if (isRecycleBin && file.recycleBinPath) {
          restoredRecycleBinPaths.current.add(file.recycleBinPath);
        }
        
        // Optimistic UI update - immediately remove the file from the list
        setDeletedFiles(prev => prev.filter(f => {
          const fId = f.id || `recycle-${f.recycleBinPath}`;
          return fId !== fileId;
        }));
        
        // Show success message
        alert(`✅ File restored successfully!\n\nRestored to: ${result.restoredPath}`);
        
        // Refresh statistics (but not the file list to avoid re-adding the file)
        loadStatistics();
      } else {
        alert(`Failed to restore file: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to restore file:', error);
      alert('Failed to restore file: ' + error.message);
    } finally {
      // Remove from restoring state
      setRestoringFiles(prev => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  }, [loadStatistics]);

  const handlePermanentDelete = useCallback(async (file) => {
    const fileName = file.file_name || file.fileName;
    const isRecycleBin = file.source === 'recycle-bin';
    
    const confirmed = window.confirm(
      `⚠️ PERMANENTLY DELETE "${fileName}"?\n\nThis action CANNOT be undone!${isRecycleBin ? '\n\nThis will delete the file from Windows Recycle Bin.' : ''}`
    );

    if (!confirmed) return;

    try {
      let result;
      if (isRecycleBin) {
        // For Recycle Bin files, pass the recycleBinPath in options
        result = await window.deletedFilesAPI.permanentlyDelete(null, {
          recycleBinPath: file.recycleBinPath
        });
      } else {
        // For internal trash files
        result = await window.deletedFilesAPI.permanentlyDelete(file.id);
      }
      
      if (result.success) {
        alert('File permanently deleted');
        loadDeletedFiles();
        loadStatistics();
      } else {
        alert(`Failed to delete file: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      alert('Failed to delete file: ' + error.message);
    }
  }, [loadDeletedFiles, loadStatistics]);

  const handleEmptyTrash = useCallback(async () => {
    const recycleBinCount = deletedFiles.filter(f => f.source === 'recycle-bin').length;
    const internalCount = deletedFiles.filter(f => f.source === 'internal-trash').length;
    
    const confirmed = window.confirm(
      `⚠️ EMPTY ALL TRASH?\n\n` +
      `This will PERMANENTLY DELETE:\n` +
      `• ${internalCount} file(s) from internal trash\n` +
      `• ${recycleBinCount} file(s) from Windows Recycle Bin\n\n` +
      `Total: ${deletedFiles.length} files\n\n` +
      `This action CANNOT be undone!`
    );

    if (!confirmed) return;

    try {
      const result = await window.deletedFilesAPI.emptyTrash();
      if (result.success) {
        alert(`Trash emptied successfully!\n\n${result.message || `${result.deletedCount} files permanently deleted.`}`);
        loadDeletedFiles();
        loadStatistics();
      } else {
        alert(`Failed to empty trash: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to empty trash:', error);
      alert('Failed to empty trash: ' + error.message);
    }
  }, [deletedFiles, loadDeletedFiles, loadStatistics]);

  const handleBulkRestore = useCallback(async () => {
    if (selectedFiles.size === 0) {
      alert('Please select files to restore');
      return;
    }

    const confirmed = window.confirm(
      `Restore ${selectedFiles.size} selected files?`
    );

    if (!confirmed) return;

    let restored = 0;
    let failed = 0;
    const restoredIds = [];

    // Get the actual file objects for selected IDs
    const filesToRestore = deletedFiles.filter(f => selectedFiles.has(f.id));

    for (const file of filesToRestore) {
      try {
        const result = await window.deletedFilesAPI.restore(file.id);
        if (result.success) {
          restored++;
          restoredIds.push(file.id);
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
        console.error(`Failed to restore file ${file.id}:`, error);
      }
    }

    // Optimistic UI update - remove restored files from list
    if (restoredIds.length > 0) {
      setDeletedFiles(prev => prev.filter(f => !restoredIds.includes(f.id)));
    }

    alert(`Restoration complete!\n\n✅ Restored: ${restored}\n❌ Failed: ${failed}`);
    setSelectedFiles(new Set());
    loadStatistics();
  }, [selectedFiles, deletedFiles, loadStatistics]);

  const toggleFileSelection = useCallback((fileId) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  }, []);

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getFileIcon = (type, isDirectory) => {
    if (isDirectory) return <Folder className="w-5 h-5 text-yellow-400" />;
    
    switch (type) {
      case 'document': return <FileText className="w-5 h-5 text-blue-400" />;
      case 'image': return <Image className="w-5 h-5 text-green-400" />;
      case 'video': return <Film className="w-5 h-5 text-purple-400" />;
      case 'audio': return <Music className="w-5 h-5 text-pink-400" />;
      case 'archive': return <Archive className="w-5 h-5 text-orange-400" />;
      case 'application': return <Package className="w-5 h-5 text-red-400" />;
      case 'folder': return <Folder className="w-5 h-5 text-yellow-400" />;
      default: return <FileText className="w-5 h-5 text-gray-400" />;
    }
  };

  const getFileTypeLabel = (type) => {
    const labels = {
      'document': 'Document',
      'image': 'Image',
      'video': 'Video',
      'audio': 'Audio',
      'archive': 'Archive',
      'application': 'Application',
      'folder': 'Folder',
      'other': 'File'
    };
    return labels[type] || 'File';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-3 text-white">
            <Trash2 className="w-7 h-7 text-red-400" />
            Deleted Files
          </h2>
          <p className="text-gray-400 mt-1">View and restore deleted files</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              loadDeletedFiles();
              loadStatistics();
            }}
            disabled={loading}
            className="px-4 py-2 bg-[#003566] hover:bg-[#0077B6] text-white rounded-lg transition flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {deletedFiles.length > 0 && (
            <button
              onClick={handleEmptyTrash}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition flex items-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              Empty Trash
            </button>
          )}
        </div>
      </div>

      {/* Statistics */}
      {statistics && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold text-white">{statistics.totalCount}</div>
            <div className="text-sm text-gray-400">Total Files</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold text-blue-400">{formatBytes(statistics.totalSize)}</div>
            <div className="text-sm text-gray-400">Total Size</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold text-green-400">
              {Object.keys(statistics.byType).length}
            </div>
            <div className="text-sm text-gray-400">File Types</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold text-purple-400">
              {statistics.folders || statistics.byType.folder?.count || 0}
            </div>
            <div className="text-sm text-gray-400">Folders</div>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-gray-800 p-4 rounded-lg space-y-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search by filename..."
              className="w-full pl-10 pr-4 py-2 bg-[#001D3D] border-2 border-[#0077B6] text-white rounded-lg focus:border-[#FFC300] focus:outline-none"
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-6 py-2 bg-[#FFC300] hover:bg-[#FFD60A] text-[#001D3D] font-semibold rounded-lg transition"
          >
            Search
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="px-4 py-2 bg-[#003566] hover:bg-[#0077B6] text-white rounded-lg transition flex items-center gap-2"
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>

        {showFilters && (
          <div className="flex gap-4 pt-4 border-t border-gray-700">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2 text-white">File Type</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-4 py-2 bg-[#001D3D] border-2 border-[#0077B6] text-white rounded-lg focus:border-[#FFC300] focus:outline-none"
              >
                <option value="all">All Types</option>
                <option value="document">Documents</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
                <option value="audio">Audio</option>
                <option value="archive">Archives</option>
                <option value="application">Applications</option>
                <option value="folder">Folders</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2 text-white">Date Range</label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="w-full px-4 py-2 bg-[#001D3D] border-2 border-[#0077B6] text-white rounded-lg focus:border-[#FFC300] focus:outline-none"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Actions */}
      {selectedFiles.size > 0 && (
        <div className="bg-blue-900 bg-opacity-30 border border-blue-500 p-4 rounded-lg flex items-center justify-between">
          <div className="text-white">
            <span className="font-semibold">{selectedFiles.size}</span> files selected
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleBulkRestore}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Restore Selected
            </button>
            <button
              onClick={() => setSelectedFiles(new Set())}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition"
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Files List */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
            Loading deleted files...
          </div>
        ) : deletedFiles.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Trash2 className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-semibold text-white mb-2">No Deleted Files Found</h3>
            <p className="text-gray-400 mb-4">
              {searchTerm || selectedType !== 'all' || dateRange !== 'all' 
                ? 'No files match your current filters. Try adjusting the filters above.' 
                : 'Your trash is empty or the Recycle Bin is empty.'}
            </p>
            <div className="bg-blue-900 bg-opacity-30 border border-blue-500 rounded-lg p-4 max-w-md mx-auto text-left">
              <p className="text-blue-200 text-sm mb-2">
                <strong>📁 Data Sources:</strong>
              </p>
              <ul className="text-blue-200 text-sm space-y-1 list-disc list-inside">
                <li>Windows Recycle Bin (all drives)</li>
                <li>FortiMorph internal trash</li>
              </ul>
              {(searchTerm || selectedType !== 'all' || dateRange !== 'all') && (
                <p className="text-yellow-300 text-sm mt-3">
                  💡 <strong>Tip:</strong> Clear filters to see all deleted files
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-700">
              {displayedFiles.map((file) => {
                const fileId = file.id || `recycle-${file.recycleBinPath}`;
                const fileName = file.file_name || file.fileName;
                const fileSize = file.size;
                const deletedAt = file.deleted_at || file.deletedAt;
                const fileType = file.file_type || file.type;
                const isDirectory = file.is_directory === 1 || file.isDirectory;
                const isRecycleBin = file.source === 'recycle-bin';
                
                return (
              <div key={fileId} className="p-4 hover:bg-gray-750 transition flex items-center gap-4">
                {!isRecycleBin && (
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.id)}
                    onChange={() => toggleFileSelection(file.id)}
                    className="w-5 h-5 cursor-pointer"
                  />
                )}
                
                {getFileIcon(fileType, isDirectory)}
                
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white truncate flex items-center gap-2">
                    {fileName || 'Unknown File'}
                  </div>
                  <div className="text-sm text-gray-400 truncate" title={file.original_path || file.originalPath}>
                    {file.original_path || file.originalPath || 'Path unknown'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(deletedAt)}
                    </span>
                    <span>{formatBytes(fileSize || 0)}</span>
                    <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                      {getFileTypeLabel(fileType)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {/* Open button to view file */}
                  <button
                    onClick={() => handleOpenFile(file)}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition flex items-center gap-2 text-sm"
                    title="Open file"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleRestore(file)}
                    disabled={restoringFiles.has(fileId)}
                    className={`px-4 py-2 rounded-lg transition flex items-center gap-2 text-sm ${
                      restoringFiles.has(fileId) 
                        ? 'bg-green-800 cursor-not-allowed opacity-70' 
                        : 'bg-green-600 hover:bg-green-500'
                    }`}
                    title="Restore file"
                  >
                    {restoringFiles.has(fileId) ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Restoring...
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-4 h-4" />
                        Restore
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handlePermanentDelete(file)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg transition flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Permanently delete"
                    disabled={restoringFiles.has(fileId)}
                  >
                    <XCircle className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-4 border-t border-gray-700 flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, deletedFiles.length)} of {deletedFiles.length} files
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 bg-[#003566] hover:bg-[#0077B6] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">Page {currentPage} of {totalPages}</span>
                  </div>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 bg-[#003566] hover:bg-[#0077B6] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
