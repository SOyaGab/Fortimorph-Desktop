/**
 * Token Configuration Modal Component
 * 
 * Reusable modal for configuring and generating verification tokens
 * with support for resource selection, file browsing, and permanent tokens.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  QrCode,
  Shield,
  HardDrive,
  FileText,
  Activity,
  Settings,
  User,
  Database,
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  RefreshCw,
  Infinity,
  Bluetooth,
  Send
} from 'lucide-react';

const TokenConfigModal = ({ isOpen, onClose, initialData = {}, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [generatedToken, setGeneratedToken] = useState(null);
  const [showPermanentWarning, setShowPermanentWarning] = useState(false);

  // Resource lists
  const [backups, setBackups] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [diagnosticReports, setDiagnosticReports] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);

  // Form state - OPTION A: Default to 'backup' type (most common use case)
  const [form, setForm] = useState({
    type: initialData.type || 'backup',
    resourceSelectionMode: initialData.resourceSelectionMode || 'browse', // Use initialData if provided
    resourceId: initialData.resourceId || '',
    resourceName: initialData.resourceName || '',
    ttl: initialData.ttl !== undefined ? initialData.ttl : 3600,
    oneTimeUse: initialData.oneTimeUse || false,
    customTypeName: initialData.customTypeName || ''
  });

  // Token types - OPTION A: Simplified to essential use cases only
  const tokenTypes = [
    { 
      value: 'backup', 
      label: 'Backup Sharing Token', 
      icon: HardDrive,
      description: 'Transfer backup to another device',
      useCase: 'Use when: Restoring backup on a different computer'
    },
    { 
      value: 'file', 
      label: 'File Integrity Seal', 
      icon: FileText,
      description: 'One-time verification stamp for files',
      useCase: 'Use when: You need proof a file hasn\'t been modified'
    }
  ];

  // TTL options
  const ttlOptions = [
    { value: 300, label: '5 minutes' },
    { value: 900, label: '15 minutes' },
    { value: 1800, label: '30 minutes' },
    { value: 3600, label: '1 hour' },
    { value: 7200, label: '2 hours' },
    { value: 14400, label: '4 hours' },
    { value: 86400, label: '24 hours' },
    { value: 259200, label: '3 days' },
    { value: 604800, label: '7 days' },
    { value: 2592000, label: '30 days' },
    { value: null, label: 'No Expiration (Permanent)', icon: Infinity }
  ];

  useEffect(() => {
    if (isOpen) {
      loadResources();
      // Reset form with initialData when modal opens
      if (initialData && Object.keys(initialData).length > 0) {
        setForm({
          type: initialData.type || 'custom',
          resourceSelectionMode: initialData.resourceSelectionMode || 'browse',
          resourceId: initialData.resourceId || '',
          resourceName: initialData.resourceName || '',
          ttl: initialData.ttl !== undefined ? initialData.ttl : 3600,
          oneTimeUse: initialData.oneTimeUse || false,
          customTypeName: initialData.customTypeName || ''
        });
      }
    }
  }, [isOpen, form.type, initialData]);

  useEffect(() => {
    if (form.ttl === null) {
      setShowPermanentWarning(true);
    } else {
      setShowPermanentWarning(false);
    }
  }, [form.ttl]);

  const loadResources = async () => {
    try {
      if (form.type === 'backup') {
        const data = await window.verificationAPI.getBackups();
        setBackups(data || []);
      } else if (form.type === 'file') {
        const data = await window.verificationAPI.getConversionHistory();
        setConversions(data || []);
      } else if (form.type === 'diagnostic') {
        const data = await window.verificationAPI.getDiagnosticReports();
        setDiagnosticReports(data || []);
      }
    } catch (err) {
      console.error('Failed to load resources:', err);
    }
  };

  const handleBrowseFile = async () => {
    try {
      const result = await window.verificationAPI.openFileDialog();
      if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        
        // Calculate file hash
        setLoading(true);
        const fileInfo = await window.verificationAPI.calculateFileHash(filePath);
        setLoading(false);
        
        setSelectedFile(fileInfo);
        setForm(prev => ({
          ...prev,
          resourceSelectionMode: 'browse',
          resourceId: fileInfo.hash,
          resourceName: fileInfo.name
        }));
      }
    } catch (err) {
      setError('Failed to browse file: ' + err.message);
      setLoading(false);
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const result = await window.verificationAPI.openFolderDialog();
      if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
        const folderPath = result.filePaths[0];
        
        // Calculate folder hash (hash of all files)
        setLoading(true);
        const folderInfo = await window.verificationAPI.calculateFolderHash(folderPath);
        setLoading(false);
        
        setSelectedFile(folderInfo);
        setForm(prev => ({
          ...prev,
          resourceSelectionMode: 'browse',
          resourceId: folderInfo.hash,
          resourceName: folderInfo.name
        }));
      }
    } catch (err) {
      setError('Failed to browse folder: ' + err.message);
      setLoading(false);
    }
  };

  const handleResourceSelect = (e) => {
    const value = e.target.value;
    if (!value) return;

    let resourceData = null;
    let resourceName = '';

    if (form.type === 'backup') {
      resourceData = backups.find(b => b.id.toString() === value);
      resourceName = resourceData?.name || value;
    } else if (form.type === 'file') {
      resourceData = conversions.find(c => c.id.toString() === value);
      resourceName = resourceData?.output_path ? resourceData.output_path.split(/[\\/]/).pop() : value;
    } else if (form.type === 'diagnostic') {
      resourceData = diagnosticReports.find(d => d.id.toString() === value);
      resourceName = resourceData?.message || value;
    }

    setForm(prev => ({
      ...prev,
      resourceSelectionMode: 'database',
      resourceId: value,
      resourceName: resourceName
    }));
    setSelectedFile(null);
  };

  const handleGenerate = async (skipWarning = false) => {
    setError(null);
    setSuccess(null);

    // OPTION A: Enhanced validation with clearer error messages
    if (!form.resourceId) {
      setError('❌ No resource selected. Please choose a backup or browse for a file to create a recovery key.');
      return;
    }

    if (form.type === 'custom' && !form.customTypeName) {
      setError('❌ Custom type name required. Please enter a descriptive name for your custom token type.');
      return;
    }

    // Check if TTL is undefined (not selected), but allow null (permanent)
    if (form.ttl === undefined) {
      setError('❌ Please select how long the recovery key should be valid (24 hours or permanent).');
      return;
    }

    // Confirm permanent token - show modal (only if not already confirmed)
    if (form.ttl === null && !skipWarning) {
      setShowPermanentWarning(true);
      return;
    }

    setLoading(true);

    try {
      console.log('[TokenConfigModal] Generating token with form data:', {
        type: form.type,
        customTypeName: form.customTypeName,
        resourceId: form.resourceId,
        resourceName: form.resourceName,
        ttl: form.ttl,
        isPermanent: form.ttl === null,
        oneTimeUse: form.oneTimeUse,
        selectedFile: selectedFile ? { name: selectedFile.name, hash: selectedFile.hash } : null
      });

      const tokenData = {
        type: form.type === 'custom' ? form.customTypeName : form.type,
        resourceId: form.resourceId,
        resourceName: form.resourceName || form.resourceId,
        ttl: form.ttl, // Can be null for permanent tokens
        oneTimeUse: form.oneTimeUse,
        metadata: {
          mode: form.resourceSelectionMode,
          ...(selectedFile && {
            filePath: selectedFile.path,
            fileSize: selectedFile.size,
            fileHash: selectedFile.hash
          })
        }
      };

      // If browsing file/folder, include file info
      if (form.resourceSelectionMode === 'browse' && selectedFile) {
        tokenData.filePath = selectedFile.path;
        tokenData.fileHash = selectedFile.hash;
      }

      console.log('[TokenConfigModal] Sending token data to IPC:', tokenData);
      const response = await window.verificationAPI.generate(tokenData);
      console.log('[TokenConfigModal] Received response:', response);
      
      // Handle response format from IPC handler
      if (response.success && response.data) {
        setGeneratedToken(response.data);
        setSuccess('Token generated successfully!');
        
        if (onSuccess) {
          onSuccess(response.data);
        }
      } else {
        const errorMsg = response.error || 'Failed to generate token';
        console.error('[TokenConfigModal] Token generation failed:', errorMsg);
        throw new Error(errorMsg);
      }
    } catch (err) {
      console.error('[TokenConfigModal] Error in handleGenerate:', err);
      setError(err.message || 'Failed to generate token');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmPermanent = () => {
    console.log('[TokenConfigModal] User confirmed permanent token creation');
    console.log('[TokenConfigModal] Current form state:', form);
    setShowPermanentWarning(false);
    // Use setTimeout to ensure state update completes before calling handleGenerate
    setTimeout(() => {
      handleGenerate(true); // Pass true to skip the warning check
    }, 50);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const downloadQRCode = () => {
    if (!generatedToken) return;
    const link = document.createElement('a');
    link.href = generatedToken.qrCode;
    link.download = `verification-qr-${generatedToken.tokenId}.png`;
    link.click();
  };

  const handleClose = () => {
    setGeneratedToken(null);
    setError(null);
    setSuccess(null);
    setSelectedFile(null);
    setShowPermanentWarning(false);
    onClose();
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Permanent Token Warning Modal - Full Screen Overlay */}
      {showPermanentWarning && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
          <div className="bg-gradient-to-br from-yellow-900/90 to-orange-900/90 rounded-xl shadow-2xl border-2 border-yellow-500 max-w-md w-full p-6 animate-pulse-slow">
            <div className="flex items-start gap-4 mb-4">
              <div className="p-3 bg-yellow-500 rounded-full flex-shrink-0">
                <AlertTriangle className="w-8 h-8 text-black" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-yellow-300 mb-2 flex items-center gap-2"><AlertTriangle className="w-6 h-6" /> Permanent Token Warning</h3>
                <p className="text-yellow-100 text-base leading-relaxed">
                  This token will <strong className="text-white text-lg">never expire</strong>. 
                  It can be used indefinitely unless manually deleted. 
                  Only create permanent tokens if absolutely necessary for security reasons.
                </p>
              </div>
            </div>
            
            <div className="bg-black/30 rounded-lg p-4 mb-4 border border-yellow-600">
              <p className="text-yellow-200 text-sm">
                <strong>Security Notice:</strong> Permanent tokens pose a security risk if compromised. 
                Make sure you understand the implications before proceeding.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleConfirmPermanent}
                className="w-full px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-black font-bold text-lg rounded-lg transition transform hover:scale-105"
              >
                ✓ I Understand, Create Permanent Token
              </button>
              <button
                onClick={() => {
                  setForm(prev => ({ ...prev, ttl: 3600 }));
                  setShowPermanentWarning(false);
                }}
                className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <QrCode className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">
                  {generatedToken ? 'Token Generated' : 'Create Verification Token'}
                </h2>
                <p className="text-sm text-gray-400">
                  {generatedToken ? 'Your token is ready to use' : 'Configure token settings'}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
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
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            {generatedToken ? (
              /* Generated Token Display */
              <div className="space-y-6">
                {/* OPTION A: Workflow Guide */}
                <div className="bg-gradient-to-r from-green-500/20 to-blue-500/20 border border-green-500/50 rounded-lg p-4">
                  <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    How to Use This Recovery Key
                  </h4>
                  <ol className="space-y-2 text-sm text-gray-200">
                    <li className="flex items-start gap-2">
                      <span className="bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">1</span>
                      <span><strong>Save this key:</strong> Download QR code or copy the token string below</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">2</span>
                      <span><strong>Transfer to another device:</strong> Use USB, email, or cloud storage</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">3</span>
                      <span><strong>Restore on new device:</strong> Go to Verification Center → Verify Token → Enter/Scan this key</span>
                    </li>
                  </ol>
                </div>

                {/* QR Code */}
                <div className="flex justify-center">
                  <div className="bg-white p-6 rounded-xl shadow-lg">
                  {generatedToken.qrCode ? (
                    <img 
                      src={generatedToken.qrCode} 
                      alt="QR Code" 
                      className="w-64 h-64"
                      onError={(e) => {
                        console.error('QR Code failed to load:', generatedToken.qrCode);
                        e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="%23ddd"/><text x="50%" y="50%" text-anchor="middle" fill="%23999" font-size="16">QR Code Error</text></svg>';
                      }}
                    />
                  ) : (
                    <div className="w-64 h-64 flex items-center justify-center bg-gray-200 rounded">
                      <p className="text-gray-500 text-center px-4">QR Code generation failed</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Token Details */}
              <div className="bg-gray-700/50 rounded-lg p-4 space-y-3">
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Token ID</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-gray-800 px-3 py-2 rounded text-gray-300 text-sm break-all">
                      {generatedToken.tokenId || 'N/A'}
                    </code>
                    {generatedToken.tokenId && (
                      <button
                        onClick={() => {
                          copyToClipboard(generatedToken.tokenId);
                          setSuccess('Token ID copied to clipboard!');
                        }}
                        className="p-2 hover:bg-gray-600 rounded transition flex-shrink-0"
                        title="Copy Token ID"
                      >
                        <Copy className="w-4 h-4 text-gray-400" />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-400 block mb-1">Token String</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-gray-800 px-3 py-2 rounded text-gray-300 text-xs break-all max-h-32 overflow-y-auto">
                      {generatedToken.tokenString || 'N/A'}
                    </code>
                    {generatedToken.tokenString && (
                      <button
                        onClick={() => {
                          copyToClipboard(generatedToken.tokenString);
                          setSuccess('Token string copied to clipboard!');
                        }}
                        className="p-2 hover:bg-gray-600 rounded transition flex-shrink-0"
                        title="Copy Token String"
                      >
                        <Copy className="w-4 h-4 text-gray-400" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Resource Information */}
                {(generatedToken.resourceName || form.resourceName) && (
                  <div>
                    <span className="text-sm text-gray-400">Resource:</span>
                    <p className="text-gray-200 font-medium">
                      {generatedToken.resourceName || form.resourceName}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-600">
                  <div>
                    <span className="text-sm text-gray-400">Expires:</span>
                    <p className="text-gray-200 font-medium flex items-center gap-2">
                      {generatedToken.expiresAt ? (
                        formatDate(generatedToken.expiresAt)
                      ) : form.ttl === null ? (
                        <>
                          <Infinity className="w-4 h-4 text-blue-400" />
                          <span className="text-blue-400">Never (Permanent)</span>
                        </>
                      ) : (
                        'N/A'
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-400">One-time use:</span>
                    <p className="text-gray-200 font-medium">
                      {form.oneTimeUse ? 'Yes' : 'No'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Success Message */}
              {success && (
                <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <p className="text-green-300 text-sm">{success}</p>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-3">
                <div className="flex gap-3">
                  {generatedToken.qrCode && (
                    <button
                      onClick={downloadQRCode}
                      className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-3 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2"
                    >
                      <Download className="w-5 h-5" />
                      Download QR
                    </button>
                  )}
                  <button
                    onClick={handleClose}
                    className="flex-1 bg-green-500 hover:bg-green-600 text-white py-3 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    Done
                  </button>
                </div>

                {/* BLUETOOTH TRANSFER OPTION */}
                {generatedToken.qrCode && (
                  <>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-700"></div>
                      </div>
                      <div className="relative flex justify-center text-xs">
                        <span className="px-2 bg-gray-800 text-gray-400">Bluetooth Transfer</span>
                      </div>
                    </div>

                    <div className="bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/50 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-purple-500/30 rounded-lg">
                          <Bluetooth className="w-5 h-5 text-purple-300" />
                        </div>
                        <div className="flex-1">
                          <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                            📱 Scan QR Code for Bluetooth Transfer
                          </h4>
                          <p className="text-purple-200 text-sm leading-relaxed">
                            The QR code above contains the recovery key <strong>and Bluetooth pairing data</strong>. 
                            When you scan it with another device, it will automatically initiate a Bluetooth connection 
                            to securely transfer the recovery key wirelessly.
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Configuration Form */
            <div className="space-y-4">
              {/* OPTION A: Help Banner */}
              <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-white font-semibold mb-1">What are Recovery Tokens?</h4>
                    <p className="text-blue-200 text-sm leading-relaxed">
                      Recovery tokens allow you to securely transfer and verify backups across devices. 
                      Generate a QR code or text key, then scan/enter it on another computer to restore your data.
                    </p>
                  </div>
                </div>
              </div>

              {/* Token Type */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Token Type *
                </label>
                <select
                  value={form.type}
                  onChange={(e) => {
                    setForm({ ...form, type: e.target.value, resourceId: '', resourceName: '' });
                    setSelectedFile(null);
                  }}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  {tokenTypes.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                
                {/* OPTION A: Show use case for selected type */}
                {tokenTypes.find(t => t.value === form.type)?.useCase && (
                  <p className="mt-2 text-xs text-gray-400 flex items-start gap-2">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    {tokenTypes.find(t => t.value === form.type).useCase}
                  </p>
                )}
              </div>

              {/* Custom Type Name */}
              {form.type === 'custom' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Custom Type Name *
                  </label>
                  <input
                    type="text"
                    value={form.customTypeName}
                    onChange={(e) => setForm({ ...form, customTypeName: e.target.value })}
                    placeholder="e.g., Application Config, Network Settings"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              )}

              {/* Resource Selection */}
              {(form.type === 'backup' || form.type === 'file' || form.type === 'diagnostic') && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Select Resource *
                  </label>
                  
                  {/* File Browser - Now FIRST priority */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                      type="button"
                      onClick={handleBrowseFile}
                      disabled={loading}
                      className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white py-3 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2"
                    >
                      <FolderOpen className="w-5 h-5" />
                      📄 Browse File
                    </button>
                    <button
                      type="button"
                      onClick={handleBrowseFolder}
                      disabled={loading}
                      className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white py-3 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2"
                    >
                      <FolderOpen className="w-5 h-5" />
                      📁 Browse Folder
                    </button>
                  </div>

                  {/* Loading indicator */}
                  {loading && (
                    <div className="mb-3 p-3 bg-blue-500/20 border border-blue-500/50 rounded-lg flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                      <p className="text-blue-300 text-sm">Calculating hash...</p>
                    </div>
                  )}

                  {/* Selected File Info */}
                  {selectedFile && (
                    <div className="mb-3 bg-green-500/20 border border-green-500/50 rounded-lg p-3 text-sm">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium mb-2 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                            Selected: {selectedFile.name}
                          </p>
                          <div className="text-gray-300 space-y-1 text-xs">
                            <p><span className="text-gray-400">Type:</span> {selectedFile.isDirectory ? 'Folder' : 'File'}</p>
                            <p><span className="text-gray-400">Size:</span> {formatBytes(selectedFile.size)}</p>
                            <p className="truncate" title={selectedFile.path}><span className="text-gray-400">Path:</span> {selectedFile.path}</p>
                            <p className="font-mono break-all"><span className="text-gray-400">Hash:</span> {selectedFile.hash}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedFile(null);
                            setForm(prev => ({ ...prev, resourceId: '', resourceName: '', resourceSelectionMode: 'browse' }));
                          }}
                          className="p-1 hover:bg-green-600/30 rounded transition ml-2"
                          title="Clear selection"
                        >
                          <X className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* OR Divider - only show if database has items */}
                  {((form.type === 'backup' && backups.length > 0) || 
                    (form.type === 'file' && conversions.length > 0) || 
                    (form.type === 'diagnostic' && diagnosticReports.length > 0)) && (
                    <div className="relative my-3">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-600"></div>
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-gray-800 text-gray-400">OR SELECT FROM DATABASE</span>
                      </div>
                    </div>
                  )}

                  {/* Database Selection - Now SECONDARY */}
                  {form.type === 'backup' && backups.length > 0 && (
                    <select
                      value={form.resourceSelectionMode === 'database' ? form.resourceId : ''}
                      onChange={handleResourceSelect}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">Select a backup...</option>
                      {backups.map(backup => (
                        <option key={backup.id} value={backup.id}>
                          {backup.name} - {formatBytes(backup.size)} - {formatDate(backup.created_at * 1000)}
                        </option>
                      ))}
                    </select>
                  )}

                  {form.type === 'file' && conversions.length > 0 && (
                    <select
                      value={form.resourceSelectionMode === 'database' ? form.resourceId : ''}
                      onChange={handleResourceSelect}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">Select a converted file...</option>
                      {conversions.map(conv => (
                        <option key={conv.id} value={conv.id}>
                          {conv.output_path.split(/[\\/]/).pop()} - {conv.output_format.toUpperCase()} - {formatDate(conv.timestamp)}
                        </option>
                      ))}
                    </select>
                  )}

                  {form.type === 'diagnostic' && diagnosticReports.length > 0 && (
                    <select
                      value={form.resourceSelectionMode === 'database' ? form.resourceId : ''}
                      onChange={handleResourceSelect}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">Select a diagnostic report...</option>
                      {diagnosticReports.map(report => (
                        <option key={report.id} value={report.id}>
                          {report.message.substring(0, 60)}... - {formatDate(report.timestamp * 1000)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Manual Resource ID for other types */}
              {!['backup', 'file', 'diagnostic'].includes(form.type) && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Select Resource *
                  </label>
                  
                  {/* File Browser */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      type="button"
                      onClick={handleBrowseFile}
                      disabled={loading}
                      className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white py-2 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2"
                    >
                      <FolderOpen className="w-4 h-4" />
                      📄 Browse File
                    </button>
                    <button
                      type="button"
                      onClick={handleBrowseFolder}
                      disabled={loading}
                      className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white py-2 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2"
                    >
                      <FolderOpen className="w-4 h-4" />
                      📁 Browse Folder
                    </button>
                  </div>

                  {/* Selected File Info */}
                  {selectedFile && (
                    <div className="mt-2 bg-gray-700/50 rounded-lg p-3 text-sm">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium mb-1">📦 Selected: {selectedFile.name}</p>
                          <div className="text-gray-400 space-y-1">
                            <p>Type: {selectedFile.isDirectory ? 'Folder' : 'File'}</p>
                            <p>Size: {formatBytes(selectedFile.size)}</p>
                            <p className="truncate" title={selectedFile.path}>Path: {selectedFile.path}</p>
                            <p className="font-mono text-xs break-all">
                              Hash: {selectedFile.hash}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedFile(null);
                            setForm(prev => ({ ...prev, resourceId: '', resourceName: '' }));
                          }}
                          className="p-1 hover:bg-gray-600 rounded transition ml-2"
                        >
                          <X className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* OR Divider */}
                  {!selectedFile && (
                    <>
                      <div className="relative my-3">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-gray-600"></div>
                        </div>
                        <div className="relative flex justify-center text-sm">
                          <span className="px-2 bg-gray-800 text-gray-400">OR</span>
                        </div>
                      </div>

                      {/* Manual Resource Description */}
                      <input
                        type="text"
                        value={form.resourceName}
                        onChange={(e) => {
                          const value = e.target.value;
                          setForm({ ...form, resourceId: value, resourceName: value });
                        }}
                        placeholder="Enter resource description or identifier"
                        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        💡 Tip: Browse for a file/folder above for automatic hash generation
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* TTL Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Time-to-Live (TTL) *
                </label>
                <select
                  value={form.ttl === null ? 'permanent' : form.ttl}
                  onChange={(e) => {
                    const value = e.target.value === 'permanent' ? null : parseInt(e.target.value);
                    setForm({ ...form, ttl: value });
                  }}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  {ttlOptions.map(option => (
                    <option key={option.value === null ? 'permanent' : option.value} value={option.value === null ? 'permanent' : option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* One-time Use Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="oneTimeUse"
                  checked={form.oneTimeUse}
                  onChange={(e) => setForm({ ...form, oneTimeUse: e.target.checked })}
                  className="w-4 h-4 text-green-500 bg-gray-700 border-gray-600 rounded focus:ring-green-500"
                />
                <label htmlFor="oneTimeUse" className="text-sm text-gray-300">
                  One-time use only (token becomes invalid after first verification)
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-600 text-white py-2 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <QrCode className="w-4 h-4" />
                      Generate Token
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </>
  );
};

export default TokenConfigModal;
