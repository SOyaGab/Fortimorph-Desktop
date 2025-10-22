import React, { useState } from 'react';
import DevBanner from './DevBanner';

function Login({ onSwitchToSignup, onSwitchToReset, onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      console.log('Attempting login for:', email);
      const result = await window.electronAPI.auth.login(email, password);
      console.log('Login response:', result);

      if (result.success) {
        console.log('Login successful, user:', result.user);
        onLoginSuccess(result.user);
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
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
              <input
                type="password"
                className="input-field w-full"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
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
        </div>
      </div>
    </div>
  );
}

export default Login;
