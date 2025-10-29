import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';

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
  
  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshIntervalRef = useRef(null);

  /**
   * Load battery data on mount and set up auto-refresh
   */
  useEffect(() => {
    loadBatteryData();
    loadCustomThresholds();
    loadSystemHealth(); // Load system health data
    
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        loadBatteryData();
        loadSystemHealth(); // Refresh system health
      }, 10000); // Refresh every 10 seconds
    }
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
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
   * Get battery icon based on percentage
   */
  const getBatteryIcon = () => {
    if (!batteryData) return '🔋';
    if (batteryData.isCharging) return '⚡';
    if (batteryData.percent <= 10) return '🪫';
    if (batteryData.percent <= 50) return '🔋';
    return '🔋';
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
        return { icon: '🚨', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500' };
      case 'warning':
        return { icon: '⚠️', color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500' };
      case 'info':
        return { icon: 'ℹ️', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500' };
      default:
        return { icon: '📌', color: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500' };
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
   * Render 24-hour trend chart (using Recharts)
   */
  const renderTrendChart = () => {
    if (!batteryTrend || batteryTrend.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No trend data available
        </div>
      );
    }
    
    // Format data for chart
    const chartData = batteryTrend.slice(-48).map((point, index) => ({
      name: new Date(point.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      battery: point.percent,
      charging: point.isCharging ? 1 : 0  // Show as binary indicator (0 or 1)
    }));
    
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
              interval="preserveStartEnd"
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
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // Loading state
  if (loading && !batteryData) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814]">
        <div className="text-center">
          <div className="animate-spin text-6xl mb-4">🔋</div>
          <p className="text-white text-xl">Loading Battery Data...</p>
        </div>
      </div>
    );
  }

  // No battery detected
  if (!hasBattery) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#001D3D] via-[#003566] to-[#000814]">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">🔌</div>
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
          <div className="text-6xl mb-4">⚠️</div>
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
                <span className={`font-semibold ${batteryData?.isCharging ? 'text-green-400' : 'text-blue-400'}`}>
                  {batteryData?.isCharging ? '⚡ Charging' : '🔋 On Battery'}
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
            {renderTrendChart()}
            
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
                        <span>✓</span> Active
                        <div className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-blue-500"></div>
                      </div>
                    </div>
                  )}
                  
                  <div className="text-4xl mb-3">{modeInfo.icon}</div>
                  <div className="text-white font-bold text-lg mb-1">{modeInfo.name}</div>
                  <div className="text-xs text-gray-300 mb-2">{modeInfo.description}</div>
                  <div className="text-xs text-gray-400 mb-3">
                    ⏱️ Updates every {modeInfo.polling}
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
                    <span className="text-green-400 mt-0.5">✓</span>
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
                    <label className="block text-sm font-semibold text-white mb-2">
                      🔴 Critical Battery Level (%)
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
                    <label className="block text-sm font-semibold text-white mb-2">
                      🟠 Low Battery Level (%)
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
                    <label className="block text-sm font-semibold text-white mb-2">
                      🌡️ High Temperature (°C)
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
                    <label className="block text-sm font-semibold text-white mb-2">
                      ⚡ Rapid Drain (%/min)
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
                    <label className="block text-sm font-semibold text-white mb-2">
                      ♻️ Cycle Warning Count
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
                    <label className="block text-sm font-semibold text-white mb-2">
                      💚 Health Warning (%)
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
                      <h4 className="text-blue-300 font-semibold mb-3">🌡️ Temperature Analysis</h4>
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
                           <span className="text-blue-400">⚡ Charging</span> : 
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

              {/* Battery Consumption by Apps */}
              {batteryData?.analytics?.topProcesses && batteryData.analytics.topProcesses.length > 0 ? (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Top Battery-Draining Apps
                  </h3>
                  <p className="text-sm text-gray-400 mb-4">
                    These applications have been using the most power <strong>since your laptop started</strong>. 
                    Running time shows how long each app has been active. When you close an app, it will be removed from this list. 
                    <strong> All counters reset when you restart/shutdown your laptop.</strong>
                  </p>
                  <div className="space-y-2">
                    {batteryData.analytics.topProcesses.map((process, index) => (
                      <div 
                        key={`${process.pid}-${process.name}-${index}`} 
                        className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800/70 transition-colors"
                      >
                        {/* Rank Number */}
                        <div className="text-2xl font-bold text-blue-400 w-10 text-center">
                          #{index + 1}
                        </div>
                        
                        {/* Process Info */}
                        <div className="min-w-0">
                          <div className="text-white font-semibold truncate">{process.name}</div>
                          <div className="text-xs text-gray-400 truncate">{process.command}</div>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded">
                              ⏱️ Running: {process.runningTime}
                            </span>
                            <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded">
                              ⚡ Impact Score: {process.batteryImpact}
                            </span>
                          </div>
                        </div>
                        
                        {/* CPU Usage */}
                        <div className="text-right min-w-[70px]">
                          <div className="text-sm font-bold text-orange-400">{process.avgCpu}%</div>
                          <div className="text-xs text-gray-500">avg CPU</div>
                          <div className="text-xs text-orange-300">↑ {process.peakCpu}% peak</div>
                        </div>
                        
                        {/* RAM Usage */}
                        <div className="text-right min-w-[70px]">
                          <div className="text-sm font-bold text-purple-400">{process.avgMem}%</div>
                          <div className="text-xs text-gray-500">avg RAM</div>
                          <div className="text-xs text-purple-300">↑ {process.peakMem}% peak</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 space-y-2">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                      <p className="text-sm text-gray-300">
                        <strong>💡 Impact Score:</strong> Calculated from average CPU usage × running time. Higher scores mean more battery drain over time.
                      </p>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                      <p className="text-sm text-gray-300">
                        <strong>🔋 How it works:</strong> We track apps from when your laptop boots up, not just when you open this app. 
                        Apps automatically disappear when closed. Everything resets on laptop restart/shutdown.
                      </p>
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                      <p className="text-sm text-gray-300">
                        <strong>⚡ Tip:</strong> Close apps you're not using to extend battery life. 
                        Background apps still consume power even when minimized.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <span>⚙️</span> Top Battery-Draining Apps
                  </h3>
                  <div className="text-center py-6">
                    <div className="text-4xl mb-2">💤</div>
                    <p className="text-gray-400 font-semibold mb-2">Collecting battery usage data...</p>
                    <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                      The app is actively tracking all running processes. Data appears within 30-60 seconds as apps use CPU and memory.
                    </p>
                    <p className="text-xs text-gray-500 mt-3 max-w-md mx-auto">
                      💡 <strong>How it works:</strong> We track apps from when your laptop boots up, not just when you open FortiMorph. 
                      Apps automatically disappear when closed. Everything resets on laptop restart.
                    </p>
                    
                    {/* Debug info */}
                    {batteryData?.analytics && (
                      <div className="mt-4 text-xs text-gray-600 bg-gray-800/50 rounded p-2 max-w-sm mx-auto">
                        <div>Debug: {batteryData.analytics.processTrackingSize || 0} processes tracked</div>
                        {batteryData.analytics.topProcesses && (
                          <div>Array length: {batteryData.analytics.topProcesses.length}</div>
                        )}
                      </div>
                    )}
                    
                    <div className="mt-4">
                      <button
                        onClick={() => {
                          console.log('Battery analytics:', batteryData?.analytics);
                          loadBatteryData();
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
                      >
                        🔄 Refresh Data
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
                    <div className="text-4xl mb-2">⏳</div>
                    <p className="text-gray-400 font-semibold mb-2">Collecting discharge data...</p>
                    <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                      We need at least 2 battery measurements to calculate discharge rates. 
                      Data is collected automatically every 10-60 seconds.
                    </p>
                    
                    {/* Show progress if we have battery trend data */}
                    {batteryTrend && batteryTrend.length > 0 && (
                      <div className="mt-4 bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 max-w-sm mx-auto">
                        <p className="text-sm text-orange-300 mb-1">
                          ⏳ Progress: {batteryTrend.length}/2 measurements collected
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
                      💡 <strong>Tip:</strong> Use your device on battery power (unplug charger) for more accurate discharge analysis.
                    </p>
                    
                    <div className="mt-4">
                      <button
                        onClick={loadBatteryData}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
                      >
                        🔄 Refresh Data
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Usage History Comparison */}
              {batteryData?.analytics?.usageHistory ? (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Battery Usage History
                  </h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Compare your battery usage patterns over time.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gradient-to-br from-blue-600/20 to-blue-800/20 border border-blue-500/30 rounded-lg p-4">
                      <div className="text-center mb-3">
                        <div className="text-lg font-bold text-blue-400">Today</div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Active Hours:</span>
                          <span className="text-white font-semibold">
                            {batteryData.analytics.usageHistory.today.activeHours.toFixed(1)}h
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Avg Battery:</span>
                          <span className="text-white font-semibold">
                            {batteryData.analytics.usageHistory.today.avgBatteryLevel}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Data Points:</span>
                          <span className="text-gray-500 text-xs">
                            {batteryData.analytics.usageHistory.today.dataPoints}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gradient-to-br from-green-600/20 to-green-800/20 border border-green-500/30 rounded-lg p-4">
                      <div className="text-center mb-3">
                        <div className="text-lg font-bold text-green-400">Yesterday</div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Active Hours:</span>
                          <span className="text-white font-semibold">
                            {batteryData.analytics.usageHistory.yesterday.activeHours.toFixed(1)}h
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Avg Battery:</span>
                          <span className="text-white font-semibold">
                            {batteryData.analytics.usageHistory.yesterday.avgBatteryLevel}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Data Points:</span>
                          <span className="text-gray-500 text-xs">
                            {batteryData.analytics.usageHistory.yesterday.dataPoints}
                          </span>
                        </div>
                      </div>
                      {batteryData.analytics.usageHistory.today.activeHours > 0 && batteryData.analytics.usageHistory.yesterday.activeHours > 0 && (
                        <div className="mt-2 pt-2 border-t border-green-500/30">
                          <div className="text-xs text-center">
                            {batteryData.analytics.usageHistory.today.activeHours > batteryData.analytics.usageHistory.yesterday.activeHours ? (
                              <span className="text-orange-400">
                                ▲ {(batteryData.analytics.usageHistory.today.activeHours - batteryData.analytics.usageHistory.yesterday.activeHours).toFixed(1)}h more usage
                              </span>
                            ) : (
                              <span className="text-green-400">
                                ▼ {(batteryData.analytics.usageHistory.yesterday.activeHours - batteryData.analytics.usageHistory.today.activeHours).toFixed(1)}h less usage
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/20 border border-purple-500/30 rounded-lg p-4">
                      <div className="text-center mb-3">
                        <div className="text-lg font-bold text-purple-400">This Week</div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Total Hours:</span>
                          <span className="text-white font-semibold">
                            {batteryData.analytics.usageHistory.thisWeek.activeHours.toFixed(1)}h
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Daily Avg:</span>
                          <span className="text-white font-semibold">
                            {batteryData.analytics.usageHistory.thisWeek.dailyAverage.toFixed(1)}h
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Avg Battery:</span>
                          <span className="text-white font-semibold">
                            {batteryData.analytics.usageHistory.thisWeek.avgBatteryLevel}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-sm">Data Points:</span>
                          <span className="text-gray-500 text-xs">
                            {batteryData.analytics.usageHistory.thisWeek.dataPoints}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                    <p className="text-sm text-gray-300">
                      <strong>📝 Note:</strong> Active hours are estimated based on periods when your laptop is running on battery. 
                      Consistent usage patterns help extend overall battery lifespan. Data points show how many measurements were taken.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-700/30 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Battery Usage History
                  </h3>
                  <div className="text-center py-6">
                    <div className="text-4xl mb-2">📊</div>
                    <p className="text-gray-400 font-semibold mb-2">Collecting usage data...</p>
                    <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                      We need at least 2 battery measurements to show usage patterns. 
                      Data is collected automatically every 10-60 seconds (depending on your optimization mode).
                    </p>
                    
                    {/* Show current data collection status */}
                    {batteryTrend && batteryTrend.length > 0 && (
                      <div className="mt-4 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 max-w-sm mx-auto">
                        <p className="text-sm text-blue-300 mb-1">
                          ⏳ Progress: {batteryTrend.length}/2 measurements collected
                        </p>
                        <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min((batteryTrend.length / 2) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          Keep the Battery Center tab open for faster data collection
                        </p>
                      </div>
                    )}
                    
                    <div className="mt-4">
                      <button
                        onClick={() => {
                          console.log('Battery trend:', batteryTrend);
                          console.log('Battery analytics:', batteryData?.analytics);
                          loadBatteryData();
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
                      >
                        🔄 Refresh Data
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
              <h2 className="text-xl font-semibold text-white">Recent Alerts</h2>
              <button
                onClick={handleClearAlerts}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Clear All
              </button>
            </div>
            
            <div className="space-y-3">
              {alerts.map((alert, index) => {
                const style = getAlertStyle(alert.type);
                return (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border ${style.border} ${style.bg}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{style.icon}</span>
                          <span className={`font-semibold ${style.color}`}>{alert.message}</span>
                        </div>
                        {alert.action && (
                          <p className="text-sm text-gray-400 ml-7">{alert.action}</p>
                        )}
                        <p className="text-xs text-gray-500 ml-7 mt-1">
                          {new Date(alert.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDismissAlert(alert.id)}
                        className="text-gray-500 hover:text-white transition-colors text-xl"
                      >
                        ✕
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
