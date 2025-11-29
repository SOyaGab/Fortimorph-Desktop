import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { 
  Battery, BatteryCharging, Zap, TrendingUp, TrendingDown, 
  AlertTriangle, AlertCircle, Info, Clock, Cpu, MemoryStick,
  Calendar, CalendarDays, BarChart3, Activity, Trash2, RefreshCw,
  Settings, X, Check, ChevronDown, ChevronUp, Lightbulb, Thermometer, Heart, RotateCcw
} from 'lucide-react';

/**
 * Battery Center Component
 * Displays battery health, trends, alerts, and optimization controls
 * with advanced analytics and customizable settings
 */
const BatteryCenter = () => {
  const [batteryData, setBatteryData] = useState(null);
  const [batteryStats, setBatteryStats] = useState(null);
  const [batteryTrend, setBatteryTrend] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasBattery, setHasBattery] = useState(true);
  
  // Optimization settings
  const [optimizationMode, setOptimizationMode] = useState('balanced');
  const [modeDetails, setModeDetails] = useState(null);
  const [thresholds, setThresholds] = useState({
    criticalBattery: 10,
    lowBattery: 20,
    rapidDrain: 5,
    highTemp: 45,
    cycleWarning: 500,
    healthWarning: 80
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvancedAnalytics, setShowAdvancedAnalytics] = useState(false);
  const [showOptimizationResult, setShowOptimizationResult] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  
  // System health state
  const [systemHealth, setSystemHealth] = useState(null);
  const [showSystemHealth, setShowSystemHealth] = useState(false);
  const [coolingRecommendations, setCoolingRecommendations] = useState(null);
  
  // Usage Insights state
  const [usageInsights, setUsageInsights] = useState(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState('today');
  const [loadingInsights, setLoadingInsights] = useState(false);
  const lastInsightsFetch = useRef(0);
  const insightsFetchDebounce = useRef(null);
  
  // UI state - removed showAll toggles, now displays all apps by default for better UX
  
  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshIntervalRef = useRef(null);
  const healthIntervalRef = useRef(null);
  const insightsIntervalRef = useRef(null);

  /**
   * Load battery data on mount and set up auto-refresh
   * OPTIMIZED: Staggered loading to prevent hanging
   */
  useEffect(() => {
    // Load immediately
    loadBatteryData();
    loadCustomThresholds();
    
    // Stagger other loads to prevent overwhelming the system
    setTimeout(() => loadSystemHealth(), 500);
    setTimeout(() => loadUsageInsights(), 1000);
    
    if (autoRefresh) {
      // Battery data refreshes every 15 seconds
      refreshIntervalRef.current = setInterval(() => {
        loadBatteryData();
      }, 15000);
      
      // System health refreshes every 30 seconds
      healthIntervalRef.current = setInterval(() => {
        loadSystemHealth();
      }, 30000);
      
      // Usage insights refresh every 90 seconds (optimized to reduce system load)
      insightsIntervalRef.current = setInterval(() => {
        loadUsageInsights();
      }, 90000);
    }
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      if (healthIntervalRef.current) {
        clearInterval(healthIntervalRef.current);
      }
      if (insightsIntervalRef.current) {
        clearInterval(insightsIntervalRef.current);
      }
    };
  }, [autoRefresh]);

  /**
   * Load custom thresholds from storage
   */
  const loadCustomThresholds = () => {
    const saved = localStorage.getItem('batteryThresholds');
    if (saved) {
      try {
        setThresholds(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load thresholds:', e);
      }
    }
  };

  /**
   * Save custom thresholds to storage
   */
  const saveCustomThresholds = async (newThresholds) => {
    try {
      // Save to backend
      const result = await window.electron.invoke('battery:updateThresholds', newThresholds);
      
      if (result.success) {
        // Save to localStorage as backup
        localStorage.setItem('batteryThresholds', JSON.stringify(newThresholds));
        setThresholds(newThresholds);
      } else {
        console.error('Failed to save thresholds:', result.error);
        alert('Failed to save settings. Please try again.');
      }
    } catch (err) {
      console.error('Error saving thresholds:', err);
      alert('Failed to save settings. Please try again.');
    }
  };

  /**
   * Run system optimization
   * NOTE: This is DIFFERENT from Battery Optimization Mode (Saver/Balanced/Performance)
   * 
   * System Optimization (this button):
   * - Clears temporary files from your computer
   * - Removes cached data to free up disk space
   * - Runs memory garbage collection
   * - ONE-TIME ACTION to clean up system
   * 
   * Battery Optimization Mode (cards below):
   * - Controls how often the app checks battery status
   * - Saver: Checks every 60 seconds (less CPU usage, saves battery)
   * - Balanced: Checks every 30 seconds (default)
   * - Performance: Checks every 10 seconds (most responsive)
   * - ONGOING MODE that affects monitoring frequency
   */
  const handleOptimizeSystem = async () => {
    try {
      setIsOptimizing(true);
      setError(null);
      
      console.log('Requesting system optimization...');
      const result = await window.electron.invoke('system:optimize');
      
      console.log('Optimization response:', result);
      
      if (result.success) {
        setOptimizationResult(result.data);
        setShowOptimizationResult(true);
        
        // Show success message with summary
        if (result.message || result.warning) {
          console.log(result.message || result.warning);
        }
      } else {
        // Show detailed error message
        const errorMsg = result.error || 'Optimization encountered issues';
        const details = result.data?.actions
          ?.filter(a => a.status === 'error')
          .map(a => a.message)
          .join('\n') || '';
        
        const successfulActions = result.data?.actions?.filter(a => a.status === 'success' || a.status === 'warning') || [];
        
        if (successfulActions.length > 0) {
          // Show partial results
          setOptimizationResult(result.data);
          setShowOptimizationResult(true);
          alert(`Optimization completed with some warnings:\n${errorMsg}${details ? '\n\nDetails:\n' + details : ''}`);
        } else {
          alert(`Optimization failed:\n${errorMsg}${details ? '\n\nDetails:\n' + details : ''}\n\nNote: Some actions may require administrator privileges.`);
        }
      }
    } catch (err) {
      console.error('Error optimizing system:', err);
      setError('Failed to optimize system. Please try again.');
      alert(`Failed to optimize system: ${err.message || 'Unknown error'}\n\nPlease check if you have sufficient permissions.`);
    } finally {
      setIsOptimizing(false);
    }
  };

  /**
   * Load comprehensive battery data
   */
  const loadBatteryData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get comprehensive battery report with timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Battery data request timed out')), 10000)
      );
      
      const reportPromise = window.electron.invoke('battery:getReport');
      const reportResult = await Promise.race([reportPromise, timeoutPromise]);
      
      if (!reportResult.success) {
        setError(reportResult.error || 'Failed to load battery data');
        setHasBattery(false);
        setLoading(false);
        return;
      }
      
      // Merge analytics into current data for easier access
      const currentData = {
        ...reportResult.current,
        analytics: reportResult.analytics
      };
      
      setBatteryData(currentData);
      setBatteryStats(reportResult.stats);
      setBatteryTrend(reportResult.trend || []);
      setAlerts(reportResult.alerts || []);
      setOptimizationMode(reportResult.optimization?.current || 'balanced');
      setModeDetails(reportResult.optimization || null);
      setThresholds(reportResult.thresholds || thresholds);
      setHasBattery(reportResult.current?.hasBattery !== false);
      
    } catch (err) {
      console.error('Failed to load battery data:', err);
      setError(err.message || 'Failed to load battery data');
      // Set a minimal state so UI can still render
      setHasBattery(false);
    } finally {
      // Always set loading to false, even on error
      setLoading(false);
    }
  };

  /**
   * Load system health data
   */
  const loadSystemHealth = async () => {
    try {
      const healthResult = await window.electron.invoke('systemHealth:getReport');
      
      if (healthResult.success) {
        setSystemHealth(healthResult.current);
        setCoolingRecommendations(healthResult.cooling);
      }
    } catch (err) {
      console.error('Failed to load system health data:', err);
    }
  };

  /**
   * Load usage insights data - OPTIMIZED for speed with timeout and debouncing
   */
  const loadUsageInsights = useCallback(async (forceRefresh = false) => {
    try {
      const now = Date.now();
      
      // OPTIMIZATION: Skip if fetched recently (within 3 seconds) unless force refresh
      if (!forceRefresh && (now - lastInsightsFetch.current) < 3000) {
        console.log('[Usage Insights] Skipping - fetched recently');
        return;
      }
      
      // Clear any pending debounced calls
      if (insightsFetchDebounce.current) {
        clearTimeout(insightsFetchDebounce.current);
        insightsFetchDebounce.current = null;
      }
      
      setLoadingInsights(true);
      lastInsightsFetch.current = now;
      
      // If force refresh, clear backend cache first
      if (forceRefresh) {
        console.log('[Usage Insights] Force refresh - clearing backend cache');
        try {
          await window.electron.invoke('battery:clearUsageCache');
        } catch (cacheErr) {
          console.warn('[Usage Insights] Could not clear cache:', cacheErr);
        }
      }
      
      // Add timeout to prevent hanging (8 seconds max for better UX)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Loading timeout - please try refreshing')), 8000)
      );
      
      const dataPromise = window.electron.invoke('battery:getAllTimeframeInsights');
      
      const result = await Promise.race([dataPromise, timeoutPromise]);
      
      if (result.success) {
        setUsageInsights(result.data);
      } else {
        console.error('[Usage Insights] Failed:', result.error);
        // Set empty data on failure
        setUsageInsights({
          today: { apps: [], totalImpact: 0, message: 'No data available', hasRealData: false },
          yesterday: { apps: [], totalImpact: 0, message: 'No data available', hasRealData: false },
          lastWeek: { apps: [], totalImpact: 0, message: 'No data available', hasRealData: false },
          lastMonth: { apps: [], totalImpact: 0, message: 'No data available', hasRealData: false }
        });
      }
    } catch (err) {
      console.error('[Usage Insights] Error:', err);
      // Set empty data on error/timeout
      setUsageInsights({
        today: { apps: [], totalImpact: 0, message: err.message || 'Error loading data', hasRealData: false },
        yesterday: { apps: [], totalImpact: 0, message: 'Error loading data', hasRealData: false },
        lastWeek: { apps: [], totalImpact: 0, message: 'Error loading data', hasRealData: false },
        lastMonth: { apps: [], totalImpact: 0, message: 'Error loading data', hasRealData: false }
      });
    } finally {
      setLoadingInsights(false);
    }
  }, []);

  /**
   * Change optimization mode
   */
  const handleModeChange = async (newMode) => {
    try {
      const result = await window.electron.invoke('battery:setOptimizationMode', newMode);
      
      if (result.success) {
        setOptimizationMode(newMode);
        await loadBatteryData();
      } else {
        alert(`Failed to change mode: ${result.error}`);
      }
    } catch (err) {
      console.error('Error changing optimization mode:', err);
      alert('Failed to change optimization mode');
    }
  };

  /**
   * Clear all alerts
   */
  const handleClearAlerts = async () => {
    try {
      const result = await window.electron.invoke('battery:clearAlerts');
      if (result.success) {
        setAlerts([]);
      }
    } catch (err) {
      console.error('Error clearing alerts:', err);
    }
  };

  /**
   * Dismiss individual alert
   */
  const handleDismissAlert = async (alertId) => {
    try {
      const result = await window.electron.invoke('battery:dismissAlert', alertId);
      if (result.success) {
        setAlerts(alerts.filter(a => a.id !== alertId));
      }
    } catch (err) {
      console.error('Error dismissing alert:', err);
    }
  };

  /**
   * Get battery status color
   */
  const getBatteryColor = () => {
    if (!batteryData) return 'text-gray-400';
    
    if (batteryData.isCharging) return 'text-green-400';
    if (batteryData.percent <= 10) return 'text-red-500';
    if (batteryData.percent <= 20) return 'text-orange-500';
    if (batteryData.percent <= 50) return 'text-yellow-500';
    return 'text-green-400';
  };

  /**
   * Get battery icon component based on percentage
   */
  const getBatteryIconComponent = () => {
    if (!batteryData) return Battery;
    if (batteryData.isCharging) return BatteryCharging;
    return Battery;
  };

  /**
   * Get detailed mode information
   */
  const getModeInfo = (mode) => {
    const modeInfo = {
      saver: {
        icon: '🌙',
        name: 'Battery Saver',
        description: 'Maximize battery life',
        polling: '60 seconds',
        benefits: [
          'Slower polling rate to reduce CPU usage',
          'Extended battery life',
          'Best for low battery situations',
          'Reduces background activity'
        ],
        color: 'from-blue-600 to-blue-800'
      },
      balanced: {
        icon: '⚖️',
        name: 'Balanced',
        description: 'Optimal balance of performance and battery life',
        polling: '30 seconds',
        benefits: [
          'Standard monitoring frequency',
          'Good balance of responsiveness',
          'Suitable for everyday use',
          'Moderate resource usage'
        ],
        color: 'from-green-600 to-green-800'
      },
      performance: {
        icon: '⚡',
        name: 'Performance',
        description: 'Maximum responsiveness',
        polling: '10 seconds',
        benefits: [
          'Fastest polling for real-time updates',
          'Immediate alert notifications',
          'Best for critical battery monitoring',
          'Higher resource usage'
        ],
        color: 'from-orange-600 to-orange-800'
      }
    };
    return modeInfo[mode] || modeInfo.balanced;
  };

  /**
   * Calculate battery health score (0-100)
   * Uses multiple data sources to provide realistic health estimation
   * even when hardware metrics are limited
   */
  const calculateHealthScore = () => {
    if (!batteryData) return null;
    
    // Check what hardware metrics we have
    const hasCapacity = batteryData.capacityPercent != null && batteryData.capacityPercent > 0;
    const hasCycles = batteryData.cycleCount != null && batteryData.cycleCount > 0;
    const hasTemp = batteryData.temperature != null && batteryData.temperature > 0;
    
    // Check if we have performance analytics
    const hasAnalytics = batteryData.analytics?.dischargeAnalysis != null;
    const hasUsageHistory = batteryData.analytics?.usageHistory != null;
    
    // Start with base score
    let score = 100;
    let confidence = 0; // Track how confident we are in the score
    
    // METHOD 1: Use hardware metrics if available (most accurate)
    if (hasCapacity) {
      score -= (100 - batteryData.capacityPercent) * 0.6;
      confidence += 40;
    }
    
    if (hasCycles) {
      const cycleImpact = Math.min((batteryData.cycleCount / 1000) * 20, 20);
      score -= cycleImpact;
      confidence += 30;
    }
    
    if (hasTemp && batteryData.temperature > 35) {
      const tempImpact = Math.min((batteryData.temperature - 35) * 2, 15);
      score -= tempImpact;
      confidence += 10;
    }
    
    // METHOD 2: Use discharge patterns and usage analytics (software-based estimation)
    if (hasAnalytics && !hasCapacity) {
      // Estimate battery health based on discharge rate
      const dischargeRate = batteryData.analytics.dischargeAnalysis.avgRatePerHour;
      
      // Normal discharge rate is around 10-15%/hr with moderate use
      // Higher rates may indicate battery degradation or high system load
      if (dischargeRate > 20) {
        score -= 15; // Rapid drain - possible battery aging
        confidence += 15;
      } else if (dischargeRate > 15) {
        score -= 8; // Moderate concern
        confidence += 15;
      } else {
        confidence += 15;
      }
    }
    
    if (hasUsageHistory && !hasCapacity) {
      const history = batteryData.analytics.usageHistory;
      
      // Check last 7 days average battery level
      // Healthy batteries maintain good average levels
      if (history.last7Days?.avgBatteryLevel) {
        const avgLevel = history.last7Days.avgBatteryLevel;
        if (avgLevel < 40) {
          score -= 10; // Consistently low levels might indicate capacity loss
          confidence += 15;
        } else if (avgLevel > 60) {
          // Good battery management
          confidence += 15;
        }
      }
      
      // Estimate battery age based on usage patterns
      if (history.totalActiveHours && history.totalActiveHours > 1000) {
        // Rough estimate: 1000+ hours suggests older battery
        const ageImpact = Math.min((history.totalActiveHours / 2000) * 10, 15);
        score -= ageImpact;
        confidence += 10;
      }
    }
    
    // METHOD 3: Use charging status and current level (basic estimation)
    if (confidence < 30) {
      // If we don't have much data, use current status as fallback
      const currentLevel = batteryData.percent || 0;
      
      // A healthy battery that's been unplugged should maintain decent levels
      if (!batteryData.isCharging) {
        if (currentLevel > 70) {
          // Good current state
          confidence += 20;
        } else if (currentLevel < 20) {
          // Low battery - might indicate fast drain
          score -= 5;
          confidence += 20;
        } else {
          confidence += 15;
        }
      } else {
        confidence += 10;
      }
    }
    
    // If we have absolutely no useful data, return null
    if (confidence < 10) {
      return null;
    }
    
    // Return score with confidence indicator
    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    return {
      score: finalScore,
      confidence: confidence,
      methods: {
        hardware: hasCapacity || hasCycles || hasTemp,
        analytics: hasAnalytics || hasUsageHistory,
        basic: true
      }
    };
  };

  /**
   * Get health score status message
   */
  const getHealthScoreMessage = (scoreData) => {
    if (scoreData === null || scoreData.score === null) {
      return {
        status: 'Insufficient Data',
        message: 'Collecting battery performance data. Health score will be available after some usage.',
        color: 'text-gray-400',
        icon: 'ℹ️'
      };
    }
    
    const score = typeof scoreData === 'number' ? scoreData : scoreData.score;
    const confidence = scoreData.confidence || 100;
    const methods = scoreData.methods || { hardware: false, analytics: false, basic: true };
    
    // Confidence level text
    let confidenceText = '';
    if (!methods.hardware && methods.analytics) {
      confidenceText = ' (Estimated from usage patterns)';
    } else if (!methods.hardware && !methods.analytics) {
      confidenceText = ' (Basic estimation)';
    }
    
    if (score >= 90) {
      return {
        status: 'Excellent',
        message: `Your battery is in excellent health${confidenceText}. Keep up the good charging habits!`,
        color: 'text-green-400',
        icon: '✅'
      };
    }
    
    if (score >= 75) {
      return {
        status: 'Very Good',
        message: `Your battery health is very good${confidenceText}. Normal wear and tear expected.`,
        color: 'text-green-400',
        icon: '✓'
      };
    }
    
    if (score >= 60) {
      return {
        status: 'Good',
        message: 'Battery health is acceptable. Consider monitoring charge cycles.',
        color: 'text-yellow-400',
        icon: '⚠️'
      };
    }
    
    if (score >= 40) {
      return {
        status: 'Fair',
        message: 'Battery is showing signs of wear. Consider battery care practices.',
        color: 'text-orange-400',
        icon: '⚠️'
      };
    }
    
    return {
      status: 'Needs Attention',
      message: 'Battery health is degraded. Consider replacement for optimal performance.',
      color: 'text-red-400',
      icon: '❗'
    };
  };

  /**
   * Calculate charge/discharge rate
   */
  const calculateChargeRate = () => {
    if (batteryTrend.length < 2) return null;
    
    const recent = batteryTrend.slice(-10);
    const timeDiff = (recent[recent.length - 1].timestamp - recent[0].timestamp) / 60000; // minutes
    const percentDiff = recent[recent.length - 1].percent - recent[0].percent;
    
    if (timeDiff === 0) return null;
    
    const ratePerMinute = percentDiff / timeDiff;
    return {
      rate: Math.abs(ratePerMinute),
      isCharging: ratePerMinute > 0,
      estimatedTime: ratePerMinute > 0 
        ? (100 - batteryData.percent) / ratePerMinute 
        : batteryData.percent / Math.abs(ratePerMinute)
    };
  };

  /**
   * Estimate battery lifespan remaining
   */
  const estimateBatteryLifespan = () => {
    if (!batteryData || !batteryData.cycleCount || !batteryData.capacityPercent) {
      return null;
    }
    
    const avgLifespanCycles = 1000;
    const remainingCycles = Math.max(0, avgLifespanCycles - batteryData.cycleCount);
    const healthFactor = batteryData.capacityPercent / 100;
    
    return {
      remainingCycles,
      estimatedMonths: Math.round((remainingCycles / 30) * healthFactor),
      healthStatus: batteryData.capacityPercent >= 90 ? 'Excellent' :
                   batteryData.capacityPercent >= 80 ? 'Good' :
                   batteryData.capacityPercent >= 70 ? 'Fair' : 'Replace Soon'
    };
  };

  /**
   * Get smart charging recommendation
   */
  const getChargingRecommendation = () => {
    if (!batteryData) return null;
    
    if (batteryData.isCharging && batteryData.percent >= 80) {
      return {
        type: 'warning',
        message: 'Consider unplugging to preserve battery health',
        reason: 'Keeping battery at 80% or below extends lifespan'
      };
    }
    
    if (!batteryData.isCharging && batteryData.percent <= 20) {
      return {
        type: 'info',
        message: 'Good time to charge',
        reason: 'Keeping battery above 20% is recommended'
      };
    }
    
    if (batteryData.isCharging && batteryData.percent >= 95) {
      return {
        type: 'warning',
        message: 'Battery nearly full - unplug soon',
        reason: 'Avoiding 100% charge regularly helps battery longevity'
      };
    }
    
    return null;
  };

  /**
   * Format time remaining
   */
  const formatTimeRemaining = (minutes) => {
    if (!minutes || minutes <= 0) return 'N/A';
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  /**
   * Get alert icon and color
   */
  const getAlertStyle = (type) => {
    switch (type) {
      case 'critical':
        return { 
          Icon: AlertTriangle, 
          color: 'text-red-500', 
          bg: 'bg-red-500/10', 
          border: 'border-red-500' 
        };
      case 'warning':
        return { 
          Icon: AlertCircle, 
          color: 'text-orange-500', 
          bg: 'bg-orange-500/10', 
          border: 'border-orange-500' 
        };
      case 'info':
        return { 
          Icon: Info, 
          color: 'text-blue-500', 
          bg: 'bg-blue-500/10', 
          border: 'border-blue-500' 
        };
      default:
        return { 
          Icon: Info, 
          color: 'text-gray-500', 
          bg: 'bg-gray-500/10', 
          border: 'border-gray-500' 
        };
    }
  };

  /**
   * Render battery percentage chart (simple bar)
   */
  const renderBatteryBar = () => {
    if (!batteryData) return null;
    
    const percent = batteryData.percent || 0;
    let barColor = 'bg-green-500';
    
    if (batteryData.isCharging) {
      barColor = 'bg-blue-500';
    } else if (percent <= 10) {
      barColor = 'bg-red-500';
    } else if (percent <= 20) {
      barColor = 'bg-orange-500';
    } else if (percent <= 50) {
      barColor = 'bg-yellow-500';
    }
    
    return (
      <div className="w-full h-8 bg-gray-700 rounded-lg overflow-hidden relative">
        <div 
          className={`h-full ${barColor} transition-all duration-500`}
          style={{ width: `${percent}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-sm">
          {percent}%
        </div>
      </div>
    );
  };

  /**
   * Render 24-hour trend chart (using Recharts) - Memoized for performance
   */
  const renderTrendChart = useMemo(() => {
    if (!batteryTrend || batteryTrend.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No trend data available
        </div>
      );
    }
    
    // Format data for chart - pre-calculate once
    const chartData = batteryTrend.slice(-48).map((point, index) => ({
      name: new Date(point.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      battery: point.percent,
      charging: point.isCharging ? 1 : 0  // Show as binary indicator (0 or 1)
    }));
    
    // Calculate optimal tick interval to show more timestamps
    const tickInterval = Math.max(0, Math.floor(chartData.length / 12));
    
    return (
      <div className="relative h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorBattery" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.1}/>
              </linearGradient>
              <linearGradient id="colorCharging" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#10B981" stopOpacity={0.1}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="name" 
              stroke="#9CA3AF"
              tick={{ fontSize: 10 }}
              interval={tickInterval}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              yAxisId="left"
              stroke="#9CA3AF"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 12 }}
              label={{ value: 'Battery %', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}
            />
            <YAxis 
              yAxisId="right"
              orientation="right"
              stroke="#10B981"
              domain={[0, 1]}
              ticks={[0, 1]}
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => value === 1 ? 'Charging' : 'Discharging'}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: '8px',
                color: '#fff'
              }}
              formatter={(value, name) => {
                if (name === 'Battery Level') return [`${value}%`, name];
                if (name === 'Charging') return [value === 1 ? 'Yes' : 'No', name];
                return [value, name];
              }}
            />
            <Legend />
            <Area 
              yAxisId="left"
              type="monotone" 
              dataKey="battery" 
              stroke="#3B82F6" 
              fillOpacity={1} 
              fill="url(#colorBattery)"
              name="Battery Level"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area 
              yAxisId="right"
              type="stepAfter" 
              dataKey="charging" 
              stroke="#10B981" 
              fillOpacity={0.3} 
              fill="url(#colorCharging)"
              name="Charging"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }, [batteryTrend]); // Only recalculate when batteryTrend changes

  // Loading state
  if (loading && !batteryData) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814]">
        <div className="text-center">
          <Battery className="w-16 h-16 text-blue-400 animate-pulse mx-auto mb-4" />
          <p className="text-white text-xl">Loading Battery Data...</p>
        </div>
      </div>
    );
  }

  // No battery detected
  if (!hasBattery) {
    const BatteryIcon = getBatteryIconComponent();
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814]">
        <div className="text-center max-w-md">
          <BatteryIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">No Battery Detected</h2>
          <p className="text-gray-400">
            This device does not have a battery or battery monitoring is not available.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814]">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4 flex justify-center"><AlertTriangle className="w-16 h-16 text-yellow-500" /></div>
          <h2 className="text-2xl font-bold text-white mb-2">Error Loading Battery Data</h2>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={loadBatteryData}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814] p-6">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              Battery Center
            </h1>
            <p className="text-gray-400 mt-1">Monitor and optimize battery health</p>
          </div>
          
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-white cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Auto-refresh (10s)</span>
            </label>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          
          {/* Current Status Card */}
          <div className="lg:col-span-1 bg-gray-800/40 backdrop-blur-lg rounded-2xl p-6 border border-gray-700">
            <h2 className="text-xl font-semibold text-white mb-4">Current Status</h2>
            
            <div className="space-y-4">
              {/* Battery Level */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-400">Battery Level</span>
                  <span className={`text-2xl font-bold ${getBatteryColor()}`}>
                    {batteryData?.percent || 0}%
                  </span>
                </div>
                {renderBatteryBar()}
              </div>
              
              {/* Charging Status */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Status</span>
                <span className={`font-semibold ${batteryData?.isCharging ? 'text-green-400' : 'text-blue-400'} flex items-center gap-1`}>
                  {batteryData?.isCharging ? (
                    <>
                      <BatteryCharging className="w-4 h-4" />
                      Charging
                    </>
                  ) : (
                    <>
                      <Battery className="w-4 h-4" />
                      On Battery
                    </>
                  )}
                </span>
              </div>
              
              {/* Time Remaining */}
              {batteryData?.timeRemaining && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Time Remaining</span>
                  <span className="font-semibold text-white">
                    {formatTimeRemaining(batteryData.timeRemaining)}
                  </span>
                </div>
              )}
              
              {/* Temperature */}
              {batteryData?.temperature && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Temperature</span>
                  <span className="font-semibold text-white">
                    {batteryData.temperature}°C
                  </span>
                </div>
              )}
              
              {/* Battery Health */}
              {batteryData?.capacityPercent && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Battery Health</span>
                  <span className={`font-semibold ${
                    batteryData.capacityPercent >= 90 ? 'text-green-400' :
                    batteryData.capacityPercent >= 70 ? 'text-yellow-500' : 'text-orange-500'
                  }`}>
                    {batteryData.capacityPercent}%
                  </span>
                </div>
              )}
              
              {/* Cycle Count */}
              {batteryData?.cycleCount && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Cycle Count</span>
                  <span className="font-semibold text-white">
                    {batteryData.cycleCount}
                  </span>
                </div>
              )}
            </div>
          </div>
          
          {/* Trend Chart */}
          <div className="lg:col-span-2 bg-gray-800/40 backdrop-blur-lg rounded-2xl p-6 border border-gray-700">
            <h2 className="text-xl font-semibold text-white mb-4">24-Hour Trend</h2>
            {renderTrendChart}
            
            {/* Stats Summary */}
            {batteryStats && (
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-400">{batteryStats.avgPercent}%</div>
                  <div className="text-xs text-gray-400">Average</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-400">{batteryStats.maxPercent}%</div>
                  <div className="text-xs text-gray-400">Peak</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-400">{batteryStats.minPercent}%</div>
                  <div className="text-xs text-gray-400">Lowest</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Optimization Mode */}
        <div className="bg-gray-800/40 backdrop-blur-lg rounded-2xl p-6 border border-gray-700 mb-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-1">System Optimization</h2>
              <p className="text-sm text-gray-400">Monitor battery performance and optimize system</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSettings(true)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
              >
                ⚙️ Settings
              </button>
            </div>
          </div>
          
          <h3 className="text-lg font-semibold text-white mb-4">Battery Monitoring Mode</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {['saver', 'balanced', 'performance'].map(mode => {
              const modeInfo = getModeInfo(mode);
              const isActive = optimizationMode === mode;
              
              return (
                <button
                  key={mode}
                  onClick={() => handleModeChange(mode)}
                  className={`relative p-5 rounded-xl border-2 transition-all group ${
                    isActive
                      ? 'border-blue-500 bg-gradient-to-br ' + modeInfo.color + ' shadow-lg shadow-blue-500/30 scale-105'
                      : 'border-gray-600 bg-gray-700/50 hover:border-gray-500 hover:scale-102'
                  }`}
                >
                  {/* Active indicator with arrow */}
                  {isActive && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <div className="bg-blue-500 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1 shadow-lg">
                        <Check className="w-3 h-3" /> Active
                        <div className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-blue-500"></div>
                      </div>
                    </div>
                  )}
                  
                  <div className="text-4xl mb-3">{modeInfo.icon}</div>
                  <div className="text-white font-bold text-lg mb-1">{modeInfo.name}</div>
                  <div className="text-xs text-gray-300 mb-2">{modeInfo.description}</div>
                  <div className="text-xs text-gray-400 mb-3 flex items-center justify-center gap-1">
                    <Clock className="w-3 h-3" />
                    Updates every {modeInfo.polling}
                  </div>
                  
                  {/* Show benefits on hover or when active */}
                  <div className={`text-xs text-left space-y-1 transition-all ${
                    isActive ? 'opacity-100 max-h-40' : 'opacity-0 max-h-0 group-hover:opacity-100 group-hover:max-h-40'
                  } overflow-hidden`}>
                    {modeInfo.benefits.slice(0, 2).map((benefit, idx) => (
                      <div key={idx} className="flex items-start gap-1 text-gray-300">
                        <span className="text-green-400 mt-0.5">•</span>
                        <span>{benefit}</span>
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
          
          {/* Current mode details */}
          <div className="bg-gray-700/30 rounded-lg p-4">
            <div className="text-sm text-gray-300">
              <span className="font-semibold text-white">Current Benefits:</span>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                {getModeInfo(optimizationMode).benefits.map((benefit, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-gray-300">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-2xl border border-gray-700 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
              <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-6 flex justify-between items-center">
                <h2 className="text-2xl font-semibold text-white">Notification Settings</h2>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-gray-400 hover:text-white text-3xl leading-none transition-colors"
                >
                  ✕
                </button>
              </div>
              
              <div className="p-6">
                <p className="text-gray-400 mb-6">
                  Configure battery alert thresholds to receive notifications when certain conditions are met.
                  Changes are saved automatically to both local storage and the backend.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <label className="block text-sm font-semibold text-white mb-2 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500" /> Critical Battery Level (%)
                    </label>
                    <input
                      type="number"
                      min="5"
                      max="20"
                      value={thresholds?.criticalBattery || 10}
                      onChange={(e) => saveCustomThresholds({...thresholds, criticalBattery: parseInt(e.target.value)})}
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Alert when battery reaches a critical level. Default: 10%. 
                      You'll be notified to connect your charger immediately.
                    </p>
                  </div>
                  
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <label className="block text-sm font-semibold text-white mb-2 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-orange-500" /> Low Battery Level (%)
                    </label>
                    <input
                      type="number"
                      min="10"
                      max="30"
                      value={thresholds?.lowBattery || 20}
                      onChange={(e) => saveCustomThresholds({...thresholds, lowBattery: parseInt(e.target.value)})}
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Warning when battery is getting low. Default: 20%. 
                      Consider charging soon to avoid interruption.
                    </p>
                  </div>
                  
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <label className="block text-sm font-semibold text-white mb-2 flex items-center gap-2">
                      <Thermometer className="w-4 h-4 text-red-400" /> High Temperature (°C)
                    </label>
                    <input
                      type="number"
                      min="35"
                      max="60"
                      value={thresholds?.highTemp || 45}
                      onChange={(e) => saveCustomThresholds({...thresholds, highTemp: parseInt(e.target.value)})}
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Alert when battery temperature is too high. Default: 45°C. 
                      High temps can damage battery health over time.
                    </p>
                  </div>
                  
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <label className="block text-sm font-semibold text-white mb-2 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-yellow-400" /> Rapid Drain (%/min)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      step="0.5"
                      value={thresholds?.rapidDrain || 5}
                      onChange={(e) => saveCustomThresholds({...thresholds, rapidDrain: parseFloat(e.target.value)})}
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Alert when battery drains unusually fast. Default: 5%/min. 
                      May indicate resource-intensive apps running.
                    </p>
                  </div>
                  
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <label className="block text-sm font-semibold text-white mb-2 flex items-center gap-2">
                      <RotateCcw className="w-4 h-4 text-blue-400" /> Cycle Warning Count
                    </label>
                    <input
                      type="number"
                      min="300"
                      max="1000"
                      step="50"
                      value={thresholds?.cycleWarning || 500}
                      onChange={(e) => saveCustomThresholds({...thresholds, cycleWarning: parseInt(e.target.value)})}
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Notify when battery cycles reach threshold. Default: 500. 
                      High cycle count indicates battery wear.
                    </p>
                  </div>
                  
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <label className="block text-sm font-semibold text-white mb-2 flex items-center gap-2">
                      <Heart className="w-4 h-4 text-green-400" /> Health Warning (%)
                    </label>
                    <input
                      type="number"
                      min="60"
                      max="90"
                      value={thresholds?.healthWarning || 80}
                      onChange={(e) => saveCustomThresholds({...thresholds, healthWarning: parseInt(e.target.value)})}
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Alert when battery health drops below this level. Default: 80%. 
                      Lower health means reduced capacity and runtime.
                    </p>
                  </div>
                </div>
                
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Optimization Result Modal */}
        {showOptimizationResult && optimizationResult && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-2xl border border-gray-700 max-w-2xl w-full shadow-2xl">
              <div className={`p-6 rounded-t-2xl ${
                optimizationResult.initialTemp !== undefined && optimizationResult.initialTemp !== 'N/A'
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-700' // Cooldown (temperature-based)
                  : 'bg-gradient-to-r from-green-600 to-green-700' // System optimization (disk cleanup)
              }`}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="text-4xl">
                      {optimizationResult.initialTemp !== undefined && optimizationResult.initialTemp !== 'N/A' ? '🌡️' : '✨'}
                    </span>
                    <div>
                      <h2 className="text-2xl font-bold text-white">
                        {optimizationResult.initialTemp !== undefined && optimizationResult.initialTemp !== 'N/A' 
                          ? 'System Cooldown Complete!' 
                          : 'Optimization Complete!'}
                      </h2>
                      <p className="text-green-100 text-sm">
                        {optimizationResult.initialTemp !== undefined && optimizationResult.initialTemp !== 'N/A'
                          ? 'Temperature management completed'
                          : 'Your system has been optimized'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowOptimizationResult(false);
                      setOptimizationResult(null);
                    }}
                    className="text-white hover:text-green-100 text-3xl leading-none transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
              
              <div className="p-6">
                {/* Summary Stats - Different for Cooldown vs Optimization */}
                {optimizationResult.initialTemp !== undefined && optimizationResult.initialTemp !== 'N/A' ? (
                  /* Cooldown Stats - Show Temperature Data */
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-blue-400">
                        {optimizationResult.initialTemp !== 'N/A' 
                          ? `${optimizationResult.initialTemp}°C` 
                          : 'N/A'}
                      </div>
                      <div className="text-sm text-gray-400 mt-1">Initial Temp</div>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-green-400">
                        {optimizationResult.actions?.length || 0}
                      </div>
                      <div className="text-sm text-gray-400 mt-1">Actions Completed</div>
                    </div>
                  </div>
                ) : (
                  /* System Optimization Stats - Show Space Saved */
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-blue-400">
                        {optimizationResult.spaceSaved 
                          ? (optimizationResult.spaceSaved / 1024 / 1024).toFixed(2) + ' MB'
                          : '0 MB'}
                      </div>
                      <div className="text-sm text-gray-400 mt-1">Space Saved</div>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-green-400">
                        {optimizationResult.actions?.length || 0}
                      </div>
                      <div className="text-sm text-gray-400 mt-1">Actions Completed</div>
                    </div>
                  </div>
                )}

                {/* Actions Detail */}
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-white mb-3">Actions Performed:</h3>
                  {optimizationResult.actions?.map((action, index) => (
                    <div key={index} className="bg-gray-700/30 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xl ${
                              action.status === 'success' ? '✅' : 
                              action.status === 'error' ? '❌' : 
                              action.status === 'info' ? 'ℹ️' :
                              '⚠️'}`}>
                              {action.status === 'success' ? '✅' : 
                               action.status === 'error' ? '❌' : 
                               action.status === 'info' ? 'ℹ️' :
                               '⚠️'}
                            </span>
                            <span className="font-semibold text-white">{action.action}</span>
                          </div>
                          {action.message && (
                            <p className="text-sm text-gray-400 ml-7">{action.message}</p>
                          )}
                          {action.details && Array.isArray(action.details) && (
                            <div className="ml-7 mt-2 space-y-1">
                              {action.details.map((detail, idx) => (
                                <p key={idx} className="text-xs text-gray-500">• {detail}</p>
                              ))}
                            </div>
                          )}
                          {action.filesDeleted > 0 && (
                            <p className="text-xs text-gray-500 ml-7 mt-1">
                              {action.filesDeleted} files deleted
                            </p>
                          )}
                        </div>
                        {action.spaceSaved > 0 && (
                          <div className="text-right ml-4">
                            <div className="text-sm font-bold text-green-400">
                              +{(action.spaceSaved / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {/* Show temperature comparison for cooldown */}
                  {optimizationResult.initialTemp && optimizationResult.targetTemp && 
                   optimizationResult.initialTemp !== 'N/A' && optimizationResult.targetTemp !== 'N/A' && (
                    <div className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/30 rounded-lg p-4 mt-4">
                      <h4 className="text-blue-300 font-semibold mb-3 flex items-center gap-2"><Thermometer className="w-5 h-5" /> Temperature Analysis</h4>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-2xl font-bold text-orange-400">
                            {optimizationResult.initialTemp}°C
                          </div>
                          <div className="text-xs text-gray-400">Initial</div>
                        </div>
                        <div>
                          <div className={`text-2xl font-bold ${
                            (optimizationResult.initialTemp - optimizationResult.targetTemp) > 0 
                              ? 'text-green-400' 
                              : 'text-gray-400'
                          }`}>
                            {(optimizationResult.initialTemp - optimizationResult.targetTemp) > 0
                              ? `▼ ${(optimizationResult.initialTemp - optimizationResult.targetTemp).toFixed(1)}°C`
                              : '—'}
                          </div>
                          <div className="text-xs text-gray-400">Change</div>
                        </div>
                        <div>
                          <div className={`text-2xl font-bold ${
                            optimizationResult.targetTemp < 70 ? 'text-green-400' :
                            optimizationResult.targetTemp < 85 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {optimizationResult.targetTemp}°C
                          </div>
                          <div className="text-xs text-gray-400">Current</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Errors if any */}
                {optimizationResult.errors && optimizationResult.errors.length > 0 && (
                  <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                    <h4 className="text-red-400 font-semibold mb-2">Some issues occurred:</h4>
                    <ul className="text-sm text-gray-400 space-y-1">
                      {optimizationResult.errors.map((error, index) => (
                        <li key={index}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Close Button */}
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={() => {
                      setShowOptimizationResult(false);
                      setOptimizationResult(null);
                    }}
                    className="px-8 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-lg transition-all font-semibold shadow-lg"
                  >
                    Awesome! Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Advanced Analytics */}
        <div className="bg-gray-800/40 backdrop-blur-lg rounded-2xl p-6 border border-gray-700 mb-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-white">Advanced Battery Analytics</h2>
            <button
              onClick={() => setShowAdvancedAnalytics(!showAdvancedAnalytics)}
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              {showAdvancedAnalytics ? '▼ Hide' : '▶ Show'}
            </button>
          </div>
          
          {showAdvancedAnalytics && (
            <div className="space-y-6">
              {/* Battery Health Score */}
              <div className="bg-gray-700/30 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-4">
                  Battery Health Monitor
                </h3>
                <div className="flex flex-col md:flex-row items-start gap-4">
                  <div className="relative w-32 h-32 flex-shrink-0 mx-auto md:mx-0">
                    <svg className="transform -rotate-90" viewBox="0 0 120 120">
                      <circle
                        cx="60"
                        cy="60"
                        r="50"
                        fill="none"
                        stroke="#374151"
                        strokeWidth="10"
                      />
                      {/* Show health score if available, otherwise show battery percentage */}
                      {(() => {
                        const scoreData = calculateHealthScore();
                        const score = scoreData?.score;
                        const displayValue = score !== undefined ? score : batteryData?.percent;
                        
                        return displayValue !== undefined && (
                          <circle
                            cx="60"
                            cy="60"
                            r="50"
                            fill="none"
                            stroke={
                              score !== undefined
                                ? (score >= 80 ? '#10B981' : score >= 60 ? '#F59E0B' : '#EF4444')
                                : (batteryData?.percent >= 80 ? '#10B981' : batteryData?.percent >= 50 ? '#F59E0B' : '#EF4444')
                            }
                            strokeWidth="10"
                            strokeDasharray={`${displayValue * 3.14} 314`}
                            strokeLinecap="round"
                          />
                        );
                      })()}
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        {(() => {
                          const scoreData = calculateHealthScore();
                          const score = scoreData?.score;
                          const displayValue = score !== undefined ? score : batteryData?.percent;
                          
                          return (
                            <>
                              <div className={`text-2xl font-bold ${
                                score !== undefined
                                  ? getHealthScoreMessage(scoreData).color
                                  : (batteryData?.percent >= 80 ? 'text-green-400' : batteryData?.percent >= 50 ? 'text-yellow-400' : 'text-red-400')
                              }`}>
                                {displayValue !== undefined ? displayValue : 'N/A'}
                              </div>
                              <div className="text-xs text-gray-400">
                                {score !== undefined ? '/ 100' : (batteryData?.percent !== undefined ? '%' : '')}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 w-full">
                    {/* Hardware Metrics */}
                    <div className="space-y-2 text-sm mb-3">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Current Level:</span>
                        <span className="text-white font-semibold">
                          {batteryData?.percent !== undefined ? `${batteryData.percent}%` : 
                           <span className="text-gray-500">Not Available</span>}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Status:</span>
                        <span className="text-white font-semibold">
                          {batteryData?.isCharging ? 
                           <span className="text-blue-400 flex items-center gap-1"><Zap className="w-4 h-4" /> Charging</span> : 
                           <span className="text-green-400">On Battery</span>}
                        </span>
                      </div>
                      
                      {/* Show hardware metrics if available */}
                      {batteryData?.capacityPercent && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">Capacity Health:</span>
                          <span className="text-white font-semibold">{batteryData.capacityPercent}%</span>
                        </div>
                      )}
                      {batteryData?.cycleCount && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">Cycle Count:</span>
                          <span className="text-white font-semibold">{batteryData.cycleCount}</span>
                        </div>
                      )}
                      {batteryData?.temperature && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">Temperature:</span>
                          <span className="text-white font-semibold">{batteryData.temperature}°C</span>
                        </div>
                      )}
                      
                      {/* Show health score status */}
                      {(() => {
                        const scoreData = calculateHealthScore();
                        return scoreData && scoreData.score !== undefined && (
                          <div className="flex justify-between items-center pt-2 border-t border-gray-600">
                            <span className="text-gray-400">Health Score:</span>
                            <span className={`font-semibold ${getHealthScoreMessage(scoreData).color}`}>
                              {getHealthScoreMessage(scoreData).icon} {getHealthScoreMessage(scoreData).status}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                    
                    {/* Show Performance Metrics when health score uses analytics */}
                    {(() => {
                      const scoreData = calculateHealthScore();
                      const usesAnalytics = scoreData?.methods?.analytics && !scoreData?.methods?.hardware;
                      
                      return usesAnalytics && batteryData?.analytics?.dischargeAnalysis && (
                        <div className="bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-blue-500/30 rounded-lg p-3 mb-3">
                          <div className="text-sm font-semibold text-blue-300 mb-2 flex items-center gap-2">
                            📊 Performance-Based Health Estimate
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-gray-300">Discharge Rate:</span>
                              <span className="text-white font-semibold">
                                {batteryData.analytics.dischargeAnalysis.avgRatePerHour}%/hr
                              </span>
                            </div>
                            {batteryData.analytics.usageHistory?.last7Days && (
                              <div className="flex justify-between">
                                <span className="text-gray-300">7-Day Avg:</span>
                                <span className="text-white font-semibold">
                                  {batteryData.analytics.usageHistory.last7Days.avgBatteryLevel}%
                                </span>
                              </div>
                            )}
                            {batteryData.analytics.usageHistory?.totalActiveHours && (
                              <div className="flex justify-between">
                                <span className="text-gray-300">Total Usage:</span>
                                <span className="text-white font-semibold">
                                  {Math.round(batteryData.analytics.usageHistory.totalActiveHours)}hrs
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    
                    {/* Informative message */}
                    <div className={`text-xs p-2 rounded ${
                      (() => {
                        const scoreData = calculateHealthScore();
                        return !scoreData || !scoreData.methods?.hardware
                          ? 'bg-blue-900/30 border border-blue-500/30 text-blue-200' 
                          : 'bg-gray-800/50 border border-gray-600 text-gray-300';
                      })()
                    }`}>
                      {(() => {
                        const scoreData = calculateHealthScore();
                        const message = getHealthScoreMessage(scoreData);
                        return message.message;
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Charge Rate Analysis */}
              {(() => {
                const chargeRate = calculateChargeRate();
                return chargeRate && (
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-4">
                      {chargeRate.isCharging ? 'Charge' : 'Discharge'} Rate Analysis
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-3xl font-bold text-blue-400">
                          {chargeRate.rate.toFixed(2)}%
                        </div>
                        <div className="text-xs text-gray-400">per minute</div>
                      </div>
                      <div className="text-center">
                        <div className="text-3xl font-bold text-green-400">
                          {Math.round(chargeRate.estimatedTime)}
                        </div>
                        <div className="text-xs text-gray-400">
                          minutes to {chargeRate.isCharging ? '100%' : '0%'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-3xl font-bold text-purple-400">
                          {(chargeRate.rate * 60).toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-400">per hour</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Battery Lifespan Estimate */}
              {(() => {
                const lifespan = estimateBatteryLifespan();
                return lifespan && (
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-4">
                      Battery Lifespan Estimate
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-3xl font-bold text-blue-400">
                          {lifespan.remainingCycles}
                        </div>
                        <div className="text-xs text-gray-400">estimated cycles left</div>
                      </div>
                      <div className="text-center">
                        <div className="text-3xl font-bold text-green-400">
                          ~{lifespan.estimatedMonths}
                        </div>
                        <div className="text-xs text-gray-400">months remaining</div>
                      </div>
                      <div className="text-center">
                        <div className={`text-3xl font-bold ${
                          lifespan.healthStatus === 'Excellent' ? 'text-green-400' :
                          lifespan.healthStatus === 'Good' ? 'text-blue-400' :
                          lifespan.healthStatus === 'Fair' ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {lifespan.healthStatus}
                        </div>
                        <div className="text-xs text-gray-400">health status</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Smart Charging Recommendation */}
              {(() => {
                const recommendation = getChargingRecommendation();
                return recommendation && (
                  <div className={`rounded-lg p-4 border-l-4 ${
                    recommendation.type === 'warning' ? 'bg-orange-500/10 border-orange-500' : 'bg-blue-500/10 border-blue-500'
                  }`}>
                    <h3 className="text-lg font-semibold text-white mb-2">
                      Smart Charging Tip
                    </h3>
                    <p className="text-white mb-2">{recommendation.message}</p>
                    <p className="text-sm text-gray-400">{recommendation.reason}</p>
                  </div>
                );
              })()}

              {/* Power Consumption Insights */}
              {batteryStats && (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    24-Hour Power Insights
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-blue-400">{batteryStats.avgPercent}%</div>
                      <div className="text-xs text-gray-400">Average Level</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-400">{batteryStats.maxPercent}%</div>
                      <div className="text-xs text-gray-400">Peak Level</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-orange-400">{batteryStats.minPercent}%</div>
                      <div className="text-xs text-gray-400">Lowest Level</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-purple-400">
                        {batteryStats.maxPercent - batteryStats.minPercent}%
                      </div>
                      <div className="text-xs text-gray-400">Total Range</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Battery Consumption by Apps - Simple table like Processes */}
              {batteryData?.analytics?.topProcesses && batteryData.analytics.topProcesses.length > 0 ? (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-400" />
                    Battery-Draining Apps ({batteryData.analytics.topProcesses.length} tracked)
                  </h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Running time based on when FortiMorph first detected each app. Battery impact = CPU% × running time. Showing all tracked apps in real-time.
                  </p>
                  
                  {/* Display all processes - optimized with efficient scrolling */}
                  <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 scroll-smooth">
                    {batteryData.analytics.topProcesses.map((process, index) => (
                      <div 
                        key={`${process.pid}-${index}`} 
                        className="flex items-center gap-3 bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800/70 transition-colors"
                      >
                        {/* Rank */}
                        <div className="text-blue-400 font-bold w-6">#{index + 1}</div>
                        
                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-semibold truncate text-sm">{process.name}</div>
                          <div className="flex gap-2 text-xs text-gray-400 mt-0.5">
                            <span>{process.avgCpu}% CPU</span>
                            <span>•</span>
                            <span>{process.avgMem}% RAM</span>
                            <span>•</span>
                            <span>{process.runningTime}</span>
                          </div>
                        </div>
                        
                        {/* Impact */}
                        <div className="text-right">
                          <div className="text-red-400 font-bold">{process.batteryImpact}</div>
                          <div className="text-[10px] text-gray-500">impact</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Display count info */}
                  {batteryData.analytics.topProcesses.length > 10 && (
                    <div className="mt-3 text-center">
                      <p className="text-sm text-gray-400">
                        Displaying all <span className="font-bold text-blue-400">{batteryData.analytics.topProcesses.length}</span> tracked processes
                      </p>
                    </div>
                  )}
                  
                  <div className="mt-4 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                    <p className="text-sm text-gray-300">
                      <strong>Impact = CPU% × Minutes Running</strong>. Higher scores = more battery drain. This tracks from when FortiMorph started monitoring.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-400" />
                    Top Battery-Draining Apps
                  </h3>
                  <div className="text-center py-6">
                    <RefreshCw className="w-12 h-12 text-gray-600 mx-auto mb-4 animate-spin" />
                    <p className="text-gray-400 font-semibold mb-2">Collecting battery usage data...</p>
                    <p className="text-sm text-gray-500 mt-2">
                      FortiMorph is scanning running processes. Data appears within 8-10 seconds.
                    </p>
                    
                    {/* Debug info with better visibility */}
                    {batteryData?.analytics && (
                      <div className="mt-4 text-sm bg-gray-800/70 border border-gray-600 rounded-lg p-3 max-w-md mx-auto">
                        <div className="text-gray-300 mb-2 flex items-center gap-1"><BarChart3 className="w-4 h-4" /> <strong>Tracking Status:</strong></div>
                        <div className="text-left space-y-1 text-gray-400">
                          <div>• Processes tracked: <span className="text-white font-semibold">{batteryData.analytics.processTrackingSize || 0}</span></div>
                          <div>• With battery impact: <span className="text-white font-semibold">{batteryData.analytics.topProcesses?.length || 0}</span></div>
                          <div>• Battery history points: <span className="text-white font-semibold">{batteryData.analytics.batteryHistorySize || 0}</span></div>
                        </div>
                        {batteryData.analytics.error && (
                          <div className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> {batteryData.analytics.error}
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="mt-4 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 max-w-md mx-auto text-sm text-blue-300">
                      <span className="inline-flex items-center gap-1"><Lightbulb className="w-4 h-4" /> <strong>Tip:</strong></span> If this stays empty after 30 seconds, try refreshing or check console for errors.
                    </div>
                    
                    <div className="mt-4">
                      <button
                        onClick={() => {
                          console.log('Battery analytics:', batteryData?.analytics);
                          loadBatteryData();
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" /> Refresh Data
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Usage Insights - Historical App Battery Impact */}
              <div className="bg-gradient-to-br from-gray-700/40 to-gray-800/40 rounded-xl p-6 border border-gray-600/30 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      <BarChart3 className="w-6 h-6 text-blue-400" />
                      Usage Insights
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">
                      App battery usage tracked since FortiMorph started
                    </p>
                  </div>
                  <button
                    onClick={() => loadUsageInsights(true)}
                    disabled={loadingInsights}
                    className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 rounded-lg text-sm transition-all duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingInsights ? 'animate-spin' : ''}`} />
                    {loadingInsights ? 'Loading...' : 'Refresh'}
                  </button>
                </div>

                {/* Timeframe Selector */}
                <div className="flex gap-2 mb-6 flex-wrap">
                  {[
                    { key: 'today', label: 'Today', icon: Calendar },
                    { key: 'yesterday', label: 'Yesterday', icon: CalendarDays },
                    { key: 'lastWeek', label: 'Last Week', icon: BarChart3 },
                    { key: 'lastMonth', label: 'Last Month', icon: TrendingUp }
                  ].map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      onClick={() => setSelectedTimeframe(key)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ease-out flex items-center gap-2 ${
                        selectedTimeframe === key
                          ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg scale-105'
                          : 'bg-gray-700/50 hover:bg-gray-700/70 text-gray-300 border border-gray-600/40'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Usage Insights Content */}
                {loadingInsights ? (
                  <div className="text-center py-12">
                    <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Loading usage insights...</p>
                  </div>
                ) : usageInsights && usageInsights[selectedTimeframe]?.apps?.length > 0 ? (
                  <div className="space-y-4">
                    {/* Data Status Indicators */}
                    {usageInsights[selectedTimeframe]?.isPlaceholder && (
                      <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/40 rounded-lg p-4 flex items-start gap-3">
                        <Clock className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-yellow-300 mb-1 flex items-center gap-2">
                            <Info className="w-4 h-4" />
                            Preview Mode - Today's Data Displayed
                          </p>
                          <p className="text-xs text-gray-300 mb-2">
                            {usageInsights[selectedTimeframe].message || 'Showing preview data'}
                          </p>
                          <div className="bg-gray-900/40 rounded px-3 py-1.5 text-xs text-gray-400 inline-block">
                            {usageInsights[selectedTimeframe].dataAvailableIn || 'Real data accumulating'}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Real Historical Data Indicator - Only show for non-Today timeframes */}
                    {selectedTimeframe !== 'today' && usageInsights[selectedTimeframe]?.hasRealData && !usageInsights[selectedTimeframe]?.isPlaceholder && (
                      <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/40 rounded-lg p-3 flex items-start gap-2">
                        <Check className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-blue-300">
                            Showing Historical Data
                          </p>
                          <p className="text-xs text-gray-300 mt-1">
                            Accurate battery usage data from {selectedTimeframe === 'yesterday' ? 'yesterday' : selectedTimeframe === 'lastWeek' ? 'the past 7 days' : 'the past 30 days'}
                          </p>
                        </div>
                      </div>
                    )}
                    
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                      <div className="bg-gradient-to-br from-blue-600/20 to-blue-700/20 border border-blue-500/30 rounded-lg p-3">
                        <div className="text-xs text-blue-300 mb-1 flex items-center gap-1">
                          <Activity className="w-3 h-3" />
                          Apps Tracked
                        </div>
                        <div className="text-2xl font-bold text-blue-400">
                          {usageInsights[selectedTimeframe].totalAppsTracked || usageInsights[selectedTimeframe].apps.length || 0}
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-600/20 to-purple-700/20 border border-purple-500/30 rounded-lg p-3">
                        <div className="text-xs text-purple-300 mb-1 flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          Total Impact
                        </div>
                        <div className="text-2xl font-bold text-purple-400">
                          {Math.round(usageInsights[selectedTimeframe].totalImpact || 0)}
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-green-600/20 to-green-700/20 border border-green-500/30 rounded-lg p-3 col-span-2 md:col-span-1">
                        <div className="text-xs text-green-300 mb-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Active Sessions
                        </div>
                        <div className="text-2xl font-bold text-green-400">
                          {usageInsights[selectedTimeframe]?.activeSessionsCount || 0}
                        </div>
                      </div>
                    </div>
                    
                    {/* Info banner for fresh data */}
                    {selectedTimeframe === 'today' && !usageInsights[selectedTimeframe]?.isPlaceholder && usageInsights[selectedTimeframe].totalAppsTracked < 5 && (
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4 flex items-start gap-2">
                        <Activity className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-blue-300">
                          <strong>Building data:</strong> Battery usage is being tracked continuously in the background. More apps will appear as you use your device.
                        </p>
                      </div>
                    )}

                    {/* App List - Optimized for performance with virtual scrolling */}
                    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 scroll-smooth">
                      {usageInsights[selectedTimeframe].apps.map((app, index) => (
                        <div
                          key={`${app.name}-${index}-${selectedTimeframe}`}
                          className="bg-gray-800/60 border border-gray-700/50 rounded-lg p-3 hover:bg-gray-800/80 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            {/* App Info */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-sm font-bold text-blue-400 w-6">#{index + 1}</span>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-white font-semibold truncate text-sm">{app.name}</h4>
                                <div className="flex gap-3 mt-1 text-xs">
                                  <span className="text-orange-300 flex items-center gap-1">
                                    <Cpu className="w-3 h-3" />
                                    {app.avgCpu}% CPU
                                  </span>
                                  <span className="text-purple-300 flex items-center gap-1">
                                    <MemoryStick className="w-3 h-3" />
                                    {app.avgMemory}% RAM
                                  </span>
                                  {app.impactCategory && (
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                      app.impactCategory === 'Heavy' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                                      app.impactCategory === 'Moderate' ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' :
                                      app.impactCategory === 'Light' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' :
                                      'bg-green-500/20 text-green-300 border border-green-500/30'
                                    }`}>
                                      {app.impactCategory}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Impact Score & Percentage */}
                            <div className="text-right">
                              <div className="text-xl font-bold text-white">{app.percentOfTotal}%</div>
                              <div className="text-xs text-gray-400">Impact: {app.totalBatteryImpact}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Total count display - no collapsing needed, just show count */}
                    {usageInsights[selectedTimeframe].apps.length > 10 && (
                      <div className="mt-3 text-center">
                        <p className="text-sm text-gray-400">
                          Showing all <span className="font-bold text-blue-400">{usageInsights[selectedTimeframe].apps.length}</span> tracked apps
                        </p>
                      </div>
                    )}

                    {/* Info Footer */}
                    <div className="mt-4 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex items-start gap-2">
                      <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-gray-300">
                        <p className="mb-2">
                          <strong>About Usage Insights:</strong> FortiMorph continuously tracks battery usage in the background, even when the app window is closed.
                        </p>
                        <ul className="space-y-1 text-xs text-gray-400 ml-4">
                          <li className="flex items-center gap-2">
                            <Calendar className="w-3 h-3 text-green-300" />
                            <span><strong className="text-green-300">Today:</strong> Real-time data available instantly</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <CalendarDays className="w-3 h-3 text-yellow-300" />
                            <span><strong className="text-yellow-300">Yesterday:</strong> Available after running for 24 hours</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <BarChart3 className="w-3 h-3 text-orange-300" />
                            <span><strong className="text-orange-300">Last Week:</strong> Available after running for 7 days</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <TrendingUp className="w-3 h-3 text-purple-300" />
                            <span><strong className="text-purple-300">Last Month:</strong> Available after running for 30 days</span>
                          </li>
                        </ul>
                        <p className="mt-2 text-xs text-gray-400">
                          Impact categories: <span className="text-red-300">Heavy (≥20%)</span> • <span className="text-orange-300">Moderate (10-19%)</span> • <span className="text-yellow-300">Light (5-9%)</span> • <span className="text-green-300">Minimal (&lt;5%)</span>
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <BarChart3 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-400 font-semibold mb-2">
                      No Data Available
                    </p>
                    <p className="text-sm text-gray-500 max-w-md mx-auto mb-4">
                      Launch some applications to start tracking battery usage. FortiMorph monitors apps continuously in the background.
                    </p>
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 max-w-md mx-auto text-left">
                      <p className="text-sm text-blue-300 font-semibold mb-2 flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" />
                        Background Tracking Active
                      </p>
                      <p className="text-xs text-gray-400 mb-3">
                        FortiMorph collects battery data even when the app window is closed. Your usage patterns are being tracked automatically.
                      </p>
                      {selectedTimeframe !== 'today' && (
                        <div className="bg-gray-900/40 rounded px-3 py-2 text-xs text-gray-400 flex items-start gap-2">
                          <AlertCircle className="w-3 h-3 text-yellow-300 flex-shrink-0 mt-0.5" />
                          <span>
                            <strong className="text-yellow-300">Note:</strong> {
                              selectedTimeframe === 'yesterday' ? 'Yesterday\'s data will be available after running for 24 hours' :
                              selectedTimeframe === 'lastWeek' ? 'Weekly trends will be available after running for 7 days' :
                              'Monthly patterns will be available after running for 30 days'
                            }
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>


              {/* Discharge Rate Analysis */}
              {batteryData?.analytics?.dischargeAnalysis ? (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Battery Discharge Analysis
                  </h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Based on the last hour of battery usage patterns when not charging.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-red-400">
                        {batteryData.analytics.dischargeAnalysis.avgRatePerHour}%
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Avg Drain/Hour</div>
                      <div className="text-xs text-gray-500 mt-1">How fast battery drops</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-orange-400">
                        {batteryData.analytics.dischargeAnalysis.maxRatePerMinute}%
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Peak Drain/Min</div>
                      <div className="text-xs text-gray-500 mt-1">Fastest drain rate</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-green-400">
                        {batteryData.analytics.dischargeAnalysis.minRatePerMinute}%
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Min Drain/Min</div>
                      <div className="text-xs text-gray-500 mt-1">Slowest drain rate</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-purple-400">
                        {Math.floor(batteryData.analytics.dischargeAnalysis.estimatedTimeToEmpty / 60)}h {batteryData.analytics.dischargeAnalysis.estimatedTimeToEmpty % 60}m
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Est. Time to 0%</div>
                      <div className="text-xs text-gray-500 mt-1">At current rate</div>
                    </div>
                  </div>
                  <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded p-2 text-xs text-gray-300">
                    <strong>ℹ️ About this data:</strong> Discharge analysis helps you understand how quickly your battery drains during active use.
                    Lower numbers mean better battery life.
                  </div>
                </div>
              ) : (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Battery Discharge Analysis
                  </h3>
                  <div className="text-center py-6">
                    <div className="text-4xl mb-2 flex justify-center"><Clock className="w-10 h-10 text-blue-400" /></div>
                    <p className="text-gray-400 font-semibold mb-2">Collecting discharge data...</p>
                    <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                      We need at least 2 battery measurements to calculate discharge rates. 
                      Data is collected automatically every 10-60 seconds.
                    </p>
                    
                    {/* Show progress if we have battery trend data */}
                    {batteryTrend && batteryTrend.length > 0 && (
                      <div className="mt-4 bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 max-w-sm mx-auto">
                        <p className="text-sm text-orange-300 mb-1 flex items-center justify-center gap-1">
                          <Clock className="w-4 h-4" /> Progress: {batteryTrend.length}/2 measurements collected
                        </p>
                        <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                          <div
                            className="bg-orange-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min((batteryTrend.length / 2) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    
                    <p className="text-xs text-gray-500 mt-3 max-w-md mx-auto">
                      <span className="inline-flex items-center gap-1"><Lightbulb className="w-3 h-3" /> <strong>Tip:</strong></span> Use your device on battery power (unplug charger) for more accurate discharge analysis.
                    </p>
                    
                    <div className="mt-4">
                      <button
                        onClick={loadBatteryData}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" /> Refresh Data
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* System Health & Cooling Monitor - HIDDEN: Redundant with existing Dashboard features */}
        {false && systemHealth && (
          <div className="bg-gray-800/40 backdrop-blur-lg rounded-2xl p-6 border border-gray-700">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                  🌡️ System Health & Cooling Monitor
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  Real-time temperature and performance monitoring
                </p>
              </div>
              <button
                onClick={() => setShowSystemHealth(!showSystemHealth)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm"
              >
                {showSystemHealth ? 'Hide Details' : 'Show Details'}
              </button>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              {/* CPU Temperature */}
              <div className="bg-gradient-to-br from-red-600/20 to-orange-600/20 border border-red-500/30 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">CPU Temperature</div>
                <div className="flex items-end gap-2">
                  <div className={`text-3xl font-bold ${
                    !systemHealth.cpu.temperature ? 'text-gray-500' :
                    systemHealth.cpu.temperature >= 85 ? 'text-red-400' :
                    systemHealth.cpu.temperature >= 70 ? 'text-orange-400' :
                    'text-green-400'
                  }`}>
                    {systemHealth.cpu.temperature ? `${systemHealth.cpu.temperature}°C` : 'N/A'}
                  </div>
                  {systemHealth.cpu.temperature && (
                    <div className="text-sm text-gray-400 mb-1">
                      {systemHealth.cpu.temperature >= 85 ? '🔥 Critical' :
                       systemHealth.cpu.temperature >= 70 ? '⚠️ High' :
                       systemHealth.cpu.temperature >= 50 ? '✓ Normal' :
                       '❄️ Cool'}
                    </div>
                  )}
                </div>
              </div>

              {/* CPU Usage */}
              <div className="bg-gradient-to-br from-blue-600/20 to-cyan-600/20 border border-blue-500/30 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">CPU Usage</div>
                <div className="flex items-end gap-2">
                  <div className={`text-3xl font-bold ${
                    systemHealth.cpu.usage >= 90 ? 'text-red-400' :
                    systemHealth.cpu.usage >= 70 ? 'text-orange-400' :
                    'text-blue-400'
                  }`}>
                    {systemHealth.cpu.usage.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Memory Usage */}
              <div className="bg-gradient-to-br from-purple-600/20 to-pink-600/20 border border-purple-500/30 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">Memory Usage</div>
                <div className="flex items-end gap-2">
                  <div className={`text-3xl font-bold ${
                    systemHealth.memory.usagePercent >= 90 ? 'text-red-400' :
                    systemHealth.memory.usagePercent >= 75 ? 'text-orange-400' :
                    'text-purple-400'
                  }`}>
                    {systemHealth.memory.usagePercent.toFixed(1)}%
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {systemHealth.memory.used.toFixed(1)} / {systemHealth.memory.total.toFixed(1)} GB
                </div>
              </div>

              {/* Power Estimate */}
              <div className="bg-gradient-to-br from-yellow-600/20 to-amber-600/20 border border-yellow-500/30 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">Power Usage</div>
                <div className="flex items-end gap-2">
                  <div className="text-3xl font-bold text-yellow-400">
                    ~{systemHealth.power.estimated}W
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Estimated
                </div>
              </div>
            </div>

            {/* Cooling Recommendations */}
            {coolingRecommendations && (
              <div className={`rounded-lg p-4 border mb-6 ${
                coolingRecommendations.status === 'critical' ? 'bg-red-600/20 border-red-500/30' :
                coolingRecommendations.status === 'warning' ? 'bg-orange-600/20 border-orange-500/30' :
                coolingRecommendations.status === 'good' ? 'bg-green-600/20 border-green-500/30' :
                'bg-blue-600/20 border-blue-500/30'
              }`}>
                <div className="flex items-start gap-3">
                  <div className="text-3xl">
                    {coolingRecommendations.status === 'critical' ? '🔥' :
                     coolingRecommendations.status === 'warning' ? '⚠️' :
                     coolingRecommendations.status === 'good' ? '✅' :
                     '❄️'}
                  </div>
                  <div className="flex-1">
                    <div className={`font-semibold mb-1 ${
                      coolingRecommendations.status === 'critical' ? 'text-red-300' :
                      coolingRecommendations.status === 'warning' ? 'text-orange-300' :
                      'text-green-300'
                    }`}>
                      {coolingRecommendations.message}
                    </div>
                    {coolingRecommendations.avgTemp && (
                      <div className="text-sm text-gray-400 mb-2">
                        Avg: {coolingRecommendations.avgTemp}°C | Max: {coolingRecommendations.maxTemp}°C (last hour)
                      </div>
                    )}
                    <div className="space-y-1">
                      {coolingRecommendations.recommendations.map((rec, idx) => (
                        <div key={idx} className="text-sm text-gray-300">
                          {rec}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Detailed System Info */}
            {showSystemHealth && (
              <div className="space-y-4">
                {/* CPU Details */}
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-3">CPU Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-gray-400">Model</div>
                      <div className="text-white font-semibold">{systemHealth.cpu.model}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">Cores</div>
                      <div className="text-white font-semibold">
                        {systemHealth.cpu.physicalCores} Physical / {systemHealth.cpu.cores} Logical
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">User Load</div>
                      <div className="text-white font-semibold">{systemHealth.cpu.usageUser.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">System Load</div>
                      <div className="text-white font-semibold">{systemHealth.cpu.usageSystem.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>

                {/* GPU Details (if available) */}
                {systemHealth.gpu && (
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-3">GPU Information</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-gray-400">Model</div>
                        <div className="text-white font-semibold">{systemHealth.gpu.model}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-400">Vendor</div>
                        <div className="text-white font-semibold">{systemHealth.gpu.vendor}</div>
                      </div>
                      {systemHealth.gpu.temperature && (
                        <div>
                          <div className="text-sm text-gray-400">Temperature</div>
                          <div className={`font-semibold ${
                            systemHealth.gpu.temperature >= 90 ? 'text-red-400' :
                            systemHealth.gpu.temperature >= 75 ? 'text-orange-400' :
                            'text-green-400'
                          }`}>
                            {systemHealth.gpu.temperature}°C
                          </div>
                        </div>
                      )}
                      {systemHealth.gpu.vram && (
                        <div>
                          <div className="text-sm text-gray-400">VRAM</div>
                          <div className="text-white font-semibold">{systemHealth.gpu.vram} MB</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Disk Usage */}
                {systemHealth.disk && systemHealth.disk.partitions.length > 0 && (
                  <div className="bg-gray-700/30 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-3">Disk Usage</h3>
                    <div className="space-y-3">
                      {systemHealth.disk.partitions.map((partition, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="text-sm text-white font-semibold">{partition.mount}</div>
                            <div className="text-xs text-gray-400">
                              {partition.used.toFixed(1)} GB / {partition.size.toFixed(1)} GB used
                            </div>
                          </div>
                          <div className={`text-lg font-bold ${
                            partition.usePercent >= 90 ? 'text-red-400' :
                            partition.usePercent >= 75 ? 'text-orange-400' :
                            'text-green-400'
                          }`}>
                            {partition.usePercent.toFixed(1)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* System Info */}
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-3">System Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-gray-400">Platform</div>
                      <div className="text-white font-semibold">{systemHealth.system.platform}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400">Uptime</div>
                      <div className="text-white font-semibold">{systemHealth.system.uptime.toFixed(1)} hours</div>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-sm text-gray-300">
                    <strong>💡 Tip:</strong> The cooling monitor provides real-time temperature tracking and recommendations. 
                    Unlike basic battery metrics, these measurements are available on most systems and help prevent thermal throttling.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="bg-gray-800/40 backdrop-blur-lg rounded-2xl p-6 border border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-500" />
                Recent Alerts
              </h2>
              <button
                onClick={handleClearAlerts}
                className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-4 h-4" />
                Clear All
              </button>
            </div>
            
            <div className="space-y-3">
              {alerts.map((alert, index) => {
                const style = getAlertStyle(alert.type);
                const AlertIcon = style.Icon;
                return (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border ${style.border} ${style.bg}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertIcon className={`w-5 h-5 ${style.color}`} />
                          <span className={`font-semibold ${style.color}`}>{alert.message}</span>
                        </div>
                        {alert.action && (
                          <p className="text-sm text-gray-400 ml-7">{alert.action}</p>
                        )}
                        <p className="text-xs text-gray-500 ml-7 mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(alert.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDismissAlert(alert.id)}
                        className="text-gray-500 hover:text-white transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default BatteryCenter;
