import React from 'react';

function DevBanner() {
  return (
    <div className="fixed top-0 left-0 right-0 bg-ocean-warning/10 border-b border-ocean-warning/30 px-4 py-2 z-50">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-ocean-warning text-sm">🔧</span>
          <span className="text-ocean-warning text-sm font-medium">Development Mode</span>
        </div>
        <div className="text-xs text-gray-400">
          <span className="hidden md:inline">
            Accounts are auto-verified | Email not required | Check console for logs
          </span>
          <span className="md:hidden">Dev Mode Active</span>
        </div>
      </div>
    </div>
  );
}

export default DevBanner;
