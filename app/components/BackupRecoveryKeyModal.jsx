/**
 * OPTION B: Backup Recovery Key Modal - Simplified & User-Friendly
 * 
 * Replaces the complex token system with a straightforward recovery key generator.
 * Focus: Making backup transfer and restoration simple for end users.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  Shield,
  Copy,
  Download,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Infinity,
  Info
} from 'lucide-react';

const BackupRecoveryKeyModal = ({ isOpen, onClose, backup, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [generatedKey, setGeneratedKey] = useState(null);
  
  // OPTION B: Only two simple options
  const [keyType, setKeyType] = useState('temporary'); // 'temporary' or 'permanent'
  const [showPermanentWarning, setShowPermanentWarning] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setGeneratedKey(null);
      setError(null);
      setSuccess(null);
      setKeyType('temporary');
    }
  }, [isOpen]);

  const handleGenerate = async (confirmed = false) => {
    if (keyType === 'permanent' && !confirmed) {
      setShowPermanentWarning(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const keyData = {
        type: 'backup',
        resourceId: backup.id.toString(),
        resourceName: backup.name,
        ttl: keyType === 'temporary' ? 86400 : null, // 24 hours or permanent
        oneTimeUse: false,
        metadata: {
          backupId: backup.id,
          sourcePath: backup.source_path,
          fileCount: backup.file_count,
          size: backup.size,
          createdAt: backup.created_at,
          encrypted: backup.encrypted === 1
        }
      };

      const response = await window.verificationAPI.generate(keyData);
      
      if (response.success && response.data) {
        setGeneratedKey(response.data);
        setSuccess('Recovery key generated successfully!');
        
        if (onSuccess) {
          onSuccess(response.data);
        }
      } else {
        throw new Error(response.error || 'Failed to generate recovery key');
      }
    } catch (err) {
      console.error('Error generating recovery key:', err);
      setError(err.message || 'Failed to generate recovery key');
    } finally {
      setLoading(false);
      setShowPermanentWarning(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
    setTimeout(() => setSuccess(null), 2000);
  };

  const downloadQRCode = () => {
    if (!generatedKey?.qrCode) return;
    const link = document.createElement('a');
    link.href = generatedKey.qrCode;
    link.download = `backup-recovery-key-${backup.name}-${Date.now()}.png`;
    link.click();
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Permanent Key Warning Overlay */}
      {showPermanentWarning && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[60] p-4">
          <div className="bg-gradient-to-br from-yellow-900 to-orange-900 rounded-xl shadow-2xl border-2 border-yellow-500 max-w-md w-full p-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="p-3 bg-yellow-500 rounded-full">
                <AlertTriangle className="w-8 h-8 text-black" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-yellow-300 mb-2">⚠️ Permanent Key</h3>
                <p className="text-yellow-100 text-sm leading-relaxed">
                  This recovery key will <strong className="text-white">never expire</strong>. 
                  Anyone with this key can restore your backup at any time. 
                  Only create permanent keys for critical, long-term backup storage.
                </p>
              </div>
            </div>
            
            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleGenerate(true)}
                className="w-full px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-black font-bold rounded-lg transition"
              >
                ✓ Create Permanent Key
              </button>
              <button
                onClick={() => setShowPermanentWarning(false)}
                className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Modal */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <Key className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">
                  {generatedKey ? 'Recovery Key Generated' : 'Create Backup Recovery Key'}
                </h2>
                <p className="text-sm text-gray-400">
                  {generatedKey ? 'Save this key to restore on another device' : `For: ${backup.name}`}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded-lg transition"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Error Message */}
            {error && (
              <div className="mb-4 bg-red-500/20 border border-red-500/50 rounded-lg p-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="mb-4 bg-green-500/20 border border-green-500/50 rounded-lg p-3 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <p className="text-green-300 text-sm">{success}</p>
              </div>
            )}

            {generatedKey ? (
              /* Display Generated Key */
              <div className="space-y-6">
                {/* Instructions */}
                <div className="bg-gradient-to-r from-green-500/20 to-blue-500/20 border border-green-500/50 rounded-lg p-4">
                  <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Info className="w-5 h-5 text-green-400" />
                    How to Use This Recovery Key
                  </h4>
                  <ol className="space-y-2 text-sm text-gray-200">
                    <li className="flex gap-2">
                      <span className="bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">1</span>
                      <span><strong>Scan QR code</strong> with your phone/tablet to instantly transfer via Bluetooth</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">2</span>
                      <span>Or download/copy the recovery key for manual transfer (USB, email, etc.)</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">3</span>
                      <span>Open FortiMorph on the new device → Recovery Center → Enter/scan the key</span>
                    </li>
                  </ol>
                </div>

                {/* QR Code */}
                <div className="flex justify-center">
                  <div className="bg-white p-6 rounded-xl shadow-lg">
                    {generatedKey.qrCode ? (
                      <img 
                        src={generatedKey.qrCode} 
                        alt="Recovery Key QR Code" 
                        className="w-64 h-64"
                      />
                    ) : (
                      <div className="w-64 h-64 flex items-center justify-center bg-gray-200 rounded">
                        <p className="text-gray-500 text-center px-4">QR Code unavailable</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recovery Key Text */}
                <div>
                  <label className="text-sm text-gray-400 block mb-2 font-medium">Recovery Key (Copy this):</label>
                  <div className="flex gap-2">
                    <code className="flex-1 bg-gray-900 border border-gray-700 px-4 py-3 rounded-lg text-green-400 text-xs break-all max-h-32 overflow-y-auto">
                      {generatedKey.tokenString}
                    </code>
                    <button
                      onClick={() => copyToClipboard(generatedKey.tokenString)}
                      className="p-3 bg-green-500 hover:bg-green-600 rounded-lg transition"
                      title="Copy to clipboard"
                    >
                      <Copy className="w-5 h-5 text-white" />
                    </button>
                  </div>
                </div>

                {/* Key Details */}
                <div className="bg-gray-700/50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Backup:</span>
                    <span className="text-white font-medium">{backup.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Files:</span>
                    <span className="text-white">{backup.file_count} files</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Size:</span>
                    <span className="text-white">{formatBytes(backup.size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Created:</span>
                    <span className="text-white">{formatDate(backup.created_at)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Key Expires:</span>
                    <span className="text-white font-medium flex items-center gap-2">
                      {keyType === 'permanent' ? (
                        <>
                          <Infinity className="w-4 h-4 text-blue-400" />
                          <span className="text-blue-400">Never</span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-4 h-4 text-yellow-400" />
                          <span className="text-yellow-400">24 hours</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Transfer Options */}
                <div className="bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/50 rounded-lg p-4">
                  <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                    <Info className="w-5 h-5 text-purple-400" />
                    Transfer Options
                  </h4>
                  <p className="text-purple-200 text-sm mb-3">
                    📱 <strong>Scan QR code</strong> with another device to instantly receive this recovery key via Bluetooth
                  </p>
                  <p className="text-gray-300 text-xs">
                    💡 The QR code contains the recovery key and Bluetooth pairing info. No additional buttons needed!
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={downloadQRCode}
                    className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-3 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2"
                  >
                    <Download className="w-5 h-5" />
                    Download QR Code
                  </button>
                  <button
                    onClick={onClose}
                    className="flex-1 bg-green-500 hover:bg-green-600 text-white py-3 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* Configuration Form */
              <div className="space-y-6">
                {/* Info Banner */}
                <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-white font-semibold mb-1">What is a Recovery Key?</h4>
                      <p className="text-blue-200 text-sm leading-relaxed">
                        A recovery key is a secure code that lets you restore this backup on a different computer. 
                        It's like a password specifically for transferring your backup between devices.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Backup Info */}
                <div className="bg-gray-700/50 rounded-lg p-4">
                  <h4 className="text-white font-medium mb-3">Creating Key For:</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Backup Name:</span>
                      <span className="text-white font-medium">{backup.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Files:</span>
                      <span className="text-white">{backup.file_count} files</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Size:</span>
                      <span className="text-white">{formatBytes(backup.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Encrypted:</span>
                      <span className="text-white">{backup.encrypted ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                </div>

                {/* Key Type Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Key Duration:
                  </label>
                  <div className="space-y-3">
                    <label className="flex items-start gap-3 p-4 bg-gray-700/50 hover:bg-gray-700 rounded-lg cursor-pointer border-2 border-transparent has-[:checked]:border-green-500 transition">
                      <input
                        type="radio"
                        name="keyType"
                        value="temporary"
                        checked={keyType === 'temporary'}
                        onChange={(e) => setKeyType(e.target.value)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="w-4 h-4 text-yellow-400" />
                          <span className="text-white font-medium">24-Hour Key (Recommended)</span>
                        </div>
                        <p className="text-sm text-gray-400">
                          Perfect for quick device transfers. Key expires after 24 hours for security.
                        </p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-4 bg-gray-700/50 hover:bg-gray-700 rounded-lg cursor-pointer border-2 border-transparent has-[:checked]:border-green-500 transition">
                      <input
                        type="radio"
                        name="keyType"
                        value="permanent"
                        checked={keyType === 'permanent'}
                        onChange={(e) => setKeyType(e.target.value)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Infinity className="w-4 h-4 text-blue-400" />
                          <span className="text-white font-medium">Permanent Key</span>
                        </div>
                        <p className="text-sm text-gray-400">
                          Never expires. Use for long-term backup archives. ⚠️ Less secure.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Generate Button */}
                <button
                  onClick={() => handleGenerate()}
                  disabled={loading}
                  className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-600 text-white py-4 px-6 rounded-lg font-semibold text-lg transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Key className="w-5 h-5" />
                      Generate Recovery Key
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default BackupRecoveryKeyModal;
