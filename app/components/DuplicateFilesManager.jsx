import { useState, useCallback } from 'react';
import { Copy, Search, Trash2, Eye, FolderOpen, RefreshCw, AlertTriangle, HardDrive, FileText, Image, Film, Music, Archive, Package, Clock, Lightbulb } from 'lucide-react';

/**
 * DuplicateFilesManager - UI component for finding and managing duplicate files
 * Features:
 * - Scan directories for duplicate files
 * - View duplicate groups with file details
 * - Delete duplicates (keeping one copy)
 * - Preview files before deletion
 * - Calculate space savings
 * - Filter by file type
 */
export default function DuplicateFilesManager() {
  const [scanResults, setScanResults] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [minFileSize, setMinFileSize] = useState(1); // Default 1KB - scan files from 1KB to 500MB+
  const [maxFileSize, setMaxFileSize] = useState(500); // Default 500MB max
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [selectedToKeep, setSelectedToKeep] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10); // Show 10 groups per page

  // Don't auto-scan - let user click to scan

  const handleStartScan = useCallback(async () => {
    // Auto-select common directories
    const userHome = await window.electron.invoke('system:getUserHome');
    const commonDirs = [
      `${userHome}\\Documents`,
      `${userHome}\\Downloads`,
      `${userHome}\\Pictures`,
      `${userHome}\\Desktop`,
      `${userHome}\\Videos`,
      `${userHome}\\Music`
    ].filter(dir => dir); // Filter out any undefined paths

    setScanning(true);
    setProgress({ phase: 'init', message: 'Preparing scan...', progress: 0 });
    setCurrentPage(1);

    try {
      const options = {
        minFileSize: minFileSize * 1024, // Convert KB to bytes
        maxFileSize: maxFileSize * 1024 * 1024, // Convert MB to bytes
        fileTypes: filterType === 'all' ? null : [filterType]
      };

      console.log('Starting duplicate scan with options:', options);

      const result = await window.duplicateFilesAPI.scan(commonDirs, options);
      
      if (result && result.stats) {
        setScanResults(result);
        console.log('Scan complete:', result.stats);
        
        if (result.duplicateGroups && result.duplicateGroups.length > 0) {
          alert(
            `Scan Complete!\n\n` +
            `Found ${result.stats.duplicateGroups} groups of duplicates\n` +
            `Total duplicate files: ${result.stats.totalDuplicates}\n` +
            `Potential space savings: ${formatBytes(result.stats.totalWastedSpace)}`
          );
        } else {
          alert('Scan Complete!\n\nNo duplicate files found in the scanned directories.');
        }
      }
    } catch (error) {
      console.error('Scan failed:', error);
      alert('Scan failed: ' + error.message);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [minFileSize, maxFileSize, filterType]);

  const handleDeleteDuplicates = useCallback(async (group, groupIndex) => {
    const filesToKeep = selectedToKeep[groupIndex] || [group.files[0].path];
    const filesToDelete = group.files.filter(f => !filesToKeep.includes(f.path));

    const confirmed = window.confirm(
      `Delete ${filesToDelete.length} duplicate files?\n\n` +
      `Space to be freed: ${formatBytes(group.files[0].size * filesToDelete.length)}\n\n` +
      `Files to keep: ${filesToKeep.length}\n` +
      `Files to delete: ${filesToDelete.length}`
    );

    if (!confirmed) return;

    try {
      const result = await window.duplicateFilesAPI.deleteDuplicates(
        group.hash,
        filesToKeep
      );

      if (result.success) {
        alert(
          `Deletion Complete!\n\n` +
          `Deleted: ${result.deleted} files\n` +
          `Failed: ${result.failed} files\n` +
          `Space Freed: ${formatBytes(result.spaceFreed)}`
        );
        
        // Refresh scan results
        handleStartScan();
      }
    } catch (error) {
      console.error('Failed to delete duplicates:', error);
      alert('Failed to delete duplicates: ' + error.message);
    }
  }, [selectedToKeep, handleStartScan]);

  const handleOpenFileLocation = useCallback(async (filePath) => {
    try {
      await window.electron.invoke('shell:showItemInFolder', filePath);
    } catch (error) {
      console.error('Failed to open file location:', error);
      alert('Failed to open file location');
    }
  }, []);

  const toggleGroup = useCallback((groupIndex) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupIndex)) {
        newSet.delete(groupIndex);
      } else {
        newSet.add(groupIndex);
      }
      return newSet;
    });
  }, []);

  const toggleFileSelection = useCallback((groupIndex, filePath) => {
    setSelectedToKeep(prev => {
      const groupSelections = prev[groupIndex] || [];
      const newSelections = groupSelections.includes(filePath)
        ? groupSelections.filter(p => p !== filePath)
        : [...groupSelections, filePath];
      
      return {
        ...prev,
        [groupIndex]: newSelections
      };
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

  const getFileIcon = (type) => {
    switch (type) {
      case 'document': return <FileText className="w-5 h-5 text-blue-400" />;
      case 'image': return <Image className="w-5 h-5 text-green-400" />;
      case 'video': return <Film className="w-5 h-5 text-purple-400" />;
      case 'audio': return <Music className="w-5 h-5 text-pink-400" />;
      case 'archive': return <Archive className="w-5 h-5 text-orange-400" />;
      case 'application': return <Package className="w-5 h-5 text-red-400" />;
      default: return <FileText className="w-5 h-5 text-gray-400" />;
    }
  };

  const filteredGroups = scanResults?.duplicateGroups.filter(group => {
    if (filterType === 'all') return true;
    return group.type === filterType;
  }) || [];

  const totalPages = Math.ceil(filteredGroups.length / itemsPerPage);
  const paginatedGroups = filteredGroups.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-3 text-white">
            <Copy className="w-7 h-7 text-purple-400" />
            Duplicate Files Finder
          </h2>
          <p className="text-gray-400 mt-1">Automatically scans common folders (Documents, Downloads, Pictures, Desktop)</p>
        </div>
        <div className="flex gap-3">
          {scanResults && !scanning && (
            <button
              onClick={() => {
                setScanResults(null);
                setCurrentPage(1);
              }}
              className="px-4 py-2 bg-[#003566] hover:bg-[#0077B6] text-white rounded-lg transition flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Rescan
            </button>
          )}
        </div>
      </div>

      {/* Filter Controls - Always Visible */}
      <div className="bg-gray-800 p-4 rounded-lg">
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-white">
              Min Size (KB)
            </label>
            <input
              type="number"
              value={minFileSize}
              onChange={(e) => {
                setMinFileSize(Math.max(1, parseInt(e.target.value) || 1));
                if (scanResults) {
                  setScanResults(null);
                }
              }}
              disabled={scanning}
              className="w-full px-4 py-2 bg-[#001D3D] border-2 border-[#0077B6] text-white rounded-lg focus:border-[#FFC300] focus:outline-none disabled:opacity-50"
              min="1"
              placeholder="1"
            />
            <p className="text-xs text-gray-400 mt-1">Minimum: 1KB</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-white">
              Max Size (MB)
            </label>
            <input
              type="number"
              value={maxFileSize}
              onChange={(e) => {
                setMaxFileSize(Math.max(1, parseInt(e.target.value) || 1));
                if (scanResults) {
                  setScanResults(null);
                }
              }}
              disabled={scanning}
              className="w-full px-4 py-2 bg-[#001D3D] border-2 border-[#0077B6] text-white rounded-lg focus:border-[#FFC300] focus:outline-none disabled:opacity-50"
              min="1"
              placeholder="500"
            />
            <p className="text-xs text-gray-400 mt-1">Maximum: 500MB</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-white">
              File Type Filter
            </label>
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setCurrentPage(1);
              }}
              disabled={scanning}
              className="w-full px-4 py-2 bg-[#001D3D] border-2 border-[#0077B6] text-white rounded-lg focus:border-[#FFC300] focus:outline-none disabled:opacity-50"
            >
              <option value="all">All Types</option>
              <option value="document">Documents</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="audio">Audio</option>
              <option value="archive">Archives</option>
              <option value="application">Applications</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleStartScan}
              disabled={scanning}
              className="w-full px-6 py-2 bg-[#FFC300] hover:bg-[#FFD60A] text-[#001D3D] font-semibold rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Search className="w-5 h-5" />
              {scanning ? 'Scanning...' : 'Apply & Scan'}
            </button>
          </div>
        </div>
      </div>

      {/* Progress Display */}
      {scanning && (
        <div className="bg-[#003566] border-2 border-[#0077B6] rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <RefreshCw className="w-6 h-6 animate-spin text-[#FFC300]" />
            <span className="font-medium text-white text-lg">
              {progress?.message || 'Scanning for duplicates...'}
            </span>
          </div>
          {progress?.progress !== undefined && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">Progress</span>
                <span className="text-sm font-medium text-[#FFC300]">
                  {Math.round(progress.progress)}%
                </span>
              </div>
              <div className="w-full bg-[#001D3D] rounded-full h-3">
                <div
                  className="bg-[#FFC300] h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
            </div>
          )}
          {progress?.processed && progress?.total && (
            <div className="text-sm text-gray-300 mt-3">
              Processed: {progress.processed} / {progress.total} files
            </div>
          )}
          <div className="mt-4 text-xs text-gray-400">
            <p className="flex items-center gap-1"><Clock className="w-3 h-3" /> This may take a few minutes depending on the number of files...</p>
            <p className="mt-1 flex items-center gap-1"><Lightbulb className="w-3 h-3" /> The app will remain responsive during the scan.</p>
          </div>
        </div>
      )}

      {/* Initial State - No Scan Yet */}
      {!scanResults && !scanning && (
        <div className="bg-gray-800 p-12 rounded-lg text-center">
          <Copy className="w-16 h-16 mx-auto mb-4 text-purple-400 opacity-50" />
          <h3 className="text-xl font-semibold text-white mb-2">Find Duplicate Files</h3>
          <p className="text-gray-400 mb-6">
            Click "Apply & Scan" above to search for duplicate files in your common folders
          </p>
          <div className="bg-blue-900 bg-opacity-30 border border-blue-500 rounded-lg p-4 max-w-2xl mx-auto text-left">
            <p className="text-blue-200 text-sm mb-3">
              <strong>Scan Configuration:</strong>
            </p>
            <ul className="text-blue-200 text-sm space-y-2 list-disc list-inside">
              <li>Folders: Documents, Downloads, Pictures, Desktop, Videos, Music</li>
              <li>File size: {minFileSize}KB to {maxFileSize}MB</li>
              <li>Type filter: {filterType === 'all' ? 'All file types' : filterType}</li>
              <li>Smart scanning with quick pre-filtering for optimal performance</li>
              <li>Supports files up to 500MB without slowing your system</li>
            </ul>
          </div>
        </div>
      )}

      {/* Scan Results */}
      {scanResults && (
        <>
          {/* Statistics */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-800 p-4 rounded-lg">
              <div className="text-2xl font-bold text-white">{scanResults.stats.totalScanned}</div>
              <div className="text-sm text-gray-400">Files Scanned</div>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg">
              <div className="text-2xl font-bold text-yellow-400">{scanResults.stats.duplicateGroups}</div>
              <div className="text-sm text-gray-400">Duplicate Groups</div>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg">
              <div className="text-2xl font-bold text-red-400">{scanResults.stats.totalDuplicates}</div>
              <div className="text-sm text-gray-400">Duplicate Files</div>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg">
              <div className="text-2xl font-bold text-purple-400">
                {formatBytes(scanResults.stats.totalWastedSpace)}
              </div>
              <div className="text-sm text-gray-400">Wasted Space</div>
            </div>
          </div>

          {/* Duplicate Groups */}
          <div className="space-y-4">
            {filteredGroups.length === 0 ? (
              <div className="bg-gray-800 p-8 rounded-lg text-center text-gray-400">
                <Copy className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No duplicates found</p>
                <p className="text-sm mt-2">Try adjusting the file size filter or rescanning</p>
              </div>
            ) : (
              <>
                {paginatedGroups.map((group, groupIndex) => {
                  const actualIndex = (currentPage - 1) * itemsPerPage + groupIndex;
                  const isExpanded = expandedGroups.has(actualIndex);
                  const selections = selectedToKeep[actualIndex] || [group.files[0].path];
                
                  return (
                    <div key={actualIndex} className="bg-gray-800 rounded-lg overflow-hidden">
                    {/* Group Header */}
                    <div 
                      className="p-4 cursor-pointer hover:bg-gray-750 transition flex items-center justify-between"
                      onClick={() => toggleGroup(actualIndex)}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        {getFileIcon(group.type)}
                        <div>
                          <div className="font-medium text-white">
                            {group.files[0].name}
                          </div>
                          <div className="text-sm text-gray-400">
                            {group.count} copies • {formatBytes(group.files[0].size)} each • 
                            Wasted: {formatBytes(group.wastedSpace)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDuplicates(group, actualIndex);
                          }}
                          className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg transition flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete Duplicates
                        </button>
                        <span className="text-gray-400">
                          {isExpanded ? '▼' : '▶'}
                        </span>
                      </div>
                    </div>

                    {/* Group Files */}
                    {isExpanded && (
                      <div className="border-t border-gray-700 bg-gray-750">
                        <div className="p-4 bg-blue-900 bg-opacity-30 border-b border-gray-700">
                          <div className="flex items-center gap-2 text-sm text-blue-200">
                            <AlertTriangle className="w-4 h-4" />
                            Select which file(s) to keep. All others will be deleted.
                          </div>
                        </div>
                        <div className="divide-y divide-gray-700">
                          {group.files.map((file, fileIndex) => (
                            <div key={fileIndex} className="p-4 flex items-center gap-4">
                              <input
                                type="checkbox"
                                checked={selections.includes(file.path)}
                                onChange={() => toggleFileSelection(actualIndex, file.path)}
                                className="w-5 h-5 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-white truncate">{file.path}</div>
                                <div className="text-xs text-gray-400 mt-1">
                                  Modified: {formatDate(file.modified)}
                                </div>
                              </div>
                              <button
                                onClick={() => handleOpenFileLocation(file.path)}
                                className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm flex items-center gap-2"
                              >
                                <FolderOpen className="w-3 h-3" />
                                Open
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="bg-gray-800 p-4 rounded-lg flex items-center justify-between">
                  <div className="text-sm text-gray-400">
                    Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredGroups.length)} of {filteredGroups.length} groups
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
        </>
      )}
    </div>
  );
}
