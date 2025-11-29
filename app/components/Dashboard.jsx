import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Loader2, RefreshCw, Search, AlertTriangle, FolderOpen, Folder, Trash2, List, LayoutGrid, ExternalLink, FileText } from 'lucide-react';

const MAX_CHART_POINTS = 180; // Keep roughly six minutes of data on screen
const formatTimeLabel = (timestamp) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Lazy load heavy components to improve performance
const LogsViewer = lazy(() => import('./LogsViewer'));
const BatteryCenter = lazy(() => import('./BatteryCenter'));
const FilesManager = lazy(() => import('./FilesManager/FilesManager'));
const BackupManager = lazy(() => import('./BackupManager'));

const Dashboard = () => {
  const [metrics, setMetrics] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false); // Changed to false for instant UI
  const [error, setError] = useState(null);
  const [selectedView, setSelectedView] = useState('overview'); // overview, cpu, memory, processes, storage, files, logs, battery
  const [autoRefresh, setAutoRefresh] = useState(true); // Enable/disable auto-refresh - DEFAULT ON for real-time updates
  const refreshInterval = 2000; // 2 seconds for smooth real-time updates
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now());
  const [currentTime, setCurrentTime] = useState(Date.now()); // Track current time for live uptime
  const [installedApps, setInstalledApps] = useState([]);
  const [storageAnalysis, setStorageAnalysis] = useState(null);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [minFileSize, setMinFileSize] = useState(100); // MB
  const [showAllFiles, setShowAllFiles] = useState(true); // Show all files by default
  const [showAllProcesses, setShowAllProcesses] = useState(false); // Show all processes or just top 20
  const [isRefreshingProcesses, setIsRefreshingProcesses] = useState(false);
  const [isProcessesInitialLoading, setIsProcessesInitialLoading] = useState(false); // Start as false - never block UI
  const [fileSizeFilter, setFileSizeFilter] = useState('large'); // 'large', 'small', or 'all'
  const [processSearchTerm, setProcessSearchTerm] = useState(''); // Search filter for processes
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(''); // Debounced search term
  const [optimizationResult, setOptimizationResult] = useState(null); // Store last optimization result
  const resultsRef = useRef(null); // Reference to scroll to results
  const searchDebounceTimer = useRef(null); // Timer for debouncing search

  // Debounce search input to prevent UI blocking
  useEffect(() => {
    // Clear previous timer
    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }
    
    // Set new timer - only update after 300ms of no typing
    searchDebounceTimer.current = setTimeout(() => {
      setDebouncedSearchTerm(processSearchTerm);
    }, 300);
    
    // Cleanup on unmount
    return () => {
      if (searchDebounceTimer.current) {
        clearTimeout(searchDebounceTimer.current);
      }
    };
  }, [processSearchTerm]);

  // Fetch system metrics
  const fetchMetrics = async () => {
    if (isFetching) {
      console.log('[Dashboard] Skipping fetch - already fetching');
      return; // Prevent overlapping calls
    }
    
    try {
      console.log('[Dashboard] Fetching metrics...');
      setIsFetching(true);
      const result = await window.electronAPI.system.getMetrics();
      if (result.success && result.data) {
        // Validate that we have meaningful data (not all zeros)
        const cpuValid = result.data.cpu && parseFloat(result.data.cpu.currentLoad) >= 0;
        const memValid = result.data.memory && parseFloat(result.data.memory.usagePercent) >= 0;
        const hasValidData = cpuValid && memValid;
        
        if (hasValidData) {
          console.log('[Dashboard] Metrics received - CPU:', result.data.cpu.currentLoad + '%', 
                      'Memory:', result.data.memory.usagePercent + '%', 
                      'Disk:', result.data.disk[0]?.use + '%',
                      'History points:', result.data.history.timestamps.length);
          
          // Force NEW object references at every level to ensure React detects changes
          setMetrics({
            cpu: { ...result.data.cpu },
            memory: { ...result.data.memory },
            disk: [...result.data.disk],
            processes: { ...result.data.processes },
            system: { ...result.data.system },
            timestamp: Date.now(),
            history: {
              cpu: [...result.data.history.cpu],
              memory: [...result.data.history.memory],
              disk: [...result.data.history.disk],
              timestamps: [...result.data.history.timestamps]
            }
          });
          setLastUpdateTime(Date.now());
          setError(null);
        } else {
          console.warn('[Dashboard] Invalid metrics data received, keeping previous values');
          // Don't update if data is invalid - keep showing last good values
        }
      } else {
        throw new Error(result.error || 'Failed to fetch metrics');
      }
    } catch (error) {
      console.error('[Dashboard] Error fetching metrics:', error);
      // Only set error if we don't have any metrics yet
      if (!metrics) {
        setError(error.message);
      }
    } finally {
      setIsFetching(false);
    }
  };

  // Fetch process list (manual refresh) - Force fresh data with CPU enrichment
  const fetchProcesses = async () => {
    if (isRefreshingProcesses) return; // Prevent double-click
    
    setIsRefreshingProcesses(true);
    console.log('[Dashboard] 🔄 Manual refresh triggered');
    
    try {
      // First get instant data for immediate visual feedback
      const instantResult = await window.electronAPI.system.getProcesses({ instant: true });
      if (instantResult.success && instantResult.data?.length > 0) {
        setProcesses(instantResult.data);
        console.log('[Dashboard] ⚡ Instant refresh:', instantResult.data.length, 'processes');
      }
      
      // Then get CPU-enriched data for accurate percentages
      const enrichedResult = await window.electronAPI.system.getProcesses({ freshFetch: true });
      if (enrichedResult.success && enrichedResult.data?.length > 0) {
        setProcesses(enrichedResult.data);
        console.log('[Dashboard] ✅ Enriched refresh:', enrichedResult.data.length, 'processes');
      }
    } catch (error) {
      console.error('[Dashboard] ❌ Refresh error:', error);
    } finally {
      setIsRefreshingProcesses(false);
    }
  };

  // Note: Process loading is handled in the streaming useEffect below for better coordination

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
        
        // Pre-fetch storage data in background for instant loading when user navigates to Storage tab
        console.log('🚀 Pre-loading storage data in background...');
        // Run both in parallel for faster loading
        Promise.all([
          fetchInstalledApps(true).catch(err => console.warn('Background apps fetch error:', err)),
          fetchStorageAnalysis(100).catch(err => console.warn('Background storage fetch error:', err))
        ]).then(() => {
          console.log('✅ Storage data pre-loaded successfully');
        });
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
      if (!isFetching && autoRefresh) {
        fetchMetrics();
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, loading, isFetching, autoRefresh]);

  // Update current time every second for real-time uptime display
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);
  
  // Real-time process streaming when Processes tab is active - ROBUST implementation
  useEffect(() => {
    if (selectedView !== 'processes') {
      // Stop streaming when leaving processes view
      window.electronAPI.system.stopProcessStream().catch(() => {});
      window.electronAPI.system.setTabVisibility(false);
      return;
    }
    
    console.log('[Processes] Tab selected - starting ROBUST loading');
    window.electronAPI.system.setTabVisibility(true);
    
    let isMounted = true;
    
    // IMMEDIATE: Set up stream listener FIRST before any API calls
    const handleProcessUpdate = (result) => {
      if (!isMounted) return;
      if (result?.success && Array.isArray(result.data) && result.data.length > 0) {
        console.log('[Processes] Stream update:', result.data.length, 'processes');
        setProcesses(result.data);
      }
    };
    
    window.electronAPI.system.onProcessUpdate(handleProcessUpdate);
    
    // Fire all data loading in parallel - don't wait for anything
    // Method 1: Direct instant fetch
    window.electronAPI.system.getProcesses({ instant: true })
      .then(result => {
        if (isMounted && result?.success && result.data?.length > 0) {
          console.log('[Processes] ⚡ Direct instant:', result.data.length);
          setProcesses(result.data);
        }
      })
      .catch(err => console.warn('[Processes] Direct instant error:', err));
    
    // Method 2: Start stream (also sends instant data)
    window.electronAPI.system.startProcessStream()
      .then(result => {
        if (result?.success) {
          console.log('[Processes] Stream started');
        }
      })
      .catch(err => console.warn('[Processes] Stream start error:', err));
    
    // Method 3: Fallback - fetch with CPU enrichment after 500ms
    const fallbackTimer = setTimeout(() => {
      if (isMounted) {
        window.electronAPI.system.getProcesses({ freshFetch: true })
          .then(result => {
            if (isMounted && result?.success && result.data?.length > 0) {
              console.log('[Processes] Fallback fetch:', result.data.length);
              setProcesses(result.data);
            }
          })
          .catch(() => {});
      }
    }, 500);
    
    // Cleanup
    return () => {
      isMounted = false;
      clearTimeout(fallbackTimer);
      window.electronAPI.system.stopProcessStream().catch(() => {});
      window.electronAPI.system.removeProcessUpdateListener();
      window.electronAPI.system.setTabVisibility(false);
    };
  }, [selectedView]);

  // Auto-fetch installed apps AND storage analysis when switching to storage view - ONE TIME ONLY
  useEffect(() => {
    if (selectedView === 'storage' && !loading) {
      // Auto-load installed apps if not already loaded
      if (installedApps.length === 0 && !isLoadingApps) {
        console.log('💾 Storage view selected - loading installed apps (one time)');
        fetchInstalledApps(true);
      }
      // Auto-load storage analysis if not already loaded
      if (!storageAnalysis && !isLoadingStorage) {
        console.log('💾 Storage view selected - loading storage analysis (one time)');
        // Default to 'large' filter (100 MB) for initial auto-scan
        fetchStorageAnalysis(100);
      }
    }
  }, [selectedView, loading, installedApps.length, isLoadingApps, storageAnalysis, isLoadingStorage]);

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
    // Count how many processes with the same name exist
    const sameNameProcesses = processes.filter(p => p.name === processName);
    const hasMultiple = sameNameProcesses.length > 1;
    
    let confirmMessage = `Are you sure you want to end "${processName}" (PID: ${pid})?`;
    
    if (hasMultiple) {
      confirmMessage += `\n\n⚠️ Note: There are ${sameNameProcesses.length} "${processName}" processes running.\n\n` +
        `Click "OK" to end just this one process (PID: ${pid}), or\n` +
        `Click "Cancel" then try "End All" option if you want to end all ${sameNameProcesses.length} processes.`;
    }
    
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      const result = await window.electronAPI.system.endProcess(pid, false);
      if (result.success && result.data.success) {
        alert(`Process ${processName} (PID: ${pid}) ended successfully`);
        // Clear search term to avoid stuck state
        setProcessSearchTerm('');
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

  // Handle end all processes with the same name
  const handleEndAllProcessesByName = async (processName) => {
    const sameNameProcesses = processes.filter(p => p.name === processName);
    
    if (!confirm(`Are you sure you want to end ALL ${sameNameProcesses.length} "${processName}" processes?\n\n` +
        `This will terminate all running instances and their child processes.`)) {
      return;
    }

    try {
      const result = await window.electronAPI.system.endProcessByName(processName);
      if (result.success && result.data.success) {
        alert(`All "${processName}" processes terminated successfully`);
        // Clear search term to avoid stuck state
        setProcessSearchTerm('');
        await fetchProcesses();
        await fetchMetrics();
      } else {
        alert('Failed to end processes: ' + (result.data?.message || result.error));
      }
    } catch (error) {
      console.error('Error ending processes:', error);
      alert('Error ending processes: ' + error.message);
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

  const latestHistoryTimestamp = metrics?.history?.timestamps?.length
    ? metrics.history.timestamps[metrics.history.timestamps.length - 1]
    : null;

  // Prepare chart data with memoization - only keep recent points for performance
  const chartData = useMemo(() => {
    if (!metrics?.history?.timestamps || metrics.history.timestamps.length === 0) {
      return [];
    }

    const { cpu, memory, timestamps } = metrics.history;
    const startIndex = Math.max(0, timestamps.length - MAX_CHART_POINTS);

    const data = [];
    for (let i = startIndex; i < timestamps.length; i++) {
      const cpuVal = typeof cpu[i] === 'number' ? cpu[i] : parseFloat(cpu[i]) || 0;
      const memVal = typeof memory[i] === 'number' ? memory[i] : parseFloat(memory[i]) || 0;

      data.push({
        time: formatTimeLabel(timestamps[i]),
        timestamp: timestamps[i],
        cpu: Math.round(cpuVal * 100) / 100,
        memory: Math.round(memVal * 100) / 100,
      });
    }

    return data;
  }, [metrics?.history?.timestamps?.length, latestHistoryTimestamp]);

  // Memoize filtered processes to avoid recalculation on every render
  const filteredProcesses = useMemo(() => {
    if (!processes || processes.length === 0) return [];
    
    // Use debounced search term instead of immediate search term
    if (!debouncedSearchTerm) return processes;
    
    const searchLower = debouncedSearchTerm.toLowerCase();
    return processes.filter(p => {
      const nameMatch = p.name && p.name.toLowerCase().includes(searchLower);
      const commandMatch = p.command && p.command.toLowerCase().includes(searchLower);
      return nameMatch || commandMatch;
    });
  }, [processes, debouncedSearchTerm]); // Use debouncedSearchTerm

  // Memoize displayed processes for the table (optimized for performance)
  const displayedProcesses = useMemo(() => {
    if (debouncedSearchTerm) {
      // When searching, limit to first 50 results for performance
      return filteredProcesses.slice(0, 50);
    }
    // Default: show only top 20 processes unless explicitly requested
    return showAllProcesses ? filteredProcesses.slice(0, 100) : filteredProcesses.slice(0, 20);
  }, [filteredProcesses, showAllProcesses, debouncedSearchTerm]);

  // No more full-screen loading - show UI immediately with loading indicators

  if (error && !metrics) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814] flex items-center justify-center p-6">
        <div className="bg-[#003566] rounded-lg p-8 border-2 border-red-500 max-w-md">
          <h2 className="text-red-500 text-2xl font-bold mb-4 flex items-center gap-2"><AlertTriangle className="w-7 h-7" /> Error Loading Metrics</h2>
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
          <h3 className="text-[#FFD60A] font-bold mb-2 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Optimization Suggestions</h3>
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
          onClick={() => setSelectedView('files')}
          className={`px-6 py-2 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
            selectedView === 'files'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-[#003566] text-white hover:bg-[#004A7F]'
          }`}
        >
          File Management+
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
                  <div key={metrics.timestamp} className="text-white text-4xl font-bold mb-2">
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
                  <div key={metrics.timestamp} className="text-white text-4xl font-bold mb-2">
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
                  <div key={metrics.timestamp} className="text-white text-4xl font-bold mb-2">
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
            {chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0077B6" />
                  <XAxis 
                    dataKey="time" 
                    stroke="#FFC300"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                    angle={-45}
                    textAnchor="end"
                    height={60}
                    minTickGap={5}
                  />
                  <YAxis stroke="#FFC300" domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#001D3D',
                      border: '2px solid #0077B6',
                      borderRadius: '8px',
                    }}
                    labelFormatter={(label, payload) => {
                      if (payload && payload.length > 0) {
                        const ts = payload[0].payload?.timestamp;
                        return ts ? formatTimeLabel(ts) : label;
                      }
                      return label;
                    }}
                    formatter={(value, name) => {
                      // Ensure values are displayed with max 2 decimal places
                      const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
                      return [numValue.toFixed(2) + '%', name];
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
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="memory"
                    stroke="#00B4D8"
                    name="Memory %"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-slate-400">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#FFC300] border-t-transparent mx-auto mb-4"></div>
                  <p>Loading chart data...</p>
                </div>
              </div>
            )}
          </div>

          {/* Last Update Info */}
          <div className="text-center text-gray-400 text-sm mb-4">
            <span className="inline-flex items-center">
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></span>
              {autoRefresh ? 'Live updating every 2s' : 'Auto-refresh disabled'}
              {metrics && ` • Last updated: ${new Date(lastUpdateTime).toLocaleTimeString()}`}
            </span>
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
                  <Loader2 className="animate-spin h-5 w-5 mr-3" />
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
                  <div className="text-red-400 font-semibold mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Some issues occurred:</div>
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
            <div>
              <h3 className="text-[#FFC300] text-2xl font-bold">
                Running Processes {processes.length > 0 && `(${processes.length})`}
                {displayedProcesses.length < filteredProcesses.length && (
                  <span className="text-sm text-gray-400 ml-2">
                    - showing {displayedProcesses.length}
                  </span>
                )}
              </h3>
            </div>
            <div className="flex space-x-2">
              {filteredProcesses.length > 20 && (
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
                className={`px-4 py-2 rounded transition-all duration-300 transform flex items-center gap-2 ${
                  isRefreshingProcesses
                    ? 'bg-[#0096E0]/50 text-white/70 cursor-not-allowed' 
                    : 'bg-[#0077B6] hover:bg-[#0096E0] text-white hover:scale-105'
                }`}
              >
                {isRefreshingProcesses ? (
                  <>
                    <Loader2 className="animate-spin h-4 w-4" />
                    Refreshing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Search Filter */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search processes (e.g., VS Code, Chrome, electron)..."
              value={processSearchTerm}
              onChange={(e) => setProcessSearchTerm(e.target.value)}
              className="w-full px-4 py-2 bg-[#001D3D] border border-[#48CAE4]/30 text-white placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#48CAE4] transition-all duration-150"
            />
            {processSearchTerm && (
              <div className="mt-2 text-[#48CAE4] text-sm">
                Found {filteredProcesses.length} matching processes
              </div>
            )}
          </div>
          
          {isProcessesInitialLoading ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center gap-3 text-[#48CAE4]">
                <Loader2 className="animate-spin h-6 w-6" />
                <span className="text-lg">Loading processes...</span>
              </div>
              <p className="text-gray-400 mt-2 text-sm">Scanning running applications...</p>
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
                  {displayedProcesses.map((proc) => {
                    // Check if multiple processes with same name exist
                    const sameNameCount = processes.filter(p => p.name === proc.name).length;
                    const hasMultiple = sameNameCount > 1;
                    
                    return (
                      <tr key={proc.pid} className="border-b border-[#0077B6] hover:bg-[#001D3D] transition-colors duration-200">
                        <td className="py-2 px-4">{proc.pid}</td>
                        <td className="py-2 px-4 max-w-xs truncate" title={proc.command}>
                          {proc.name}
                          {hasMultiple && <span className="ml-2 text-xs text-yellow-400">({sameNameCount})</span>}
                        </td>
                        <td className={`py-2 px-4 text-right font-mono ${
                          parseFloat(proc.cpu || 0) > 50 ? 'text-red-400' :
                          parseFloat(proc.cpu || 0) > 20 ? 'text-orange-400' :
                          parseFloat(proc.cpu || 0) > 5 ? 'text-yellow-400' : 'text-white'
                        }`}>
                          {proc.cpu !== undefined && proc.cpu !== null ? `${proc.cpu}%` : '0.00%'}
                        </td>
                        <td className="py-2 px-4 text-right">{formatBytes(proc.memory || 0)}</td>
                        <td className={`py-2 px-4 text-right font-mono ${
                          parseFloat(proc.memoryPercent || 0) > 20 ? 'text-red-400' :
                          parseFloat(proc.memoryPercent || 0) > 10 ? 'text-orange-400' :
                          parseFloat(proc.memoryPercent || 0) > 5 ? 'text-yellow-400' : 'text-white'
                        }`}>
                          {proc.memoryPercent !== undefined && proc.memoryPercent !== null && proc.memoryPercent !== '0.00' ? `${proc.memoryPercent}%` : '< 0.01%'}
                        </td>
                        <td className="py-2 px-4 text-center">
                          <div className="flex gap-1 justify-center">
                            <button
                              onClick={() => handleEndProcess(proc.pid, proc.name)}
                              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm transition-all duration-300 transform hover:scale-110"
                            >
                              End Task
                            </button>
                            {hasMultiple && (
                              <button
                                onClick={() => handleEndAllProcessesByName(proc.name)}
                                className="bg-orange-600 hover:bg-orange-700 text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110"
                                title={`End all ${sameNameCount} "${proc.name}" processes`}
                              >
                                End All
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="inline-flex items-center gap-3 text-[#48CAE4]">
                <Loader2 className="animate-spin h-6 w-6" />
                <span className="text-lg">Fetching processes...</span>
              </div>
              <p className="text-gray-400 mt-2 text-sm">This should only take a moment</p>
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
                    : 'Loading your installed applications...'}
                </p>
              </div>
              <button
                onClick={() => fetchInstalledApps(true)}
                disabled={isLoadingApps}
                className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-4 py-2 rounded transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isLoadingApps ? (
                  <>
                    <Loader2 className="animate-spin h-4 w-4 mr-2" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </>
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
                      <Loader2 className="animate-spin h-4 w-4 mr-2" />
                      Scanning...
                    </>
                  ) : storageAnalysis ? (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      Scan Again
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      Start Scan
                    </>
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
                                className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110 flex items-center gap-1"
                                title="Open folder"
                              >
                                <FolderOpen className="w-3 h-3" /> Open
                              </button>
                              <button
                                onClick={() => handleShowInFolder(folder.path)}
                                className="bg-[#8B4513] hover:bg-[#A0522D] text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110 flex items-center justify-center"
                                title="Show in Explorer"
                              >
                                <Folder className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteFolder(folder.path, folder.path.split('\\').pop())}
                                className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110 flex items-center justify-center"
                                title="Delete folder"
                              >
                                <Trash2 className="w-3 h-3" />
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
                        className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-3 py-1 rounded text-sm transition-all duration-300 transform hover:scale-105 flex items-center gap-1"
                      >
                        {showAllFiles ? <><List className="w-4 h-4" /> Show Top 20</> : <><LayoutGrid className="w-4 h-4" /> Show All Files</>}
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
                                    className="bg-[#0077B6] hover:bg-[#0096E0] text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110 flex items-center gap-1"
                                    title="Open file"
                                  >
                                    <ExternalLink className="w-3 h-3" /> Open
                                  </button>
                                  <button
                                    onClick={() => handleShowInFolder(file.path)}
                                    className="bg-[#8B4513] hover:bg-[#A0522D] text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110 flex items-center justify-center"
                                    title="Show in folder"
                                  >
                                    <Folder className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteFile(file.path, file.name)}
                                    className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs transition-all duration-300 transform hover:scale-110 flex items-center justify-center"
                                    title="Delete file"
                                  >
                                    <Trash2 className="w-3 h-3" />
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
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#FFD60A] mb-4"></div>
                <div>Loading storage analysis...</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Files & Data View */}
      {selectedView === 'files' && (
        <div className="animate-fadeIn">
          <Suspense fallback={
            <div className="flex items-center justify-center h-96 bg-[#003566] rounded-lg border-2 border-[#0077B6]">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#FFC300] border-t-transparent mx-auto mb-4"></div>
                <p className="text-white">Loading Files Manager...</p>
              </div>
            </div>
          }>
            <FilesManager />
          </Suspense>
        </div>
      )}

      {/* Logs View */}
      {selectedView === 'logs' && (
        <div className="animate-fadeIn">
          <Suspense fallback={
            <div className="flex items-center justify-center h-96 bg-[#003566] rounded-lg border-2 border-[#0077B6]">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#FFC300] border-t-transparent mx-auto mb-4"></div>
                <p className="text-white">Loading Logs Viewer...</p>
              </div>
            </div>
          }>
            <LogsViewer />
          </Suspense>
        </div>
      )}

      {/* Battery View */}
      {selectedView === 'battery' && (
        <div className="animate-fadeIn">
          <Suspense fallback={
            <div className="flex items-center justify-center h-96 bg-[#003566] rounded-lg border-2 border-[#0077B6]">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#FFC300] border-t-transparent mx-auto mb-4"></div>
                <p className="text-white">Loading Battery Center...</p>
              </div>
            </div>
          }>
            <BatteryCenter />
          </Suspense>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
