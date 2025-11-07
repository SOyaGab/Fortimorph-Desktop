import React, { useState } from 'react';
import QuarantinePanel from './QuarantinePanel';
import BackupManager from '../BackupManager';
import ConversionCenter from '../ConversionCenter';
import VerificationCenter from '../VerificationCenter';

const FilesManager = () => {
  const [activeSubView, setActiveSubView] = useState('quarantine'); // quarantine, backup, convert, verify

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Sub-Navigation Tabs */}
      <div className="bg-[#003566] rounded-lg p-2 border-2 border-[#0077B6] flex gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveSubView('quarantine')}
          className={`px-6 py-3 rounded-lg font-semibold transition-all duration-300 whitespace-nowrap ${
            activeSubView === 'quarantine'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-transparent text-slate-300 hover:bg-[#001D3D] hover:text-white'
          }`}
        >
          🗑️ Quarantine
        </button>
        <button
          onClick={() => setActiveSubView('backup')}
          className={`px-6 py-3 rounded-lg font-semibold transition-all duration-300 whitespace-nowrap ${
            activeSubView === 'backup'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-transparent text-slate-300 hover:bg-[#001D3D] hover:text-white'
          }`}
        >
          🛡️ Backup
        </button>
        <button
          onClick={() => setActiveSubView('convert')}
          className={`px-6 py-3 rounded-lg font-semibold transition-all duration-300 whitespace-nowrap ${
            activeSubView === 'convert'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-transparent text-slate-300 hover:bg-[#001D3D] hover:text-white'
          }`}
        >
          🔄 Convert
        </button>
        <button
          onClick={() => setActiveSubView('verify')}
          className={`px-6 py-3 rounded-lg font-semibold transition-all duration-300 whitespace-nowrap ${
            activeSubView === 'verify'
              ? 'bg-[#FFC300] text-[#001D3D] shadow-lg'
              : 'bg-transparent text-slate-300 hover:bg-[#001D3D] hover:text-white'
          }`}
        >
          🔐 Verify
        </button>
      </div>

      {/* Active Sub-View Content */}
      <div className="min-h-[600px]">
        {activeSubView === 'quarantine' && <QuarantinePanel />}

        {activeSubView === 'backup' && <BackupManager />}

        {activeSubView === 'convert' && <ConversionCenter />}

        {activeSubView === 'verify' && <VerificationCenter />}
      </div>
    </div>
  );
};

export default FilesManager;
