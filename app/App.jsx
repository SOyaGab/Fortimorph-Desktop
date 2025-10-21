import React, { useState, useEffect } from 'react';

function App() {
  const [appVersion, setAppVersion] = useState('Loading...');

  useEffect(() => {
    // Test the electron API
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then((version) => {
        setAppVersion(version);
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-ocean-deep text-white">
      {/* Header */}
      <header className="bg-ocean-container border-b border-ocean-primary/30 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-ocean-primary rounded-lg flex items-center justify-center">
              <span className="text-xl font-bold">FM</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">FortiMorph</h1>
              <p className="text-sm text-ocean-surface">Adaptive Resource Management</p>
            </div>
          </div>
          <div className="text-sm text-ocean-surface">v{appVersion}</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="bg-ocean-container rounded-xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-ocean-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-10 h-10 text-ocean-surface"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-3xl font-bold mb-3">Welcome to FortiMorph</h2>
          <p className="text-ocean-surface text-lg mb-8">
            Your Adaptive Resource Scaling & Data Integrity Platform
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            <div className="bg-ocean-deep rounded-lg p-6 border border-ocean-primary/20">
              <h3 className="font-semibold text-ocean-surface mb-2">System Monitor</h3>
              <p className="text-sm text-gray-400">Real-time CPU, RAM, and process tracking</p>
            </div>
            <div className="bg-ocean-deep rounded-lg p-6 border border-ocean-primary/20">
              <h3 className="font-semibold text-ocean-surface mb-2">Battery Center</h3>
              <p className="text-sm text-gray-400">Smart battery health monitoring</p>
            </div>
            <div className="bg-ocean-deep rounded-lg p-6 border border-ocean-primary/20">
              <h3 className="font-semibold text-ocean-surface mb-2">Backup System</h3>
              <p className="text-sm text-gray-400">Secure encrypted file backups</p>
            </div>
          </div>
        </div>

        <div className="mt-8 bg-ocean-container rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Project Status</h3>
          <div className="space-y-3">
            <StatusItem label="Module A: Environment Setup" status="in-progress" />
            <StatusItem label="Module B: Authentication" status="pending" />
            <StatusItem label="Module C: System Monitoring" status="pending" />
            <StatusItem label="Module D: Battery Center" status="pending" />
            <StatusItem label="Module E: Backup & Recovery" status="pending" />
          </div>
        </div>
      </main>
    </div>
  );
}

function StatusItem({ label, status }) {
  const statusColors = {
    completed: 'bg-green-500',
    'in-progress': 'bg-ocean-surface',
    pending: 'bg-gray-600',
  };

  const statusText = {
    completed: 'Completed',
    'in-progress': 'In Progress',
    pending: 'Pending',
  };

  return (
    <div className="flex items-center justify-between py-2 px-4 bg-ocean-deep rounded-lg">
      <span className="text-sm">{label}</span>
      <div className="flex items-center space-x-2">
        <span className={`w-2 h-2 rounded-full ${statusColors[status]}`}></span>
        <span className="text-sm text-gray-400">{statusText[status]}</span>
      </div>
    </div>
  );
}

export default App;
