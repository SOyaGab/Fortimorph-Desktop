import React, { useState } from 'react';
import { Key, ArrowLeft, Lightbulb } from 'lucide-react';

function PasswordReset({ onBack, onResetSuccess }) {
  const [step, setStep] = useState(1); // 1: email, 2: code & new password
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRequestReset = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await window.electronAPI.auth.requestPasswordReset(email);

      if (result.success) {
        setStep(2);
        // Show the code in console for development
        if (result.resetCode) {
          console.log('Password reset code:', result.resetCode);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const result = await window.electronAPI.auth.resetPassword(email, code, newPassword);

      if (result.success) {
        onResetSuccess();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ocean-deep flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-ocean-warning/20 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Key className="w-8 h-8 text-ocean-warning" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Reset Password</h1>
          <p className="text-ocean-surface">
            {step === 1 ? 'Enter your email to receive a reset code' : 'Enter code and new password'}
          </p>
        </div>

        {/* Reset Form */}
        <div className="card">
          {step === 1 ? (
            <form onSubmit={handleRequestReset} className="space-y-5">
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

              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner mr-2"></span>
                    Sending code...
                  </>
                ) : (
                  'Send Reset Code'
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-5">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-ocean-surface mb-2">
                  Reset Code
                </label>
                <input
                  type="text"
                  className="input-field w-full text-center text-2xl tracking-widest"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  disabled={loading}
                  maxLength={6}
                />
                <p className="text-xs text-gray-400 mt-1 text-center">
                  Check your email for the 6-digit code
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-ocean-surface mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  className="input-field w-full"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={loading}
                  minLength={8}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ocean-surface mb-2">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  className="input-field w-full"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center"
                disabled={loading || code.length !== 6}
              >
                {loading ? (
                  <>
                    <span className="spinner mr-2"></span>
                    Resetting password...
                  </>
                ) : (
                  'Reset Password'
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setCode('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setError('');
                }}
                className="w-full text-sm text-gray-400 hover:text-ocean-surface transition-colors flex items-center justify-center"
                disabled={loading}
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Use different email
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={onBack}
              className="text-sm text-gray-400 hover:text-ocean-surface transition-colors flex items-center justify-center mx-auto"
              disabled={loading}
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to login
            </button>
          </div>
        </div>

        {step === 2 && (
          <div className="mt-6 p-4 bg-ocean-container/50 rounded-lg">
            <p className="text-xs text-gray-400 text-center flex items-center justify-center">
              <Lightbulb className="w-4 h-4 mr-1" />
              <strong>Development Mode:</strong>&nbsp;Check the browser console for the reset code
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PasswordReset;
