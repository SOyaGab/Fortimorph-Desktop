import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import LogsViewer from './LogsViewer';
import BatteryCenter from './BatteryCenter';

const Dashboard = () => {
  const [metrics, setMetrics] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false); // Changed to false for instant UI
  const [error, setError] = useState(null);
  const [selectedView, setSelectedView] = useState('overview'); // overview, cpu, memory, processes, storage, logs, battery
  const refreshInterval = 10000; // 10 seconds (optimized from 5s)
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [installedApps, setInstalledApps] = useState([]);
  const [storageAnalysis, setStorageAnalysis] = useState(null);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [minFileSize, setMinFileSize] = useState(100); // MB
  const [showAllFiles, setShowAllFiles] = useState(true); // Show all files by default
  const [showAllProcesses, setShowAllProcesses] = useState(false); // Show all processes or just top 20
  const [isRefreshingProcesses, setIsRefreshingProcesses] = useState(false);
  const [fileSizeFilter, setFileSizeFilter] = useState('large'); // 'large', 'small', or 'all'
  const [processSearchTerm, setProcessSearchTerm] = useState(''); // Search filter for processes
  const [optimizationResult, setOptimizationResult] = useState(null); // Store last optimization result
  const resultsRef = useRef(null); // Reference to scroll to results

  // Fetch system metrics
  const fetchMetrics = async () => {
    if (isFetching) return; // Prevent overlapping calls
    
    try {
      setIsFetching(true);
      const result = await window.electronAPI.system.getMetrics();
      if (result.success) {
        setMetrics(result.data);
        setError(null);
      } else {
        throw new Error(result.error || 'Failed to fetch metrics');
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
      setError(error.message);
    } finally {
      setIsFetching(false);
    }
  };

  // Fetch process list (only when needed)
  const fetchProcesses = async () => {
    setIsRefreshingProcesses(true);
    try {
      const result = await window.electronAPI.system.getProcesses();
      if (result.success) {
        setProcesses(result.data);
      }
    } catch (error) {
      console.error('Error fetching processes:', error);
    } finally {
      setIsRefreshingProcesses(false);
    }
  };

  // Fetch optimization suggestions
  const fetchSuggestions = async () => {
    try {
      const result = await window.electronAPI.system.getSuggestions();
      if (result.success) {
        setSuggestions(result.data);
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    }
  };

  // Fetch installed applications
  const fetchInstalledApps = async (force = false) => {
    console.log('========================================');
    console.log('fetchInstalledApps called');
    console.log('Force:', force);
    console.log('Current app count:', installedApps.length);
    console.log('isLoadingApps:', isLoadingApps);
    console.log('========================================');
    
    // Skip if already loading
    if (isLoadingApps) {
      console.log('❌ Skipping fetch - already loading');
      return;
    }
    
    // Skip if already loaded and not forcing refresh
    if (installedApps.length > 0 && !force) {
      console.log('❌ Skipping fetch - already loaded (use force=true to reload)');
      return;
    }
    
    setIsLoadingApps(true);
    console.log('✅ Starting to fetch installed apps...');
    
    try {
      console.log('Calling electronAPI.system.getInstalledApps()...');
      const result = await window.electronAPI.system.getInstalledApps();
      
      console.log('========================================');
      console.log('Fetch result received:');
      console.log('Success:', result.success);
      console.log('Data length:', result.data?.length);
      console.log('Error:', result.error);
      console.log('========================================');
      
      if (result.success) {
        console.log('✅ Successfully fetched apps:', result.data.length);
        if (result.data.length > 0) {
          console.log('First 3 apps:', result.data.slice(0, 3).map(a => a.name));
        }
        setInstalledApps(result.data);
      } else {
        console.error('❌ Failed to fetch apps:', result.error);
        alert(`Failed to load applications: ${result.error}\n\nCheck console (F12) for details.`);
      }
    } catch (error) {
      console.error('========================================');
      console.error('❌ Exception in fetchInstalledApps:');
      console.error('Error:', error);
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
      console.error('========================================');
      alert(`Error loading applications: ${error.message}\n\nCheck console (F12) for details.`);
    } finally {
      setIsLoadingApps(false);
      console.log('✅ Finished fetching apps (loading = false)');
      console.log('========================================');
    }
  };

  // Fetch storage analysis
  const fetchStorageAnalysis = async (customMinSize = null) => {
    const sizeToUse = customMinSize !== null ? customMinSize : minFileSize;
    setIsLoadingStorage(true);
    try {
      const result = await window.electronAPI.system.getStorageAnalysis(sizeToUse);
      console.log('Storage analysis result with size:', sizeToUse, 'MB, result:', result);
      if (result.success) {
        console.log('Large files count:', result.data.largeFiles?.length);
        setStorageAnalysis(result.data);
      } else {
        console.error('Storage analysis failed:', result.error);
      }
    } catch (error) {
      console.error('Error fetching storage analysis:', error);
    } finally {
      setIsLoadingStorage(false);
    }
  };

  // Initial load - fetch metrics in background, show UI immediately
  useEffect(() => {
    const initialize = async () => {
      try {
        // Fetch metrics in background - UI is already visible
        await fetchMetrics();
      } catch (err) {
        console.error('Initialization error:', err);
        setError('Failed to initialize dashboard');
      }
    };
    initialize();
  }, []);

  // Auto-refresh metrics - but only if not loading and not already fetching
  useEffect(() => {
    if (loading) return; // Don't start auto-refresh until initial load completes
    
    const interval = setInterval(() => {
      if (!isFetching) {
        fetchMetrics();
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, loading, isFetching]);
  
  // Auto-fetch processes when switching to processes view - INITIAL LOAD ONLY
  useEffect(() => {
    if (selectedView === 'processes' && processes.length === 0 && !loading && !isRefreshingProcesses) {
      console.log('📋 Processes view selected - loading processes (initial load only)');
      fetchProcesses();
    }
  }, [selectedView, loading, processes.length, isRefreshingProcesses]);

  // Auto-fetch installed apps when switching to storage view - ONE TIME ONLY
  useEffect(() => {
    if (selectedView === 'storage' && installedApps.length === 0 && !loading && !isLoadingApps) {
      console.log('💾 Storage view selected - loading installed apps (one time)');
      fetchInstalledApps(true);
    }
  }, [selectedView, loading, installedApps.length, isLoadingApps]);

  // Handle optimize button
  const handleOptimize = async () => {
    setIsOptimizing(true);
    setOptimizationResult(null); // Clear previous results
    try {
      const result = await window.electronAPI.system.optimize();
      if (result.success) {
        // Store the detailed results
        setOptimizationResult(result.data);
        // Set to false BEFORE showing alert so button is enabled when alert closes
        setIsOptimizing(false);
        await fetchMetrics();
        await fetchSuggestions();
        
        // Scroll to results with smooth animation after a short delay
        setTimeout(() => {
          if (resultsRef.current) {
            resultsRef.current.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'start' 
            });
            // Add a pulse animation to draw attention
            resultsRef.current.classList.add('pulse-attention');
            setTimeout(() => {
              resultsRef.current?.classList.remove('pulse-attention');
            }, 2000);
          }
        }, 300);
      } else {
        setIsOptimizing(false);
        alert('Optimization failed: ' + result.error);
      }
    } catch (error) {
      console.error('Optimization error:', error);
      setIsOptimizing(false);
      alert('Optimization error: ' + error.message);
    }
  };

  // Handle end process
  const handleEndProcess = async (pid, processName) => {
    if (!confirm(`Are you sure you want to end "${processName}" (PID: ${pid})?`)) {
      return;
    }

    try {
      const result = await window.electronAPI.system.endProcess(pid, false);
      if (result.success && result.data.success) {
        alert(`Process ${processName} ended successfully`);
        await fetchProcesses();
        await fetchMetrics();
      } else {
        alert('Failed to end process: ' + (result.data?.message || result.error));
      }
    } catch (error) {
      console.error('Error ending process:', error);
      alert('Error ending process: ' + error.message);
    }
  };

  // Handle open file
  const handleOpenFile = async (filePath) => {
    try {
      const result = await window.electronAPI.system.openFile(filePath);
      if (!result.success) {
        alert('Failed to open file: ' + result.error);
      }
    } catch (error) {
      console.error('Error opening file:', error);
      alert('Error opening file: ' + error.message);
    }
  };

  // Handle show file in folder
  const handleShowInFolder = async (filePath) => {
    try {
      const result = await window.electronAPI.system.showInFolder(filePath);
      if (!result.success) {
        alert('Failed to show file in folder: ' + result.error);
      }
    } catch (error) {
      console.error('Error showing file in folder:', error);
      alert('Error: ' + error.message);
    }
  };

  // Handle delete file
  const handleDeleteFile = async (filePath, fileName) => {
    if (!confirm(`Are you sure you want to move "${fileName}" to the Recycle Bin?`)) {
      return;
    }

    try {
      const result = await window.electronAPI.system.deleteFile(filePath);
      if (result.success) {
        alert('File moved to Recycle Bin successfully');
        // Refresh storage analysis
        await fetchStorageAnalysis();
      } else {
        alert('Failed to delete file: ' + result.error);
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Error deleting file: ' + error.message);
    }
  };

  // Handle open folder
  const handleOpenFolder = async (folderPath) => {
    try {
      const result = await window.electronAPI.system.openFolder(folderPath);
      if (!result.success) {
        alert('Failed to open folder: ' + result.error);
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      alert('Error opening folder: ' + error.message);
    }
  };

  // Handle delete folder
  const handleDeleteFolder = async (folderPath, folderName) => {
    if (!confirm(`Are you sure you want to move "${folderName}" to the Recycle Bin?\n\nWARNING: This will move the entire folder and all its contents!`)) {
      return;
    }

    try {
      const result = await window.electronAPI.system.deleteFolder(folderPath);
      if (result.success) {
        alert('Folder moved to Recycle Bin successfully');
        // Refresh storage analysis
        await fetchStorageAnalysis();
      } else {
        alert('Failed to delete folder: ' + result.error);
      }
    } catch (error) {
      console.error('Error deleting folder:', error);
      alert('Error deleting folder: ' + error.message);
    }
  };

  // Format bytes
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Format uptime
  const formatUptime = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Prepare chart data
  const getChartData = () => {
    if (!metrics?.history) return [];
    
    const { cpu, memory, timestamps } = metrics.history;
    return timestamps.map((timestamp, index) => ({
      time: new Date(timestamp).toLocaleTimeString(),
      cpu: cpu[index],
      memory: memory[index],
    }));
  };

  // No more full-screen loading - show UI immediately with loading indicators

  if (error && !metrics) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814] flex items-center justify-center p-6">
        <div className="bg-[#003566] rounded-lg p-8 border-2 border-red-500 max-w-md">
          <h2 className="text-red-500 text-2xl font-bold mb-4">⚠️ Error Loading Metrics</h2>
          <p className="text-white mb-4">{error}</p>
          <button
            onClick={() => {
              setError(null);
              fetchMetrics();
            }}
            className="bg-[#FFD60A] hover:bg-[#FFC300] text-[#001D3D] font-bold py-2 px-6 rounded"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814] p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-4xl font-bold text-white mb-2">FortiMorph Dashboard</h1>
        <p className="text-[#FFD60A]">Real-time system monitoring and optimization</p>
      </div>

      {/* Suggestions Banner */}
      {suggestions.length > 0 && (
        <div className="mb-6 bg-[#FFD60A] bg-opacity-20 border-2 border-[#FFD60A] rounded-lg p-4">
          <h3 className="text-[#FFD60A] font-bold mb-2">⚠️ Optimization Suggestions</h3>
          <div className="space-y-2">
            {suggestions.map((suggestion, index) => (
              <div key={index} className="text-white text-sm">
                <strong>{suggestion.title}:</strong> {suggestion.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex space-x-4 mb-6 overflow-x-auto">
        <button
          onClick={() => setSelectedView('overview')}
          className={`px-6 py-2 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
            selectedView === 'overview'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-[#003566] text-white hover:bg-[#004A7F]'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setSelectedView('cpu')}
          className={`px-6 py-2 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
            selectedView === 'cpu'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-[#003566] text-white hover:bg-[#004A7F]'
          }`}
        >
          CPU Details
        </button>
        <button
          onClick={() => setSelectedView('memory')}
          className={`px-6 py-2 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
            selectedView === 'memory'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-[#003566] text-white hover:bg-[#004A7F]'
          }`}
        >
          Memory Details
        </button>
        <button
          onClick={() => setSelectedView('processes')}
          className={`px-6 py-2 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
            selectedView === 'processes'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-[#003566] text-white hover:bg-[#004A7F]'
          }`}
        >
          Processes
        </button>
        <button
          onClick={() => setSelectedView('storage')}
          className={`px-6 py-2 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
            selectedView === 'storage'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-[#003566] text-white hover:bg-[#004A7F]'
          }`}
        >
          Storage & Apps
        </button>
        <button
          onClick={() => setSelectedView('logs')}
          className={`px-6 py-2 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
            selectedView === 'logs'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-[#003566] text-white hover:bg-[#004A7F]'
          }`}
        >
          System Logs
        </button>
        <button
          onClick={() => setSelectedView('battery')}
          className={`px-6 py-2 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
            selectedView === 'battery'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-[#003566] text-white hover:bg-[#004A7F]'
          }`}
        >
          Battery
        </button>
      </div>

      {/* Overview View */}
      {selectedView === 'overview' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* CPU Card */}
            <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6] transform transition-all duration-300 hover:scale-105 hover:shadow-xl">
              <div className="text-[#FFC300] text-sm font-semibold mb-2">CPU USAGE</div>
              {metrics ? (
                <>
                  <div className="text-white text-4xl font-bold mb-2">
                    {metrics.cpu.currentLoad}%
                  </div>
                  <div className="text-gray-400 text-sm">{metrics.cpu.brand}</div>
                  <div className="text-gray-400 text-xs">{metrics.cpu.cores} cores</div>
                </>
              ) : (
                <>
                  <div className="animate-pulse bg-[#0077B6] h-12 w-24 rounded mb-2"></div>
                  <div className="animate-pulse bg-[#0077B6] h-4 w-full rounded mb-1"></div>
                  <div className="animate-pulse bg-[#0077B6] h-3 w-20 rounded"></div>
                </>
              )}
            </div>

            {/* Memory Card */}
            <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6] transform transition-all duration-300 hover:scale-105 hover:shadow-xl">
              <div className="text-[#FFC300] text-sm font-semibold mb-2">MEMORY USAGE</div>
              {metrics ? (
                <>
                  <div className="text-white text-4xl font-bold mb-2">
                    {metrics.memory.usagePercent}%
                  </div>
                  <div className="text-gray-400 text-sm">
                    {formatBytes(metrics.memory.used)} / {formatBytes(metrics.memory.total)}
                  </div>
                </>
              ) : (
                <>
                  <div className="animate-pulse bg-[#0077B6] h-12 w-24 rounded mb-2"></div>
                  <div className="animate-pulse bg-[#0077B6] h-4 w-full rounded"></div>
                </>
              )}
            </div>

            {/* Disk Card */}
            <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6] transform transition-all duration-300 hover:scale-105 hover:shadow-xl">
              <div className="text-[#FFC300] text-sm font-semibold mb-2">DISK USAGE</div>
              {metrics ? (
                <>
                  <div className="text-white text-4xl font-bold mb-2">
                    {metrics.disk[0]?.use || 0}%
                  </div>
                  <div className="text-gray-400 text-sm">
                    {formatBytes(metrics.disk[0]?.available || 0)} free
                  </div>
                </>
              ) : (
                <>
                  <div className="animate-pulse bg-[#0077B6] h-12 w-24 rounded mb-2"></div>
                  <div className="animate-pulse bg-[#0077B6] h-4 w-full rounded"></div>
                </>
              )}
            </div>

            {/* Uptime Card */}
            <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6] transform transition-all duration-300 hover:scale-105 hover:shadow-xl">
              <div className="text-[#FFC300] text-sm font-semibold mb-2">SYSTEM UPTIME</div>
              {metrics ? (
                <>
                  <div className="text-white text-3xl font-bold mb-2">
                    {formatUptime(metrics.system.uptime)}
                  </div>
                  <div className="text-gray-400 text-sm">{metrics.system.platform}</div>
                </>
              ) : (
                <>
                  <div className="animate-pulse bg-[#0077B6] h-10 w-32 rounded mb-2"></div>
                  <div className="animate-pulse bg-[#0077B6] h-4 w-24 rounded"></div>
                </>
              )}
            </div>
          </div>

          {/* Performance Chart */}
          <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6]">
            <h3 className="text-[#FFC300] text-xl font-bold mb-4">Performance History</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={getChartData()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#0077B6" />
                <XAxis dataKey="time" stroke="#FFC300" />
                <YAxis stroke="#FFC300" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#001D3D',
                    border: '2px solid #0077B6',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="cpu"
                  stroke="#FFC300"
                  name="CPU %"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="memory"
                  stroke="#00B4D8"
                  name="Memory %"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Optimize Button */}
          <div className="flex justify-center">
            <button
              onClick={handleOptimize}
              disabled={isOptimizing}
              className={`px-8 py-4 rounded-lg font-bold text-lg transition-all duration-300 transform ${
                isOptimizing
                  ? 'bg-gray-500 cursor-not-allowed opacity-70'
                  : 'bg-[#FFD60A] hover:bg-[#FFC300] text-[#001D3D] hover:scale-110 hover:shadow-2xl'
              }`}
            >
              {isOptimizing ? (
                <span className="flex items-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Optimizing...
                </span>
              ) : (
                '🚀 Optimize System Now'
              )}
            </button>
          </div>

          {/* Optimization Results */}
          {optimizationResult && (
            <div 
              ref={resultsRef}
              className="bg-gradient-to-br from-[#003566] to-[#001D3D] rounded-xl p-6 border-2 border-[#4CAF50] shadow-2xl animate-slideInDown"
              style={{
                animation: 'slideInDown 0.5s ease-out, pulse-glow 2s ease-in-out'
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[#4CAF50] text-2xl font-bold flex items-center">
                  ✅ Optimization Complete!
                </h3>
                <button
                  onClick={() => setOptimizationResult(null)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-[#001D3D] rounded-lg p-4">
                  <div className="text-[#48CAE4] text-sm mb-1">Total Space Freed</div>
                  <div className="text-white text-3xl font-bold">{formatBytes(optimizationResult.spaceSaved)}</div>
                </div>
                <div className="bg-[#001D3D] rounded-lg p-4">
                  <div className="text-[#48CAE4] text-sm mb-1">Actions Performed</div>
                  <div className="text-white text-3xl font-bold">{optimizationResult.actions.length}</div>
                </div>
              </div>

              {/* Detailed Actions */}
              <div className="space-y-3">
                <h4 className="text-[#FFC300] text-lg font-semibold mb-3">What Was Cleaned:</h4>
                {optimizationResult.actions.map((action, index) => (
                  <div 
                    key={index} 
                    className="bg-[#001D3D] rounded-lg p-4 border-l-4 border-[#48CAE4] transform transition-all duration-200 hover:scale-[1.02]"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${
                            action.status === 'success' 
                              ? 'bg-[#4CAF50]/20 text-[#4CAF50] border border-[#4CAF50]/40'
                              : action.status === 'error'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                              : 'bg-gray-500/20 text-gray-400 border border-gray-500/40'
                          }`}>
                            {action.status === 'success' ? '✓' : action.status === 'error' ? '✗' : '○'} {action.status.toUpperCase()}
                          </span>
                          <span className="text-[#FFC300] font-semibold">{action.action}</span>
                        </div>
                        <div className="text-white text-sm">{action.message}</div>
                        {action.filesDeleted && (
                          <div className="text-[#48CAE4] text-xs mt-1">
                            Files deleted: {action.filesDeleted}
                          </div>
                        )}
                        {action.spaceSaved > 0 && (
                          <div className="text-[#4CAF50] text-xs mt-1 font-semibold">
                            💾 Saved: {formatBytes(action.spaceSaved)}
                          </div>
                        )}
                      </div>
                    </div>
                    {action.errors && action.errors.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-gray-400 text-xs cursor-pointer hover:text-white">
                          Show errors ({action.errors.length})
                        </summary>
                        <div className="mt-2 text-red-400 text-xs space-y-1 max-h-32 overflow-y-auto">
                          {action.errors.slice(0, 5).map((err, i) => (
                            <div key={i} className="ml-4">• {err}</div>
                          ))}
                          {action.errors.length > 5 && (
                            <div className="ml-4 text-gray-500">... and {action.errors.length - 5} more</div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>

              {/* Errors Summary (if any) */}
              {optimizationResult.errors && optimizationResult.errors.length > 0 && (
                <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <div className="text-red-400 font-semibold mb-2">⚠️ Some issues occurred:</div>
                  {optimizationResult.errors.map((error, index) => (
                    <div key={index} className="text-red-300 text-sm ml-4">• {error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* CPU Details View */}
      {selectedView === 'cpu' && metrics && (
        <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6] animate-fadeIn">
          <h3 className="text-[#FFC300] text-2xl font-bold mb-6">CPU Details</h3>
          
          {/* Overall CPU Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="transform transition-all duration-300 hover:scale-105">
              <div className="text-gray-400 text-sm">Total Load</div>
              <div className="text-white text-2xl font-bold">{metrics.cpu.currentLoad}%</div>
            </div>
            <div className="transform transition-all duration-300 hover:scale-105">
              <div className="text-gray-400 text-sm">User</div>
              <div className="text-white text-2xl font-bold">{metrics.cpu.currentLoadUser}%</div>
            </div>
            <div className="transform transition-all duration-300 hover:scale-105">
              <div className="text-gray-400 text-sm">System</div>
              <div className="text-white text-2xl font-bold">{metrics.cpu.currentLoadSystem}%</div>
            </div>
            <div className="transform transition-all duration-300 hover:scale-105">
              <div className="text-gray-400 text-sm">Idle</div>
              <div className="text-white text-2xl font-bold">{metrics.cpu.currentLoadIdle}%</div>
            </div>
          </div>

          {/* Per-Core Breakdown */}
          <h4 className="text-[#FFC300] text-lg font-bold mb-4">Per-Core Usage</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {metrics.cpu.coresLoad.map((core, index) => (
              <div key={index} className="bg-[#001D3D] rounded-lg p-4 transform transition-all duration-300 hover:scale-105">
                <div className="text-[#FFC300] text-sm font-semibold mb-2">Core {index}</div>
                <div className="text-white text-xl font-bold">{core.load}%</div>
                <div className="text-gray-400 text-xs mt-1">
                  User: {core.loadUser}% | Sys: {core.loadSystem}%
                </div>
                {/* Visual bar */}
                <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                  <div
                    className="bg-[#FFC300] h-2 rounded-full transition-all duration-500"
                    style={{ width: `${core.load}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Memory Details View */}
      {selectedView === 'memory' && metrics && (
        <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6] animate-fadeIn">
          <h3 className="text-[#FFC300] text-2xl font-bold mb-6">Memory Details</h3>
          
          {/* Memory Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="transform transition-all duration-300 hover:scale-105">
              <div className="text-gray-400 text-sm">Total</div>
              <div className="text-white text-xl font-bold">{formatBytes(metrics.memory.total)}</div>
            </div>
            <div className="transform transition-all duration-300 hover:scale-105">
              <div className="text-gray-400 text-sm">Used</div>
              <div className="text-white text-xl font-bold">{formatBytes(metrics.memory.used)}</div>
            </div>
            <div className="transform transition-all duration-300 hover:scale-105">
              <div className="text-gray-400 text-sm">Free</div>
              <div className="text-white text-xl font-bold">{formatBytes(metrics.memory.free)}</div>
            </div>
            <div className="transform transition-all duration-300 hover:scale-105">
              <div className="text-gray-400 text-sm">Available</div>
              <div className="text-white text-xl font-bold">{formatBytes(metrics.memory.available)}</div>
            </div>
          </div>

          {/* Visual Memory Bar */}
          <div className="mb-6">
            <div className="text-white mb-2">Memory Usage: {metrics.memory.usagePercent}%</div>
            <div className="w-full bg-gray-700 rounded-full h-6">
              <div
                className="bg-gradient-to-r from-[#00B4D8] to-[#0077B6] h-6 rounded-full transition-all duration-500 flex items-center justify-center text-white text-sm font-bold"
                style={{ width: `${metrics.memory.usagePercent}%` }}
              >
                {metrics.memory.usagePercent}%
              </div>
            </div>
          </div>

          {/* Swap Memory */}
          {metrics.memory.swapTotal > 0 && (
            <div>
              <h4 className="text-[#FFC300] text-lg font-bold mb-4">Swap Memory</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-gray-400 text-sm">Total</div>
                  <div className="text-white text-lg font-bold">{formatBytes(metrics.memory.swapTotal)}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Used</div>
                  <div className="text-white text-lg font-bold">{formatBytes(metrics.memory.swapUsed)}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Free</div>
                  <div className="text-white text-lg font-bold">{formatBytes(metrics.memory.swapFree)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Processes View */}
      {selectedView === 'processes' && (
        <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6] animate-fadeIn">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[#FFC300] text-2xl font-bold">
              Running Processes {processes.length > 0 && (showAllProcesses ? `(All ${processes.length})` : `(Top 20 of ${processes.length})`)}
            </h3>
            <div className="flex space-x-2">
              {processes.length > 20 && (
                <button
                  onClick={() => setShowAllProcesses(!showAllProcesses)}
                  className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-4 py-2 rounded transition-all duration-300 transform hover:scale-105"
                >
                  {showAllProcesses ? 'Show Top 20' : 'Show All'}
                </button>
              )}
              <button
                onClick={fetchProcesses}
                disabled={isRefreshingProcesses}
                className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-4 py-2 rounded transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isRefreshingProcesses ? (
                  <>
                    <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Refreshing...
                  </>
                ) : (
                  '🔄 Refresh'
                )}
              </button>
            </div>
          </div>

          {/* Search Filter */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="🔍 Search processes (e.g., VS Code, Chrome, electron)..."
              value={processSearchTerm}
              onChange={(e) => setProcessSearchTerm(e.target.value)}
              className="w-full px-4 py-2 bg-[#001D3D] border border-[#48CAE4]/30 text-white placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48CAE4] transition-all duration-150"
            />
            {processSearchTerm && (
              <div className="mt-2 text-[#48CAE4] text-sm">
                Found {processes.filter(p => {
                  const searchLower = processSearchTerm.toLowerCase();
                  const nameMatch = p.name && p.name.toLowerCase().includes(searchLower);
                  const commandMatch = p.command && p.command.toLowerCase().includes(searchLower);
                  return nameMatch || commandMatch;
                }).length} matching processes
              </div>
            )}
          </div>
          
          {isRefreshingProcesses && processes.length === 0 ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#FFD60A]"></div>
              <div className="text-white mt-2">Loading processes...</div>
            </div>
          ) : processes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-white">
                <thead>
                  <tr className="border-b-2 border-[#0077B6]">
                    <th className="text-left py-2 px-4">PID</th>
                    <th className="text-left py-2 px-4">Name</th>
                    <th className="text-right py-2 px-4">CPU %</th>
                    <th className="text-right py-2 px-4">Memory</th>
                    <th className="text-right py-2 px-4">Memory %</th>
                    <th className="text-center py-2 px-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Filter processes based on search term (check both name and command)
                    const filteredProcesses = processSearchTerm
                      ? processes.filter(p => {
                          const searchLower = processSearchTerm.toLowerCase();
                          const nameMatch = p.name && p.name.toLowerCase().includes(searchLower);
                          const commandMatch = p.command && p.command.toLowerCase().includes(searchLower);
                          return nameMatch || commandMatch;
                        })
                      : processes;
                    
                    // Show top 20 or all based on toggle (unless searching)
                    const displayProcesses = processSearchTerm 
                      ? filteredProcesses 
                      : (showAllProcesses ? filteredProcesses : filteredProcesses.slice(0, 20));
                    
                    return displayProcesses.map((proc) => (
                      <tr key={proc.pid} className="border-b border-[#0077B6] hover:bg-[#001D3D] transition-colors duration-200">
                        <td className="py-2 px-4">{proc.pid}</td>
                        <td className="py-2 px-4 max-w-xs truncate" title={proc.command}>{proc.name}</td>
                        <td className={`py-2 px-4 text-right font-mono ${
                          parseFloat(proc.cpu || 0) > 50 ? 'text-red-400' :
                          parseFloat(proc.cpu || 0) > 20 ? 'text-orange-400' :
                          parseFloat(proc.cpu || 0) > 5 ? 'text-yellow-400' : 'text-white'
                        }`}>
                          {proc.cpu !== undefined && proc.cpu !== null ? `${proc.cpu}%` : '0.00%'}
                        </td>
                        <td className="py-2 px-4 text-right">{formatBytes(proc.memory || 0)}</td>
                        <td className="py-2 px-4 text-right">
                          {proc.memoryPercent !== undefined && proc.memoryPercent !== null ? `${proc.memoryPercent}%` : '0.00%'}
                        </td>
                        <td className="py-2 px-4 text-center">
                          <button
                            onClick={() => handleEndProcess(proc.pid, proc.name)}
                            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm transition-all duration-300 transform hover:scale-110"
                          >
                            End Task
                          </button>
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">
              No processes found. Please wait...
            </div>
          )}
        </div>
      )}

      {/* Storage & Apps View */}
      {selectedView === 'storage' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Disk Usage Overview */}
          {storageAnalysis?.disks && (
            <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6]">
              <h3 className="text-[#FFC300] text-2xl font-bold mb-4">Disk Usage</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {storageAnalysis.disks.map((disk, index) => (
                  <div key={index} className="bg-[#001D3D] rounded-lg p-4 transform transition-all duration-300 hover:scale-105">
                    <div className="text-[#FFD60A] font-semibold mb-2">{disk.mount} ({disk.fs})</div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Total:</span>
                        <span className="text-white">{disk.sizeFormatted}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Used:</span>
                        <span className="text-white">{disk.usedFormatted}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Available:</span>
                        <span className="text-white">{disk.availableFormatted}</span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-3 mt-2">
                        <div 
                          className={`h-3 rounded-full transition-all duration-500 ${disk.usePercent > 80 ? 'bg-red-500' : disk.usePercent > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${disk.usePercent}%` }}
                        ></div>
                      </div>
                      <div className="text-center text-white font-bold">{disk.usePercent}% Used</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Installed Applications */}
          <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6]">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-[#FFC300] text-2xl font-bold">Installed Applications</h3>
                <p className="text-gray-400 text-sm mt-1">
                  {installedApps.length > 0 
                    ? `${installedApps.length} applications found` 
                    : 'Click Refresh to scan your installed applications'}
                </p>
              </div>
              <button
                onClick={() => fetchInstalledApps(true)}
                disabled={isLoadingApps}
                className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-4 py-2 rounded transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isLoadingApps ? (
                  <>
                    <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Scanning...
                  </>
                ) : (
                  '🔄 Refresh'
                )}
              </button>
            </div>
            
            {isLoadingApps ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#FFD60A]"></div>
                <div className="text-white mt-2">Scanning installed applications...</div>
                <div className="text-gray-400 text-sm mt-1">This may take 10-15 seconds</div>
              </div>
            ) : installedApps.length > 0 ? (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-white">
                  <thead className="sticky top-0 bg-[#003566]">
                    <tr className="border-b-2 border-[#0077B6]">
                      <th className="text-left py-2 px-4">Application</th>
                      <th className="text-left py-2 px-4">Version</th>
                      <th className="text-left py-2 px-4">Publisher</th>
                      <th className="text-right py-2 px-4">Size</th>
                      <th className="text-right py-2 px-4">Install Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installedApps.map((app, index) => (
                      <tr key={index} className="border-b border-[#0077B6] hover:bg-[#001D3D] transition-colors duration-200">
                        <td className="py-2 px-4 max-w-xs truncate" title={app.name}>{app.name}</td>
                        <td className="py-2 px-4">{app.version}</td>
                        <td className="py-2 px-4 max-w-xs truncate" title={app.publisher}>{app.publisher}</td>
                        <td className="py-2 px-4 text-right">{app.sizeFormatted}</td>
                        <td className="py-2 px-4 text-right">{app.installDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-gray-400 text-sm mt-4">
                  Total: {installedApps.length} applications
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400 py-8">
                No applications found. Click Refresh to scan.
              </div>
            )}
          </div>

          {/* Large Files & Folders */}
          <div className="bg-[#003566] rounded-lg p-6 border-2 border-[#0077B6]">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-[#FFC300] text-2xl font-bold">File Management</h3>
                <p className="text-gray-400 text-sm">Scan and manage files by size</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <label className="text-white text-sm font-semibold">File Size:</label>
                  <select
                    value={fileSizeFilter}
                    onChange={(e) => setFileSizeFilter(e.target.value)}
                    className="bg-[#001D3D] text-white px-3 py-2 rounded border border-[#0077B6] focus:border-[#FFD60A] focus:outline-none transition-colors"
                  >
                    <option value="large">Large Files (≥ 100 MB)</option>
                    <option value="medium">Medium Files (≥ 10 MB)</option>
                    <option value="small">Small Files (≥ 1 MB)</option>
                    <option value="all">All Files (≥ 1 MB)</option>
                    <option value="custom">Custom Size →</option>
                  </select>
                </div>
                {fileSizeFilter === 'custom' && (
                  <div className="flex items-center space-x-2">
                    <label className="text-white text-sm">Min Size (MB):</label>
                    <input
                      type="number"
                      value={minFileSize}
                      onChange={(e) => setMinFileSize(parseInt(e.target.value) || 1)}
                      className="bg-[#001D3D] text-white px-3 py-2 rounded w-24 border border-[#0077B6] focus:border-[#FFD60A] focus:outline-none transition-colors"
                      min="1"
                      max="10000"
                    />
                  </div>
                )}
                <button
                  onClick={() => {
                    // Set minFileSize based on filter
                    let size = minFileSize;
                    if (fileSizeFilter === 'large') size = 100;
                    else if (fileSizeFilter === 'medium') size = 10;
                    else if (fileSizeFilter === 'small') size = 1;
                    else if (fileSizeFilter === 'all') size = 1;
                    else if (fileSizeFilter === 'custom') size = minFileSize; // Use custom value
                    
                    // Update state
                    setMinFileSize(size);
                    
                    // Use the new size directly in fetchStorageAnalysis
                    fetchStorageAnalysis(size);
                  }}
                  disabled={isLoadingStorage}
                  className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-6 py-2 rounded font-semibold transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center shadow-lg"
                >
                  {isLoadingStorage ? (
                    <>
                      <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Scanning...
                    </>
                  ) : storageAnalysis ? (
                    '� Scan Again'
                  ) : (
                    '🔍 Start Scan'
                  )}
                </button>
              </div>
            </div>

            {isLoadingStorage ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#FFD60A]"></div>
                <div className="text-white mt-2">Analyzing storage... This may take a few moments</div>
              </div>
            ) : storageAnalysis ? (
              <div className="space-y-6">
                {/* Top Folders by Size */}
                {storageAnalysis.topFolders.length > 0 && (
                  <div>
                    <h4 className="text-[#FFD60A] font-semibold mb-3">Top Folders by Size</h4>
                    <div className="space-y-2">
                      {storageAnalysis.topFolders.map((folder, index) => (
                        <div key={index} className="bg-[#001D3D] rounded p-3 flex justify-between items-center transition-all duration-300 hover:bg-[#002447]">
                          <span className="text-white text-sm truncate flex-1" title={folder.path}>
                            {folder.path}
                          </span>
                          <div className="flex items-center space-x-3">
                            <span className="text-[#FFD60A] font-bold">{folder.sizeFormatted}</span>
                            <div className="flex space-x-1">
                              <button
                                onClick={() => handleOpenFolder(folder.path)}
                                className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110"
                                title="Open folder"
                              >
                                📂 Open
                              </button>
                              <button
                                onClick={() => handleShowInFolder(folder.path)}
                                className="bg-[#8B4513] hover:bg-[#A0522D] text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110"
                                title="Show in Explorer"
                              >
                                📁
                              </button>
                              <button
                                onClick={() => handleDeleteFolder(folder.path, folder.path.split('\\').pop())}
                                className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110"
                                title="Delete folder"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Large Files */}
                {storageAnalysis.largeFiles && storageAnalysis.largeFiles.length > 0 && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-[#FFD60A] font-semibold">
                        Files Found: {storageAnalysis.largeFiles.length} total
                      </h4>
                      <button
                        onClick={() => {
                          console.log('Toggle showAllFiles. Current:', showAllFiles, 'Total files:', storageAnalysis.largeFiles.length);
                          setShowAllFiles(!showAllFiles);
                        }}
                        className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-3 py-1 rounded text-sm transition-all duration-300 transform hover:scale-105"
                      >
                        {showAllFiles ? '📋 Show Top 20' : '📊 Show All Files'}
                      </button>
                    </div>
                    <div className="text-gray-400 text-xs mb-2">
                      {showAllFiles 
                        ? `Displaying all ${storageAnalysis.largeFiles.length} files`
                        : `Displaying top ${Math.min(20, storageAnalysis.largeFiles.length)} of ${storageAnalysis.largeFiles.length} files`
                      }
                    </div>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      <table className="w-full text-white text-sm">
                        <thead className="sticky top-0 bg-[#003566] z-10">
                          <tr className="border-b-2 border-[#0077B6]">
                            <th className="text-left py-2 px-4">File Name</th>
                            <th className="text-left py-2 px-4">Type</th>
                            <th className="text-right py-2 px-4">Size</th>
                            <th className="text-left py-2 px-4">Location</th>
                            <th className="text-center py-2 px-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(showAllFiles ? storageAnalysis.largeFiles : storageAnalysis.largeFiles.slice(0, 20)).map((file, index) => (
                            <tr key={index} className="border-b border-[#0077B6] hover:bg-[#001D3D] transition-colors duration-200">
                              <td className="py-2 px-4 max-w-xs truncate" title={file.name}>{file.name}</td>
                              <td className="py-2 px-4">{file.type}</td>
                              <td className="py-2 px-4 text-right font-bold text-[#FFD60A]">{file.sizeFormatted}</td>
                              <td className="py-2 px-4 max-w-md truncate text-xs text-gray-400" title={file.path}>
                                {file.path}
                              </td>
                              <td className="py-2 px-4 text-center">
                                <div className="flex space-x-1 justify-center">
                                  <button
                                    onClick={() => handleOpenFile(file.path)}
                                    className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110"
                                    title="Open file"
                                  >
                                    Open
                                  </button>
                                  <button
                                    onClick={() => handleShowInFolder(file.path)}
                                    className="bg-[#8B4513] hover:bg-[#A0522D] text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110"
                                    title="Show in folder"
                                  >
                                    📁
                                  </button>
                                  <button
                                    onClick={() => handleDeleteFile(file.path, file.name)}
                                    className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110"
                                    title="Delete file"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {storageAnalysis.largeFiles && storageAnalysis.largeFiles.length === 0 && (
                  <div className="text-center text-gray-400 py-8">
                    No files found matching the size criteria. Try adjusting the filter.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-8">
                Click &quot;Scan&quot; to analyze your storage and find large files
              </div>
            )}
          </div>
        </div>
      )}

      {/* Logs View */}
      {selectedView === 'logs' && (
        <div className="animate-fadeIn">
          <LogsViewer />
        </div>
      )}

      {/* Battery View */}
      {selectedView === 'battery' && (
        <div className="animate-fadeIn">
          <BatteryCenter />
        </div>
      )}
    </div>
  );
};

export default Dashboard;
