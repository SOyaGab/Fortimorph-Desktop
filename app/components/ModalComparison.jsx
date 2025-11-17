/**
 * DEVELOPER HELPER: Modal Comparison Component
 * 
 * This component helps you test both Option A and Option B side by side.
 * Add this to your BackupManager temporarily to compare both approaches.
 * 
 * Usage:
 * 1. Import this component in BackupManager.jsx
 * 2. Add it to the render: <ModalComparison backup={selectedBackup} />
 * 3. Test both modals to see which works better
 * 4. Remove this component once you've decided
 */

import React, { useState } from 'react';
import { TestTube, ArrowLeftRight } from 'lucide-react';
import TokenConfigModal from './TokenConfigModal';
import BackupRecoveryKeyModal from './BackupRecoveryKeyModal';

const ModalComparison = ({ backup }) => {
  const [showComparison, setShowComparison] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'A' or 'B'

  if (!backup) {
    return (
      <div className="fixed bottom-4 right-4 bg-yellow-500/20 border border-yellow-500 rounded-lg p-4 max-w-xs">
        <p className="text-yellow-300 text-sm">
          Select a backup to test modal comparison
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Floating Test Button */}
      <button
        onClick={() => setShowComparison(!showComparison)}
        className="fixed bottom-4 right-4 bg-purple-600 hover:bg-purple-500 text-white rounded-full p-4 shadow-lg z-40 flex items-center gap-2"
        title="Test modal comparison"
      >
        <TestTube className="w-5 h-5" />
        <span className="font-medium">Test Modals</span>
      </button>

      {/* Comparison Panel */}
      {showComparison && (
        <div className="fixed bottom-20 right-4 bg-gray-800 border border-gray-700 rounded-lg p-4 max-w-md z-40 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-bold flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5" />
              Modal Comparison
            </h3>
            <button
              onClick={() => setShowComparison(false)}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setActiveModal('A')}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-lg text-left"
            >
              <div className="font-semibold mb-1">Test Option A</div>
              <div className="text-xs text-blue-200">
                Complex token modal with multiple types
              </div>
            </button>

            <button
              onClick={() => setActiveModal('B')}
              className="w-full bg-green-600 hover:bg-green-500 text-white p-3 rounded-lg text-left"
            >
              <div className="font-semibold mb-1">Test Option B</div>
              <div className="text-xs text-green-200">
                Simplified recovery key modal (2 options)
              </div>
            </button>
          </div>

          <div className="mt-4 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded text-xs text-yellow-200">
            💡 Tip: Try both and see which feels more intuitive!
          </div>
        </div>
      )}

      {/* Option A Modal */}
      {activeModal === 'A' && (
        <TokenConfigModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          initialData={{
            type: 'backup',
            resourceSelectionMode: 'database',
            resourceId: backup.id.toString(),
            resourceName: backup.name,
            ttl: 86400,
            oneTimeUse: false
          }}
          onSuccess={(result) => {
            console.log('Option A - Token generated:', result);
          }}
        />
      )}

      {/* Option B Modal */}
      {activeModal === 'B' && (
        <BackupRecoveryKeyModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          backup={backup}
          onSuccess={(result) => {
            console.log('Option B - Recovery key generated:', result);
          }}
        />
      )}
    </>
  );
};

export default ModalComparison;

/**
 * HOW TO USE THIS COMPARISON TOOL:
 * 
 * 1. In BackupManager.jsx, add import:
 *    import ModalComparison from './ModalComparison';
 * 
 * 2. Add state for selected backup (if not already present):
 *    const [comparisonBackup, setComparisonBackup] = useState(null);
 * 
 * 3. Add the component at the end of the return statement:
 *    <ModalComparison backup={comparisonBackup || backups[0]} />
 * 
 * 4. A purple floating button will appear in the bottom-right
 * 
 * 5. Click it to test both modals side by side
 * 
 * 6. Remove this component once you've decided which option to keep
 */
