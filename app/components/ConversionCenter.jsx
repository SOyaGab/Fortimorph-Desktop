import React, { useState } from 'react';
import { Zap, History } from 'lucide-react';
import ConversionPanel from './FilesManager/ConversionPanel';
import ConversionHistory from './FilesManager/ConversionHistory';

const ConversionCenter = () => {
  const [activeTab, setActiveTab] = useState('convert');

  const tabs = [
    { id: 'convert', label: 'Convert Files', icon: Zap },
    { id: 'history', label: 'History', icon: History }
  ];

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-900 via-slate-900 to-gray-900">
      <div className="border-b border-gray-700/50 bg-slate-900/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-8">
          <div className="flex items-center gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-2 px-6 py-4 font-medium transition-all duration-200
                    `}
                >
                  <Icon className="w-5 h-5" />
                  <span>{tab.label}</span>
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-cyan-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto">
          {activeTab === 'convert' ? <ConversionPanel /> : <ConversionHistory />}
        </div>
      </div>
    </div>
  );
};

export default ConversionCenter;
