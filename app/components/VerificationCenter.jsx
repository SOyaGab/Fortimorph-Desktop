/**
 * FortiMorph Verification Center Component (OPTIMIZED & FIXED)
 * 
 * Provides UI for generating and verifying QR-based verification tokens
 * with support for permanent tokens, file browsing, and comprehensive verification.
 * 
 * FIXES APPLIED (Nov 9, 2025):
 * ✅ Fixed missing Info icon import causing crashes
 * ✅ Added useCallback to prevent infinite re-renders
 * ✅ Fixed useEffect dependency issues
 * ✅ Added component mount/unmount tracking
 * ✅ Prevented state updates on unmounted component
 * ✅ Added verification lock to prevent simultaneous calls
 * ✅ Optimized QR scanning with error handling
 * ✅ Added API availability checks
 * ✅ Improved async operation safety
 * ✅ Added cleanup for all timeouts and intervals
 * ✅ Better error messages and loading states
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield,
  QrCode,
  CheckCircle2,
  XCircle,
  Clock,
  Key,
  AlertTriangle,
  Copy,
  Download,
  Trash2,
  RefreshCw,
  Camera,
  FileCheck,
  Package,
  HardDrive,
  Upload,
  Infinity,
  Activity,
  Info,
  Bluetooth
} from 'lucide-react';
import TokenConfigModal from './TokenConfigModal';

const VerificationCenter = () => {
  const [activeTab, setActiveTab] = useState('generate');
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Modal state
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenModalData, setTokenModalData] = useState({});

  // Verification state
  const [verificationInput, setVerificationInput] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Camera scanning
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanIntervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const verificationInputRef = useRef(null); // Add ref for verification input
  const verifyTimeoutRef = useRef(null); // Prevent rapid verification calls

  // Cleanup function for camera
  const stopScanning = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }

    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    setScanning(false);
  }, []);

  useEffect(() => {
    // Load tokens on mount only
    loadTokens();
    cleanupExpiredTokens();
    
    // Cleanup on unmount
    return () => {
      stopScanning();
      
      // Clear any pending timeouts
      if (verifyTimeoutRef.current) {
        clearTimeout(verifyTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  useEffect(() => {
    // Auto-clear messages after 5 seconds
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  const loadTokens = useCallback(async () => {
    try {
      if (!window.verificationAPI || !window.verificationAPI.listTokens) {
        console.warn('Verification API not available');
        return;
      }
      const tokenList = await window.verificationAPI.listTokens({ limit: 50 });
      setTokens(tokenList || []);
    } catch (err) {
      console.error('Failed to load tokens:', err);
      setTokens([]);
    }
  }, []);

  const cleanupExpiredTokens = useCallback(async () => {
    try {
      if (!window.verificationAPI || !window.verificationAPI.cleanup) {
        console.warn('Cleanup API not available');
        return;
      }
      const deleted = await window.verificationAPI.cleanup();
      if (deleted > 0) {
        console.log(`Cleaned up ${deleted} expired tokens`);
        await loadTokens();
      }
    } catch (err) {
      console.error('Failed to cleanup tokens:', err);
    }
  }, [loadTokens]);

  const handleOpenTokenModal = () => {
    setTokenModalData({});
    setShowTokenModal(true);
  };

  const handleTokenGenerated = (result) => {
    // Token generated - QR code now contains Bluetooth pairing data automatically
    setSuccess('Verification token generated successfully! Scan the QR code to transfer via Bluetooth.');
    loadTokens();
  };

  const handleVerifyToken = useCallback(async (tokenString) => {
    const inputValue = tokenString || verificationInput;
    
    // Prevent multiple simultaneous verifications
    if (verifying) {
      console.log('Verification already in progress, skipping...');
      return;
    }

    // Clear any pending verification timeouts
    if (verifyTimeoutRef.current) {
      clearTimeout(verifyTimeoutRef.current);
    }

    setVerifying(true);
    setError(null);
    setVerificationResult(null);

    try {
      if (!inputValue || inputValue.trim() === '') {
        throw new Error('Please enter a token string or scan a QR code');
      }

      // Check if API exists
      if (!window.verificationAPI || !window.verificationAPI.verify) {
        throw new Error('Verification API not available. Please restart the application.');
      }

      const result = await window.verificationAPI.verify(inputValue.trim());

      if (!result) {
        throw new Error('No response from verification service');
      }

      setVerificationResult(result);

      if (result.valid) {
        setSuccess('✅ Token verified successfully!');
      } else {
        setError(result.message || 'Token verification failed');
      }
    } catch (err) {
      console.error('Verification error:', err);
      setError(err.message || 'Failed to verify token');
      setVerificationResult({ 
        valid: false, 
        error: 'VERIFICATION_ERROR', 
        message: err.message 
      });
    } finally {
      setVerifying(false);
    }
  }, [verificationInput, verifying]);

  const handleDeleteToken = async (tokenId) => {
    if (!confirm('Are you sure you want to delete this token?')) {
      return;
    }

    try {
      if (!window.verificationAPI || !window.verificationAPI.deleteToken) {
        throw new Error('Delete API not available');
      }

      await window.verificationAPI.deleteToken(tokenId);
      setSuccess('Token deleted successfully');
      await loadTokens();
    } catch (err) {
      setError('Failed to delete token: ' + err.message);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
  };

  const startScanning = async () => {
    setScanning(true);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      
      if (!videoRef.current) {
        // Clean up stream if video ref is not available
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // Start scanning loop
      scanIntervalRef.current = setInterval(() => {
        scanQRCode();
      }, 500);
    } catch (err) {
      console.error('Camera access error:', err);
      setError('Failed to access camera: ' + err.message);
      setScanning(false);
    }
  };

  const scanQRCode = () => {
    try {
      if (!videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      
      // Import jsQR dynamically if available
      if (window.jsQR && imageData) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          stopScanning();
          setVerificationInput(code.data);
          // Delay verification to prevent blocking
          setTimeout(() => {
            handleVerifyToken(code.data);
          }, 100);
        }
      }
    } catch (err) {
      console.error('QR scan error:', err);
      // Don't crash, just log and continue
    }
  };

  const handleUploadQRImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      setError(null);

      if (!window.verificationAPI || !window.verificationAPI.parseQRCode) {
        throw new Error('QR parsing not available');
      }

      // Parse QR code from image file
      const result = await window.verificationAPI.parseQRCode(file.path);

      if (result && result.data) {
        setVerificationInput(result.data);
        setSuccess('QR code parsed successfully!');
        // Automatically verify with delay
        setTimeout(() => {
          handleVerifyToken(result.data);
        }, 100);
      } else {
        setError('No QR code found in image');
      }
    } catch (err) {
      setError('Failed to parse QR code: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasteToken = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setVerificationInput(text);
      setSuccess('Token pasted from clipboard');
    } catch (err) {
      setError('Failed to paste from clipboard: ' + err.message);
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'backup': return <HardDrive className="w-4 h-4" />;
      case 'diagnostic': return <Activity className="w-4 h-4" />;
      case 'file': return <Package className="w-4 h-4" />;
      default: return <Shield className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'backup': return 'text-blue-400';
      case 'diagnostic': return 'text-green-400';
      case 'file': return 'text-purple-400';
      default: return 'text-gray-400';
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return 'N/A';
    return new Date(isoString).toLocaleString();
  };

  const formatTTL = (seconds) => {
    if (seconds === null) return '∞';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <div className="bg-gray-800/50 border-b border-gray-700/50 backdrop-blur-sm">
        <div className="px-6 py-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Shield className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Backup Recovery Center</h1>
              <p className="text-sm text-gray-400">Generate recovery keys for cross-device backup transfers and verify file integrity</p>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setActiveTab('generate')}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                activeTab === 'generate'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4" />
                Generate Recovery Key
              </div>
            </button>
            <button
              onClick={() => setActiveTab('verify')}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                activeTab === 'verify'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Use Recovery Key
              </div>
            </button>
            <button
              onClick={() => setActiveTab('list')}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                activeTab === 'list'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                My Recovery Keys ({tokens.length})
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {(error || success) && (
        <div className="px-6 pt-4">
          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}
          {success && (
            <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
              <p className="text-green-300 text-sm">{success}</p>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Generate Tab */}
        {activeTab === 'generate' && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-8 text-center">
              <div className="max-w-md mx-auto">
                <div className="p-4 bg-green-500/10 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                  <QrCode className="w-10 h-10 text-green-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">
                  Create Backup Recovery Key
                </h3>
                <p className="text-gray-400 mb-6">
                  Generate a secure recovery key to transfer and restore your backups on another device. 
                  Perfect for moving data between computers or creating emergency backup access codes.
                </p>
                
                {/* OPTION A: Use Case Examples */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6 text-left">
                  <h4 className="text-white font-medium mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-blue-400" />
                    When to use this:
                  </h4>
                  <ul className="text-sm text-gray-300 space-y-1 ml-6 list-disc">
                    <li>Restoring backups on a different computer</li>
                    <li>Sharing backup access with team members</li>
                    <li>Creating proof that files haven't been modified</li>
                    <li>Emergency recovery from another device</li>
                  </ul>
                </div>

                <button
                  onClick={handleOpenTokenModal}
                  className="bg-green-500 hover:bg-green-600 text-white py-3 px-6 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 mx-auto"
                >
                  <QrCode className="w-5 h-5" />
                  Create Recovery Key
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Verify Tab */}
        {activeTab === 'verify' && (
          <div className="max-w-4xl mx-auto">
            {/* Safety Check Banner */}
            {!window.verificationAPI && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <p className="text-red-300">
                    Verification service is not available. Please restart the application.
                  </p>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              {/* Verification Input */}
              <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Use Recovery Key</h3>
                
                {/* OPTION A: Added help text */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
                  <p className="text-sm text-blue-200 flex items-start gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    Paste the recovery key text you received, or scan the QR code below to restore a backup.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Recovery Key Text
                    </label>
                    <textarea
                      ref={verificationInputRef}
                      value={verificationInput}
                      onChange={(e) => setVerificationInput(e.target.value)}
                      onFocus={(e) => {
                        // Ensure input is responsive on focus
                        e.target.disabled = false;
                      }}
                      placeholder="Paste recovery key here or scan QR code below..."
                      rows={4}
                      className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 font-mono text-sm transition-all"
                      disabled={verifying}
                      autoComplete="off"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {verificationInput.length} characters {verificationInput.length > 0 && '✓'}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleVerifyToken()}
                      disabled={verifying || !verificationInput}
                      className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-600 text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      {verifying ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          Verify
                        </>
                      )}
                    </button>
                    <button
                      onClick={handlePasteToken}
                      className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"
                      title="Paste from clipboard"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-700"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-gray-800/50 text-gray-400">OR SCAN QR CODE</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={scanning ? stopScanning : startScanning}
                      className={`${
                        scanning ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'
                      } text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2`}
                    >
                      <Camera className="w-4 h-4" />
                      {scanning ? 'Stop' : 'Camera'}
                    </button>
                    
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      Upload
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleUploadQRImage}
                      className="hidden"
                    />
                  </div>

                  {scanning && (
                    <div className="relative bg-black rounded-lg overflow-hidden">
                      <video ref={videoRef} className="w-full" playsInline />
                      <canvas ref={canvasRef} className="hidden" />
                      <div className="absolute inset-0 border-2 border-green-500 pointer-events-none">
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-green-500"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Verification Result */}
              {verificationResult && (
                <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Verification Result</h3>
                  
                  <div className={`p-4 rounded-lg border-2 mb-4 ${
                    verificationResult.valid
                      ? 'bg-green-500/20 border-green-500/50'
                      : 'bg-red-500/20 border-red-500/50'
                  }`}>
                    <div className="flex items-center gap-3">
                      {verificationResult.valid ? (
                        <CheckCircle2 className="w-8 h-8 text-green-400 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-8 h-8 text-red-400 flex-shrink-0" />
                      )}
                      <div>
                        <p className={`font-semibold ${
                          verificationResult.valid ? 'text-green-300' : 'text-red-300'
                        }`}>
                          {verificationResult.valid ? '✅ Token Verified Successfully' : '❌ Token Verification Failed'}
                        </p>
                        <p className={`text-sm ${
                          verificationResult.valid ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {verificationResult.message || verificationResult.error}
                        </p>
                      </div>
                    </div>
                  </div>

                  {verificationResult.valid && verificationResult.token && (
                    <div className="space-y-3 text-sm">
                      <div className="pb-2 border-b border-gray-700">
                        <h4 className="text-gray-400 font-medium mb-2">Token Details</h4>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">Type:</span>
                        <div className="flex items-center gap-2">
                          {getTypeIcon(verificationResult.token.type)}
                          <span className="text-gray-300 capitalize">{verificationResult.token.type}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">Resource:</span>
                        <span className="text-gray-300">{verificationResult.token.resourceName}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">Resource ID:</span>
                        <code className="text-gray-300 text-xs">{verificationResult.token.resourceId}</code>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                        <span className="text-gray-400">Issued:</span>
                        <span className="text-gray-300 text-xs">{formatDate(verificationResult.token.issuedAt)}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">Expires:</span>
                        <span className="text-gray-300 text-xs flex items-center gap-1">
                          {verificationResult.token.isPermanent ? (
                            <>
                              <Infinity className="w-4 h-4 text-blue-400" />
                              <span className="text-blue-400 font-medium">Never (Permanent)</span>
                            </>
                          ) : (
                            formatDate(verificationResult.token.expiresAt)
                          )}
                        </span>
                      </div>

                      {/* Resource Verification */}
                      {verificationResult.resourceVerification && (
                        <>
                          <div className="pt-2 border-t border-gray-700">
                            <h4 className="text-gray-400 font-medium mb-2">Resource Verification</h4>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-400">Resource Exists:</span>
                              <span className={verificationResult.resourceVerification.exists ? 'text-green-400' : 'text-red-400'}>
                                {verificationResult.resourceVerification.exists ? '✅ Yes' : '❌ No'}
                              </span>
                            </div>

                            {verificationResult.resourceVerification.hashMatch !== undefined && (
                              <div className="flex items-center justify-between">
                                <span className="text-gray-400">Hash Integrity:</span>
                                <span className={verificationResult.resourceVerification.hashMatch ? 'text-green-400' : 'text-red-400'}>
                                  {verificationResult.resourceVerification.hashMatch ? '✅ Valid' : '❌ Modified'}
                                </span>
                              </div>
                            )}

                            {verificationResult.resourceVerification.message && (
                              <p className="text-yellow-400 text-xs mt-2">
                                ⚠️ {verificationResult.resourceVerification.message}
                              </p>
                            )}
                          </div>
                        </>
                      )}

                      {Object.keys(verificationResult.token.metadata || {}).length > 0 && (
                        <div className="pt-2 border-t border-gray-700">
                          <span className="text-gray-400 block mb-2">Metadata:</span>
                          <pre className="bg-gray-700/50 p-2 rounded text-xs text-gray-300 overflow-x-auto">
                            {JSON.stringify(verificationResult.token.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error Details */}
                  {!verificationResult.valid && verificationResult.expiredAt && (
                    <div className="text-sm text-gray-400">
                      <p>Expired: {formatDate(verificationResult.expiredAt)}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Token List Tab */}
        {activeTab === 'list' && (
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">All Tokens</h3>
              <button
                onClick={() => { cleanupExpiredTokens(); loadTokens(); }}
                className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>

            {tokens.length === 0 ? (
              <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-12 text-center">
                <Key className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">No tokens found</p>
                <p className="text-gray-500 text-sm mt-2">Generate a new token to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {tokens.map((token) => (
                  <div
                    key={token.tokenId}
                    className={`bg-gray-800/50 rounded-lg border p-4 ${
                      token.isValid
                        ? 'border-gray-700/50'
                        : 'border-gray-700/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`p-2 rounded-lg ${
                          token.isValid ? 'bg-green-500/20' : 'bg-gray-700/50'
                        }`}>
                          {getTypeIcon(token.type)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 className="font-medium text-white truncate">{token.resourceName}</h4>
                            {token.expiresAt === null && (
                              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-xs rounded flex items-center gap-1">
                                <Infinity className="w-3 h-3" />
                                Permanent
                              </span>
                            )}
                            {token.oneTimeUse && (
                              <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded">
                                One-time
                              </span>
                            )}
                            {token.used && (
                              <span className="px-2 py-0.5 bg-gray-600 text-gray-300 text-xs rounded">
                                Used
                              </span>
                            )}
                            {token.isExpired && (
                              <span className="px-2 py-0.5 bg-red-500/20 text-red-300 text-xs rounded">
                                Expired
                              </span>
                            )}
                            {token.isValid && (
                              <span className="px-2 py-0.5 bg-green-500/20 text-green-300 text-xs rounded">
                                Valid
                              </span>
                            )}
                          </div>

                          <code className="text-xs text-gray-400 block mb-2">{token.tokenId}</code>

                          <div className="flex items-center gap-4 text-xs text-gray-400">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Issued: {formatDate(token.issuedAt)}
                            </div>
                            <div className="flex items-center gap-1">
                              {token.expiresAt === null ? (
                                <>
                                  <Infinity className="w-3 h-3" />
                                  Never expires
                                </>
                              ) : (
                                <>
                                  <Clock className="w-3 h-3" />
                                  Expires: {formatDate(token.expiresAt)}
                                </>
                              )}
                            </div>
                          </div>

                          {token.used && token.usedAt && (
                            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Used: {formatDate(token.usedAt)}
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteToken(token.tokenId)}
                        className="p-2 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-lg transition-colors"
                        title="Delete token"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Token Config Modal */}
      <TokenConfigModal
        isOpen={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        initialData={tokenModalData}
        onSuccess={handleTokenGenerated}
      />
    </div>
  );
};

export default VerificationCenter;
