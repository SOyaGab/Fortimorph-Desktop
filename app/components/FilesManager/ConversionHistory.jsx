import React, { useState, useEffect } from 'react';
import {
  History, FileText, CheckCircle, XCircle, Loader, Shield,
  FolderOpen, ExternalLink, Trash2, RefreshCw, Clock,
  ArrowRight, Download, Package, AlertTriangle
} from 'lucide-react';

const ConversionHistory = () => {
  const [conversions, setConversions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, completed: 0, failed: 0 });
  const [verifyingId, setVerifyingId] = useState(null);

  useEffect(() => {
    loadHistory();
    loadStats();
  }, []);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const history = await window.conversionAPI.list(50);
      setConversions(history || []);
    } catch (error) {
      console.error('Failed to load conversion history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const conversionStats = await window.conversionAPI.getStats();
      setStats(conversionStats || { total: 0, completed: 0, failed: 0 });
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleOpenFile = async (filePath) => {
    try {
      const result = await window.conversionAPI.openFile({ filePath });
      if (!result.success) {
        alert(`❌ Failed to open file\n\n${result.error || 'File may have been moved or deleted.'}`);
      }
    } catch (error) {
      console.error('Error opening file:', error);
      alert(`❌ Error: ${error.message}`);
    }
  };

  const handleShowInFolder = async (filePath) => {
    try {
      const result = await window.conversionAPI.openFolder({ filePath });
      if (!result.success) {
        alert(`❌ Failed to open folder\n\n${result.error || 'Folder may not exist.'}`);
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      alert(`❌ Error: ${error.message}`);
    }
  };

  const handleVerify = async (conversionId) => {
    setVerifyingId(conversionId);
    try {
      const result = await window.conversionAPI.verify(conversionId);
      
      if (result.isValid) {
        alert(`✅ Verification Successful!\n\nFile integrity verified. The file has not been modified since conversion.\n\nHash: ${result.actualHash?.substring(0, 16)}...`);
      } else {
        alert(`❌ Verification Failed\n\n${result.error || 'Hash mismatch detected. File may have been modified.'}`);
      }
    } catch (error) {
      console.error('Verification error:', error);
      alert(`❌ Verification Error\n\n${error.message}`);
    } finally {
      setVerifyingId(null);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDuration = (ms) => {
    if (!ms) return '0s';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    // Less than 1 minute
    if (diff < 60000) return 'Just now';
    // Less than 1 hour
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    // Less than 1 day
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    // Less than 7 days
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    
    return date.toLocaleDateString();
  };

  const getStatusIcon = (status) => {
    if (status === 'completed') {
      return <CheckCircle className="w-5 h-5 text-green-400" />;
    }
    return <XCircle className="w-5 h-5 text-red-400" />;
  };

  const getCompressionRatio = (conv) => {
    if (!conv.input_size || !conv.output_size) return null;
    const ratio = ((conv.output_size / conv.input_size) * 100).toFixed(1);
    return `${ratio}%`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <History className="w-7 h-7 text-cyan-400" />
            Conversion History
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            View and manage your file conversion records
          </p>
        </div>
        <button
          onClick={loadHistory}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-900/30 to-blue-800/20 rounded-xl p-5 border border-blue-500/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Conversions</p>
              <p className="text-3xl font-bold text-white mt-1">{stats.total || 0}</p>
            </div>
            <Package className="w-10 h-10 text-blue-400 opacity-50" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-900/30 to-green-800/20 rounded-xl p-5 border border-green-500/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Completed</p>
              <p className="text-3xl font-bold text-white mt-1">{stats.completed || 0}</p>
            </div>
            <CheckCircle className="w-10 h-10 text-green-400 opacity-50" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-red-900/30 to-red-800/20 rounded-xl p-5 border border-red-500/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Failed</p>
              <p className="text-3xl font-bold text-white mt-1">{stats.failed || 0}</p>
            </div>
            <XCircle className="w-10 h-10 text-red-400 opacity-50" />
          </div>
        </div>
      </div>

      {/* Conversion List */}
      <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="p-6 border-b border-gray-700/50">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            Recent Conversions
          </h3>
        </div>

        <div className="max-h-[600px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-8 h-8 text-cyan-400 animate-spin" />
            </div>
          ) : conversions.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No conversion history yet</p>
              <p className="text-gray-500 text-sm mt-2">Your converted files will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700/30">
              {conversions.map((conv, index) => (
                <div
                  key={conv.id || index}
                  className="p-6 hover:bg-white/5 transition-colors"
                >
                  {/* Header Row */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {getStatusIcon(conv.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-white font-medium truncate">
                            {conv.input_path?.split('\\').pop() || 'Unknown file'}
                          </p>
                          <ArrowRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                          <p className="text-cyan-400 font-medium truncate">
                            {conv.output_path?.split('\\').pop() || 'Unknown output'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(conv.timestamp)}
                          </span>
                          <span>•</span>
                          <span>{conv.input_format} → {conv.output_format}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                      <p className="text-gray-400 text-xs mb-1">Input Size</p>
                      <p className="text-white font-medium">{formatBytes(conv.input_size)}</p>
                    </div>
                    <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                      <p className="text-gray-400 text-xs mb-1">Output Size</p>
                      <p className="text-white font-medium">{formatBytes(conv.output_size)}</p>
                    </div>
                    <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                      <p className="text-gray-400 text-xs mb-1">Duration</p>
                      <p className="text-white font-medium">{formatDuration(conv.duration)}</p>
                    </div>
                    <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                      <p className="text-gray-400 text-xs mb-1">Compression</p>
                      <p className="text-white font-medium">
                        {getCompressionRatio(conv) || 'N/A'}
                      </p>
                    </div>
                  </div>

                  {/* Status Badges */}
                  <div className="flex items-center gap-2 mb-4">
                    {conv.encrypted === 1 && (
                      <span className="px-2 py-1 bg-purple-500/20 text-purple-300 text-xs rounded border border-purple-500/30">
                        🔒 Encrypted
                      </span>
                    )}
                    {conv.compressed === 1 && (
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded border border-blue-500/30">
                        📦 Compressed
                      </span>
                    )}
                    {conv.status === 'completed' ? (
                      <span className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded border border-green-500/30">
                        ✓ Success
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-red-500/20 text-red-300 text-xs rounded border border-red-500/30">
                        ✗ Failed
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  {conv.status === 'completed' && conv.output_path && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenFile(conv.output_path)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open File
                      </button>
                      <button
                        onClick={() => handleShowInFolder(conv.output_path)}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm rounded-lg transition-colors"
                      >
                        <FolderOpen className="w-4 h-4" />
                        Show in Folder
                      </button>
                      <button
                        onClick={() => handleVerify(conv.id)}
                        disabled={verifyingId === conv.id}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
                      >
                        {verifyingId === conv.id ? (
                          <>
                            <Loader className="w-4 h-4 animate-spin" />
                            Verifying...
                          </>
                        ) : (
                          <>
                            <Shield className="w-4 h-4" />
                            Verify
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Error Message */}
                  {conv.error && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                        <p className="text-red-300 text-sm">{conv.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConversionHistory;
