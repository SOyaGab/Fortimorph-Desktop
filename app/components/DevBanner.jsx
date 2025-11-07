import React, { useState, useEffect } from 'react';
import { Database, CheckCircle, XCircle, Info, RefreshCw } from 'lucide-react';

const DevBanner = () => {
  const [dbHealth, setDbHealth] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState(false);

  const checkDatabaseHealth = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.database.healthCheck();
      if (result.success) {
        setDbHealth(result.data);
        console.log('📊 Database Health:', result.data);
      }
    } catch (error) {
      console.error('Failed to check database health:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkDatabaseHealth();
  }, []);

  if (!dbHealth) return null;

  const isHealthy = dbHealth.isInitialized && dbHealth.dbExists;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Compact Status Indicator */}
      <div className="bg-gray-900/95 backdrop-blur-sm border-2 border-blue-500/50 rounded-lg shadow-2xl">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800/50 transition-colors rounded-lg"
        >
          <Database className="w-4 h-4 text-blue-400" />
          {isHealthy ? (
            <CheckCircle className="w-4 h-4 text-green-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-sm text-white font-semibold">
            DB: {dbHealth.userCount} users
          </span>
          <Info className="w-3 h-3 text-gray-400" />
        </button>

        {/* Expanded Details */}
        {showDetails && (
          <div className="border-t border-gray-700 p-4 space-y-2 max-w-md">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-blue-400">Database Status</h3>
              <button
                onClick={checkDatabaseHealth}
                disabled={loading}
                className="p-1 hover:bg-gray-700 rounded transition-colors"
              >
                <RefreshCw className={`w-3 h-3 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Status:</span>
                <span className={isHealthy ? 'text-green-400' : 'text-red-400'}>
                  {isHealthy ? '✓ Connected' : '✗ Disconnected'}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-400">Location:</span>
                <span className="text-white truncate ml-2" title={dbHealth.dbPath}>
                  {dbHealth.dbPath?.split('\\').pop()}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-400">File Exists:</span>
                <span className={dbHealth.dbExists ? 'text-green-400' : 'text-red-400'}>
                  {dbHealth.dbExists ? 'Yes' : 'No'}
                </span>
              </div>
              
              <div className="border-t border-gray-700 my-2 pt-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Users:</span>
                  <span className="text-white">{dbHealth.userCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Logs:</span>
                  <span className="text-white">{dbHealth.logCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Backups:</span>
                  <span className="text-white">{dbHealth.backupCount}</span>
                </div>
              </div>
              
              <div className="border-t border-gray-700 mt-2 pt-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(dbHealth.dbPath);
                    alert('Database path copied to clipboard!');
                  }}
                  className="w-full text-center text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  📋 Copy DB Path
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DevBanner;