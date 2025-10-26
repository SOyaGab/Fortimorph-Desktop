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
        setError(''); // Clear any previous errors
        // Show success in UI
        const successDiv = document.createElement('div');
        successDiv.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg';
        successDiv.textContent = '✓ New verification code sent!';
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.remove(), 3000);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Failed to resend verification code');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-ocean-deep flex items-center justify-center p-4 animate-fadeIn">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-ocean-primary to-ocean-surface rounded-xl flex items-center justify-center mx-auto mb-4 shadow-ocean-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Verify Your Email</h1>
          <p className="text-ocean-surface text-sm">
            We sent a verification code to
            <br />
            <span className="font-semibold text-ocean-text">{email}</span>
          </p>
        </div>

        {/* Verification Form */}
        <div className="card animate-slideIn">
          {success ? (
            <div className="text-center py-8 animate-fadeIn">
              <div className="w-20 h-20 bg-ocean-success/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse-custom">
                <svg
                  className="w-10 h-10 text-ocean-success"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-ocean-success mb-2">Email Verified!</h3>
              <p className="text-ocean-surface">Redirecting to login...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 animate-fadeIn">
                  <div className="flex items-center space-x-2">
                    <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                </div>
              )}

              <div className="bg-ocean-primary/10 border border-ocean-primary/30 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-ocean-surface" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-ocean-surface mb-1">
                      Check Your Email
                    </h3>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      We sent a 6-digit verification code to your email address. Enter it below to verify your account.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-ocean-surface mb-2">
                  Verification Code
                </label>
                <input
                  type="text"
                  className="input-field w-full text-center text-2xl tracking-[0.75em] font-mono font-semibold placeholder:tracking-normal placeholder:text-base focus:ring-ocean-primary/30"
                  placeholder="Enter 6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  disabled={loading}
                  maxLength={6}
                  autoComplete="off"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-2 text-center">
                  Enter the 6-digit code from your email
                </p>
              </div>

              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed shadow-ocean-lg hover:shadow-ocean-xl"
                disabled={loading || code.length !== 6}
              >
                {loading ? (
                  <>
                    <span className="spinner mr-2"></span>
                    Verifying...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Verify Email
                  </>
                )}
              </button>

              <div className="text-center pt-4 border-t border-ocean-container/50">
                <p className="text-sm text-gray-400 mb-3">Didn&apos;t receive the code?</p>
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-sm text-ocean-surface hover:text-ocean-primary transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed font-medium inline-flex items-center"
                  disabled={resending || cooldown > 0}
                >
                  {resending ? (
                    <>
                      <span className="spinner mr-2 !w-4 !h-4"></span>
                      Sending...
                    </>
                  ) : cooldown > 0 ? (
                    <>
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Resend in {cooldown}s
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Resend Code
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {!success && (
            <div className="mt-6 pt-6 border-t border-ocean-container/50 text-center">
              <button
                onClick={onBack}
                className="text-sm text-gray-400 hover:text-ocean-surface transition-colors inline-flex items-center font-medium"
                disabled={loading}
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to signup
              </button>
            </div>
          )}
        </div>

        {/* Helpful Tip */}
        <div className="mt-6 p-4 bg-ocean-warning/10 border border-ocean-warning/30 rounded-lg animate-fadeIn">
          <div className="flex items-start space-x-3">
            <svg className="w-5 h-5 text-ocean-warning flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-xs text-ocean-warning leading-relaxed">
              <strong>Tip:</strong> Check your spam or junk folder if you don&apos;t see the email. The code expires in 10 minutes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EmailVerification;
