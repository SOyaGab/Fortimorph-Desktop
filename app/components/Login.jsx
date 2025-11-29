import React, { useState } from 'react';
import { Eye, EyeOff, Mail, Wrench, Check, X } from 'lucide-react';

function Login({ onSwitchToSignup, onSwitchToReset, onLoginSuccess, onSwitchToVerify }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNeedsVerification(false);
    setLoading(true);

    try {
      console.log('Attempting login for:', email);
      const result = await window.electronAPI.auth.login(email, password);
      console.log('Login result:', result);

      if (result.success) {
        console.log('Login successful, calling onLoginSuccess');
        onLoginSuccess(result.user);
      } else {
        console.error('Login failed:', result.error);
        // Check if it's an email verification issue
        if (result.emailVerified === false) {
          setNeedsVerification(true);
          setError('Your email is not verified. Please check your email or click below to resend the verification code.');
        } else {
          setError(result.error || 'Login failed. Please try again.');
        }
      }
    } catch (err) {
      console.error('Login exception:', err);
      setError('An unexpected error occurred. Please check the console for details.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!email) {
      setError('Please enter your email address first');
      return;
    }

    setResendingCode(true);
    setError('');

    try {
      const result = await window.electronAPI.auth.resendVerification(email);
      if (result.success) {
        alert('Verification code sent! Please check your email.');
        // Switch to verification view if callback is provided
        if (onSwitchToVerify) {
          onSwitchToVerify(email);
        }
      } else {
        setError(result.error || 'Failed to resend verification code');
      }
    } catch (err) {
      console.error('Resend verification error:', err);
      setError('Failed to resend verification code. Please try again.');
    } finally {
      setResendingCode(false);
    }
  };

  const handleDebugUsers = async () => {
    try {
      const result = await window.electronAPI.auth.debugUsers();
      if (result.success) {
        setDebugInfo(result);
        setShowDebug(true);
      }
    } catch (err) {
      console.error('Debug error:', err);
    }
  };

  const handleManualVerify = async (uid) => {
    try {
      const result = await window.electronAPI.auth.manualVerify(uid);
      if (result.success) {
        alert('User verified successfully! You can now log in.');
        setShowDebug(false);
        // Refresh debug info
        handleDebugUsers();
      } else {
        alert('Failed to verify: ' + result.error);
      }
    } catch (err) {
      console.error('Manual verify error:', err);
      alert('Error: ' + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-ocean-deep flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-ocean-primary rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold text-white">FM</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
          <p className="text-ocean-surface">Sign in to FortiMorph</p>
        </div>

        {/* Login Form */}
        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-ocean-surface mb-2">
                Email Address
              </label>
              <input
                type="email"
                className="input-field w-full"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ocean-surface mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className="input-field w-full pr-12"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ocean-primary hover:text-ocean-surface transition-colors"
                  disabled={loading}
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={onSwitchToReset}
                className="text-sm text-ocean-surface hover:text-ocean-primary transition-colors"
                disabled={loading}
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              className="btn-primary w-full flex items-center justify-center"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner mr-2"></span>
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>

            {/* Resend Verification Button */}
            {needsVerification && (
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendingCode}
                className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-medium px-4 py-2 rounded-lg transition-all duration-150 disabled:opacity-50 flex items-center justify-center"
              >
                {resendingCode ? (
                  <>
                    <span className="spinner mr-2"></span>
                    Sending Code...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4 mr-2" /> Resend Verification Code
                  </>
                )}
              </button>
            )}
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-400 text-sm">
              Don&apos;t have an account?{' '}
              <button
                onClick={onSwitchToSignup}
                className="text-ocean-surface hover:text-ocean-primary font-medium transition-colors"
                disabled={loading}
              >
                Sign up
              </button>
            </p>
          </div>

          {/* Debug Section */}
          <div className="mt-4 text-center">
            <button
              onClick={handleDebugUsers}
              className="text-xs text-gray-500 hover:text-gray-300 underline flex items-center justify-center gap-1"
            >
              <Wrench className="w-3 h-3" /> Account Issues? Click here
            </button>
          </div>
        </div>

        {/* Debug Modal */}
        {showDebug && debugInfo && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className="bg-[#001D3D] rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto border-2 border-[#0077B6]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-[#FFD60A]">Account Troubleshooting</h3>
                <button
                  onClick={() => setShowDebug(false)}
                  className="text-white hover:text-red-400 text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-white font-semibold mb-2">Verification Codes Table:</h4>
                  {debugInfo.verificationCodes && debugInfo.verificationCodes.length > 0 ? (
                    <div className="bg-[#003566] rounded p-3 text-sm">
                      {debugInfo.verificationCodes.map((vc, index) => (
                        <div key={index} className="mb-2 pb-2 border-b border-gray-600 last:border-0">
                          <p className="text-white">UID: {vc.uid}</p>
                          <p className="text-gray-400 flex items-center gap-1">Verified: {vc.verified ? (<><span className="text-green-400">Yes</span><Check className="w-3 h-3 text-green-400" /></>) : (<><span className="text-red-400">No</span><X className="w-3 h-3 text-red-400" /></>)}</p>
                          {!vc.verified && (
                            <button
                              onClick={() => handleManualVerify(vc.uid)}
                              className="mt-2 bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" /> Verify This Account
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-400">No verification records found.</p>
                  )}
                </div>

                <div className="bg-yellow-900/30 border border-yellow-600 rounded p-3 text-yellow-200 text-sm">
                  <p className="font-semibold mb-1">What to do:</p>
                  <ol className="list-decimal ml-4 space-y-1">
                    <li>Find your account&apos;s UID above</li>
                    <li>Click &quot;Verify This Account&quot; button</li>
                    <li>Close this window and try logging in again</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;
