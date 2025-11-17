import React, { useState, useEffect } from 'react';

/**
 * LogsViewer Component
 * Display and filter system logs with export capabilities
 */
const LogsViewer = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0
  });
  
  const [filters, setFilters] = useState({
    level: 'all',
    type: '',
    searchText: '',
    startDate: '',
    endDate: ''
  });
  
  const [logTypes, setLogTypes] = useState([]);
  const [exportStatus, setExportStatus] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportMenu && !event.target.closest('.export-menu-container')) {
        setShowExportMenu(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportMenu]);

  // Load logs on mount and when filters/page change
  useEffect(() => {
    loadLogs();
    loadLogTypes(); // Also refresh log types when logs change
  }, [filters, pagination.page]);

  // Load log types on mount
  useEffect(() => {
    loadLogTypes();
  }, []);

  /**
   * Load logs from database with filters
   */
  const loadLogs = async () => {
    setLoading(true);
    try {
      const filterObj = {
        level: filters.level,
        type: filters.type || undefined,
        searchText: filters.searchText || undefined,
        startDate: filters.startDate ? new Date(filters.startDate).getTime() : undefined,
        endDate: filters.endDate ? new Date(filters.endDate).getTime() : undefined
      };

      const result = await window.electron.invoke('logs:getFiltered', 
        filterObj, 
        pagination.page, 
        pagination.pageSize
      );
      
      setLogs(result.logs);
      setPagination(prev => ({
        ...prev,
        total: result.total,
        totalPages: result.totalPages
      }));
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Load available log types
   */
  const loadLogTypes = async () => {
    try {
      const types = await window.electron.invoke('logs:getTypes');
      setLogTypes(types);
    } catch (error) {
      console.error('Failed to load log types:', error);
    }
  };

  /**
   * Handle filter changes
   */
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
    setPagination(prev => ({
      ...prev,
      page: 1 // Reset to first page on filter change
    }));
  };

  /**
   * Reset all filters
   */
  const resetFilters = () => {
    setFilters({
      level: 'all',
      type: '',
      searchText: '',
      startDate: '',
      endDate: ''
    });
    setPagination(prev => ({
      ...prev,
      page: 1
    }));
  };

  /**
   * Export logs to CSV
   */
  const exportToCSV = async () => {
    await exportLogs('CSV', 'logs:exportCSV');
  };

  /**
   * Export logs to JSON
   */
  const exportToJSON = async () => {
    await exportLogs('JSON', 'logs:exportJSON');
  };

  /**
   * Export logs to XML
   */
  const exportToXML = async () => {
    await exportLogs('XML', 'logs:exportXML');
  };

  /**
   * Export logs to TXT
   */
  const exportToTXT = async () => {
    await exportLogs('TXT', 'logs:exportTXT');
  };

  /**
   * Export logs to HTML
   */
  const exportToHTML = async () => {
    await exportLogs('HTML', 'logs:exportHTML');
  };

  /**
   * Export logs to Markdown
   */
  const exportToMarkdown = async () => {
    await exportLogs('Markdown', 'logs:exportMarkdown');
  };

  /**
   * Generic export function
   */
  const exportLogs = async (format, channel) => {
    setExporting(true);
    setExportStatus(null);
    try {
      const filterObj = {
        level: filters.level === 'all' ? undefined : filters.level,
        type: filters.type || undefined,
        searchText: filters.searchText || undefined,
        startDate: filters.startDate ? new Date(filters.startDate).getTime() : undefined,
        endDate: filters.endDate ? new Date(filters.endDate).getTime() : undefined
      };

      const result = await window.electron.invoke(channel, filterObj);
      
      if (result.success) {
        setExportStatus({
          type: 'success',
          message: `Exported ${result.count} logs to ${format}: ${result.filename}`
        });
      }
    } catch (error) {
      console.error(`Failed to export ${format}:`, error);
      setExportStatus({
        type: 'error',
        message: `Failed to export logs to ${format}`
      });
    } finally {
      setExporting(false);
    }
  };

  /**
   * Export diagnostic package
   */
  const exportDiagnostic = async () => {
    setExporting(true);
    setExportStatus(null);
    try {
      const filterObj = {
        level: filters.level === 'all' ? undefined : filters.level,
        type: filters.type || undefined
      };

      const result = await window.electron.invoke('logs:exportDiagnostic', filterObj);
      
      if (result.success) {
        const sizeMB = (result.size / (1024 * 1024)).toFixed(2);
        setExportStatus({
          type: 'success',
          message: `Diagnostic package created: ${result.filename} (${sizeMB} MB)`
        });
      }
    } catch (error) {
      console.error('Failed to export diagnostic:', error);
      setExportStatus({
        type: 'error',
        message: 'Failed to create diagnostic package'
      });
    } finally {
      setExporting(false);
    }
  };

  /**
   * Open export folder
   */
  const openExportFolder = async () => {
    try {
      await window.electron.invoke('logs:openExportFolder');
    } catch (error) {
      console.error('Failed to open export folder:', error);
    }
  };

  /**
   * Format timestamp to readable date
   */
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  };

  /**
   * Get level badge color
   */
  const getLevelColor = (level) => {
    const colors = {
      error: 'bg-red-500/20 text-red-400 border-red-500/40',
      warn: 'bg-[#FFC300]/20 text-[#FFC300] border-[#FFC300]/40',
      info: 'bg-[#48CAE4]/20 text-[#48CAE4] border-[#48CAE4]/40',
      debug: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
      success: 'bg-[#4CAF50]/20 text-[#4CAF50] border-[#4CAF50]/40'
    };
    return colors[level] || colors.info;
  };

  /**
   * Go to specific page
   */
  const goToPage = (page) => {
    setPagination(prev => ({
      ...prev,
      page: Math.max(1, Math.min(page, prev.totalPages))
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">System Logs</h1>
          <p className="text-[#48CAE4]">View, filter, and export application logs</p>
        </div>

        {/* Filters Section */}
        <div className="bg-[#003566] rounded-xl shadow-lg border border-[#48CAE4]/20 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            {/* Level Filter */}
            <div>
              <label className="block text-sm font-medium text-[#48CAE4] mb-2">
                Level
              </label>
              <select
                value={filters.level}
                onChange={(e) => handleFilterChange('level', e.target.value)}
                className="w-full px-3 py-2 bg-[#001D3D] border border-[#48CAE4]/30 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48CAE4] transition-all duration-150"
              >
                <option value="all">All Levels</option>
                <option value="error">Error</option>
                <option value="warn">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
                <option value="success">Success</option>
              </select>
            </div>

            {/* Type Filter */}
            <div>
              <label className="block text-sm font-medium text-[#48CAE4] mb-2">
                Module/Type
              </label>
              <select
                value={filters.type}
                onChange={(e) => handleFilterChange('type', e.target.value)}
                className="w-full px-3 py-2 bg-[#001D3D] border border-[#48CAE4]/30 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48CAE4] transition-all duration-150"
              >
                <option value="">All Types</option>
                {logTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-[#48CAE4] mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
                className="w-full px-3 py-2 bg-[#001D3D] border border-[#48CAE4]/30 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48CAE4] transition-all duration-150"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium text-[#48CAE4] mb-2">
                End Date
              </label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
                className="w-full px-3 py-2 bg-[#001D3D] border border-[#48CAE4]/30 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48CAE4] transition-all duration-150"
              />
            </div>

            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-[#48CAE4] mb-2">
                Search Message
              </label>
              <input
                type="text"
                value={filters.searchText}
                onChange={(e) => handleFilterChange('searchText', e.target.value)}
                placeholder="Search logs..."
                className="w-full px-3 py-2 bg-[#001D3D] border border-[#48CAE4]/30 text-white placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48CAE4] transition-all duration-150"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={resetFilters}
              className="px-5 py-2.5 bg-[#001D3D] text-[#48CAE4] rounded-lg hover:bg-[#002855] border border-[#48CAE4]/30 transition-all duration-150 ease-in-out font-medium"
            >
              Reset Filters
            </button>
            
            {/* Export Dropdown Menu */}
            <div className="relative export-menu-container">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={exporting}
                className="px-5 py-2.5 bg-[#0077B6] text-white rounded-lg hover:bg-[#005F8F] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 ease-in-out font-medium shadow-lg flex items-center gap-2"
              >
                📥 Export Logs
                <span className="text-xs">▼</span>
              </button>
              
              {showExportMenu && (
                <div className="absolute left-0 mt-2 w-56 bg-[#001D3D] border-2 border-[#0077B6] rounded-lg shadow-2xl z-50 overflow-hidden">
                  <div className="py-1">
                    <div className="px-4 py-2 text-xs font-semibold text-[#48CAE4] border-b border-[#0077B6]/30">
                      Data Formats
                    </div>
                    <button
                      onClick={() => { exportToCSV(); setShowExportMenu(false); }}
                      disabled={exporting}
                      className="w-full text-left px-4 py-2.5 text-white hover:bg-[#0077B6] transition-colors duration-150 disabled:opacity-50"
                    >
                      CSV (Spreadsheet)
                    </button>
                    <button
                      onClick={() => { exportToJSON(); setShowExportMenu(false); }}
                      disabled={exporting}
                      className="w-full text-left px-4 py-2.5 text-white hover:bg-[#0077B6] transition-colors duration-150 disabled:opacity-50"
                    >
                      JSON (Structured Data)
                    </button>
                    <button
                      onClick={() => { exportToXML(); setShowExportMenu(false); }}
                      disabled={exporting}
                      className="w-full text-left px-4 py-2.5 text-white hover:bg-[#0077B6] transition-colors duration-150 disabled:opacity-50"
                    >
                      XML (Markup)
                    </button>
                    
                    <div className="px-4 py-2 text-xs font-semibold text-[#48CAE4] border-b border-t border-[#0077B6]/30 mt-1">
                      Document Formats
                    </div>
                    <button
                      onClick={() => { exportToTXT(); setShowExportMenu(false); }}
                      disabled={exporting}
                      className="w-full text-left px-4 py-2.5 text-white hover:bg-[#0077B6] transition-colors duration-150 disabled:opacity-50"
                    >
                      TXT (Plain Text)
                    </button>
                    <button
                      onClick={() => { exportToHTML(); setShowExportMenu(false); }}
                      disabled={exporting}
                      className="w-full text-left px-4 py-2.5 text-white hover:bg-[#0077B6] transition-colors duration-150 disabled:opacity-50"
                    >
                      HTML (Web Page)
                    </button>
                    <button
                      onClick={() => { exportToMarkdown(); setShowExportMenu(false); }}
                      disabled={exporting}
                      className="w-full text-left px-4 py-2.5 text-white hover:bg-[#0077B6] transition-colors duration-150 disabled:opacity-50"
                    >
                      Markdown (.md)
                    </button>
                    
                    <div className="px-4 py-2 text-xs font-semibold text-[#FFD60A] border-b border-t border-[#0077B6]/30 mt-1">
                      Package Format
                    </div>
                    <button
                      onClick={() => { exportDiagnostic(); setShowExportMenu(false); }}
                      disabled={exporting}
                      className="w-full text-left px-4 py-2.5 text-[#FFD60A] hover:bg-[#FFC300]/20 transition-colors duration-150 disabled:opacity-50 font-medium"
                    >
                      Diagnostic ZIP
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            <button
              onClick={openExportFolder}
              className="px-5 py-2.5 bg-[#48CAE4] text-[#001D3D] rounded-lg hover:bg-[#5DD5F5] transition-all duration-150 ease-in-out font-medium shadow-lg"
            >
              📂 Open Export Folder
            </button>
          </div>

          {/* Export Status */}
          {exportStatus && (
            <div className={`mt-4 p-4 rounded-lg ${
              exportStatus.type === 'success' 
                ? 'bg-[#4CAF50]/20 text-[#4CAF50] border border-[#4CAF50]/40' 
                : 'bg-red-500/20 text-red-400 border border-red-500/40'
            }`}>
              {exportStatus.message}
            </div>
          )}
        </div>

        {/* Stats Bar */}
        <div className="bg-[#003566] rounded-xl shadow-lg border border-[#48CAE4]/20 p-4 mb-6">
          <div className="flex items-center justify-between text-[#48CAE4]">
            <div className="text-sm font-medium">
              Showing <span className="text-white font-bold">{logs.length}</span> of <span className="text-white font-bold">{pagination.total}</span> logs
            </div>
            <div className="text-sm font-medium">
              Page <span className="text-white font-bold">{pagination.page}</span> of <span className="text-white font-bold">{pagination.totalPages}</span>
            </div>
          </div>
        </div>

        {/* Logs Table */}
        <div className="bg-[#003566] rounded-xl shadow-lg border border-[#48CAE4]/20 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-[#48CAE4]">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#48CAE4] mb-4"></div>
              <p>Loading logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center text-[#48CAE4]">
              <p className="text-lg">No logs found matching the current filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#001D3D] border-b border-[#48CAE4]/30">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-[#48CAE4] uppercase tracking-wider">
                      ID
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-[#48CAE4] uppercase tracking-wider">
                      Level
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-[#48CAE4] uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-[#48CAE4] uppercase tracking-wider">
                      Message
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-[#48CAE4] uppercase tracking-wider">
                      Timestamp
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#48CAE4]/10">
                  {logs.map((log, index) => (
                    <tr 
                      key={log.id} 
                      className={`transition-all duration-150 hover:bg-[#004A7F] ${
                        index % 2 === 0 ? 'bg-[#003566]' : 'bg-[#002855]'
                      }`}
                    >
                      <td className="px-6 py-4 text-sm text-gray-300">
                        {log.id}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${getLevelColor(log.level)}`}>
                          {log.level}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-[#48CAE4] font-medium">
                        {log.type}
                      </td>
                      <td className="px-6 py-4 text-sm text-white max-w-lg">
                        <div className="truncate" title={log.message}>
                          {log.message}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-300 whitespace-nowrap">
                        {formatTimestamp(log.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              onClick={() => goToPage(1)}
              disabled={pagination.page === 1}
              className="px-4 py-2 bg-[#003566] border border-[#48CAE4]/30 text-white rounded-lg hover:bg-[#004A7F] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 ease-in-out"
            >
              First
            </button>
            <button
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="px-4 py-2 bg-[#003566] border border-[#48CAE4]/30 text-white rounded-lg hover:bg-[#004A7F] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 ease-in-out"
            >
              Previous
            </button>
            
            <div className="flex items-center gap-2">
              {[...Array(Math.min(5, pagination.totalPages))].map((_, i) => {
                let pageNum;
                if (pagination.totalPages <= 5) {
                  pageNum = i + 1;
                } else if (pagination.page <= 3) {
                  pageNum = i + 1;
                } else if (pagination.page >= pagination.totalPages - 2) {
                  pageNum = pagination.totalPages - 4 + i;
                } else {
                  pageNum = pagination.page - 2 + i;
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => goToPage(pageNum)}
                    className={`px-4 py-2 border rounded-lg transition-all duration-150 ease-in-out font-medium ${
                      pagination.page === pageNum
                        ? 'bg-[#FFC300] text-[#001D3D] border-[#FFC300] shadow-lg scale-105'
                        : 'bg-[#003566] text-white border-[#48CAE4]/30 hover:bg-[#004A7F]'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
              className="px-4 py-2 bg-[#003566] border border-[#48CAE4]/30 text-white rounded-lg hover:bg-[#004A7F] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 ease-in-out"
            >
              Next
            </button>
            <button
              onClick={() => goToPage(pagination.totalPages)}
              disabled={pagination.page === pagination.totalPages}
              className="px-4 py-2 bg-[#003566] border border-[#48CAE4]/30 text-white rounded-lg hover:bg-[#004A7F] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 ease-in-out"
            >
              Last
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LogsViewer;
