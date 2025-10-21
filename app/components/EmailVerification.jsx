import React, { useState, useEffect } from 'react';

function EmailVerification({ email, onVerificationSuccess, onBack }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await window.electronAPI.auth.verifyEmail(email, code);

      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          onVerificationSuccess();
        }, 1500);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setResending(true);

    try {
      const result = await window.electronAPI.auth.resendCode(email);

      if (result.success) {
        setCooldown(60); // 60 second cooldown
        // Show the code in console for development
        if (result.verificationCode) {
          console.log('New verification code:', result.verificationCode);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-ocean-deep flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-ocean-primary rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">📧</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Verify Your Email</h1>
          <p className="text-ocean-surface">
            We sent a verification code to
            <br />
            <span className="font-medium">{email}</span>
          </p>
        </div>

        {/* Verification Form */}
        <div className="card">
          {success ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-ocean-success/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-ocean-success"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-ocean-success mb-2">Email Verified!</h3>
              <p className="text-gray-400">Redirecting to login...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-ocean-surface mb-2">
                  Verification Code
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
                  Enter the 6-digit code from your email
                </p>
              </div>

              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center"
                disabled={loading || code.length !== 6}
              >
                {loading ? (
                  <>
                    <span className="spinner mr-2"></span>
                    Verifying...
                  </>
                ) : (
                  'Verify Email'
                )}
              </button>

              <div className="text-center">
                <p className="text-sm text-gray-400 mb-2">Didn&apos;t receive the code?</p>
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-sm text-ocean-surface hover:text-ocean-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={resending || cooldown > 0}
                >
                  {resending
                    ? 'Sending...'
                    : cooldown > 0
                    ? `Resend in ${cooldown}s`
                    : 'Resend Code'}
                </button>
              </div>
            </form>
          )}

          {!success && (
            <div className="mt-6 text-center">
              <button
                onClick={onBack}
                className="text-sm text-gray-400 hover:text-ocean-surface transition-colors"
                disabled={loading}
              >
                ← Back to signup
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 p-4 bg-ocean-container/50 rounded-lg">
          <p className="text-xs text-gray-400 text-center">
            💡 <strong>Development Mode:</strong> Check the browser console for the verification code
          </p>
        </div>
      </div>
    </div>
  );
}

export default EmailVerification;
