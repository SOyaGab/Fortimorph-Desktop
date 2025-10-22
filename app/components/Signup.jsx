import React, { useState } from 'react';
import DevBanner from './DevBanner';

function Signup({ onSwitchToLogin, onSignupSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      console.log('Attempting signup for:', email);
      const result = await window.electronAPI.auth.signup(email, password);
      console.log('Signup response:', result);

      if (result.success) {
        if (result.autoVerified) {
          // In dev mode, account is auto-verified, go straight to login
          alert(result.message + '\n\nYou can now login with your credentials.');
          onSwitchToLogin();
        } else {
          // Production mode, show verification screen
          onSignupSuccess(email, result.verificationCode);
        }
      } else {
        setError(result.error || 'Signup failed');
      }
    } catch (err) {
      console.error('Signup error:', err);
      setError('Network error: ' + (err.message || 'Please check console for details'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ocean-deep flex items-center justify-center p-4">
      <DevBanner />
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-ocean-primary rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold text-white">FM</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Create Account</h1>
          <p className="text-ocean-surface">Start optimizing your system</p>
        </div>

        {/* Signup Form */}
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
              <input
                type="password"
                className="input-field w-full"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                minLength={8}
              />
              <p className="text-xs text-gray-400 mt-1">Minimum 8 characters</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-ocean-surface mb-2">
                Confirm Password
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
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner mr-2"></span>
                  Creating account...
                </>
              ) : (
                'Sign Up'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-400 text-sm">
              Already have an account?{' '}
              <button
                onClick={onSwitchToLogin}
                className="text-ocean-surface hover:text-ocean-primary font-medium transition-colors"
                disabled={loading}
              >
                Sign in
              </button>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            By creating an account, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}

export default Signup;
