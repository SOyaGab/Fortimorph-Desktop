import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Signup from './components/Signup';
import EmailVerification from './components/EmailVerification';
import PasswordReset from './components/PasswordReset';
import Dashboard from './components/Dashboard';

function App() {
  const [authView, setAuthView] = useState('login'); // 'login', 'signup', 'verify', 'reset'
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [verificationEmail, setVerificationEmail] = useState('');

  useEffect(() => {
    // Check if user is already authenticated
    if (window.electronAPI) {
      console.log('Electron API available, checking session...');
      
      window.electronAPI.auth.checkSession()
        .then((session) => {
          console.log('Session check result:', session);
          if (session.isAuthenticated) {
            setIsAuthenticated(true);
            setCurrentUser(session.user);
          } else {
            console.log('No active session, showing login page');
          }
        })
        .catch((error) => {
          console.error('Error checking session:', error);
          // Show login page on error
          setIsAuthenticated(false);
        });

      // Listen for session expiry
      const unsubscribe = window.electronAPI.onSessionExpired(() => {
        setIsAuthenticated(false);
        setCurrentUser(null);
        setAuthView('login');
        alert('Your session has expired. Please login again.');
      });
      
      return () => {
        // Cleanup listener if needed
        if (unsubscribe && typeof unsubscribe === 'function') {
          unsubscribe();
        }
      };
    } else {
      console.error('Electron API not available!');
      // Still show login page even if API not available
      setIsAuthenticated(false);
    }
  }, []);

  const handleLoginSuccess = (user) => {
    setIsAuthenticated(true);
    setCurrentUser(user);
  };

  const handleSignupSuccess = (email, code) => {
    setVerificationEmail(email);
    setAuthView('verify');
    console.log('Verification code for', email, ':', code);
  };

  const handleVerificationSuccess = () => {
    setAuthView('login');
  };

  const handleResetSuccess = () => {
    setAuthView('login');
  };

  const handleLogout = async () => {
    await window.electronAPI.auth.logout();
    setIsAuthenticated(false);
    setCurrentUser(null);
    setAuthView('login');
  };

  // Render authentication views if not authenticated
  if (!isAuthenticated) {
    if (authView === 'signup') {
      return (
        <Signup
          onSwitchToLogin={() => setAuthView('login')}
          onSignupSuccess={handleSignupSuccess}
        />
      );
    }

    if (authView === 'verify') {
      return (
        <EmailVerification
          email={verificationEmail}
          onVerificationSuccess={handleVerificationSuccess}
          onBack={() => setAuthView('signup')}
        />
      );
    }

    if (authView === 'reset') {
      return (
        <PasswordReset
          onBack={() => setAuthView('login')}
          onResetSuccess={handleResetSuccess}
        />
      );
    }

    return (
      <Login
        onSwitchToSignup={() => setAuthView('signup')}
        onSwitchToReset={() => setAuthView('reset')}
        onLoginSuccess={handleLoginSuccess}
        onSwitchToVerify={(email) => {
          setVerificationEmail(email);
          setAuthView('verify');
        }}
      />
    );
  }

  // Main authenticated dashboard
  return (
    <div className="min-h-screen bg-ocean-deep text-white">
      {/* Header */}
      <header className="bg-ocean-container border-b border-ocean-primary/30 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-ocean-primary rounded-lg flex items-center justify-center">
              <span className="text-xl font-bold">FM</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">FortiMorph</h1>
              <p className="text-sm text-ocean-surface">Adaptive Resource Management</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-sm">
              <p className="text-gray-400">Logged in as</p>
              <p className="text-ocean-surface">{currentUser?.email}</p>
            </div>
            <button onClick={handleLogout} className="btn-secondary text-sm">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content - Dashboard */}
      <Dashboard user={currentUser} onLogout={handleLogout} />
    </div>
  );
}

export default App;
