const { initializeApp } = require('firebase/app');
const {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} = require('firebase/auth');
const db = require('./database');
const emailService = require('./emailService');
require('dotenv').config();

class FirebaseService {
  constructor() {
    this.app = null;
    this.auth = null;
    this.initialized = false;
  }

  /**
   * Generate a random verification code
   */
  generateVerificationCode(length = 6) {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(Math.random() * (max - min + 1) + min).toString();
  }

  /**
   * Initialize Firebase
   */
  initialize() {
    try {
      // Check if Firebase config is available
      if (!process.env.FIREBASE_API_KEY) {
        console.warn('Firebase not configured. Please set Firebase environment variables.');
        console.warn('See FIREBASE_SETUP.md for instructions.');
        this.initialized = false;
        return false;
      }

      const firebaseConfig = {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
      };

      // Initialize Firebase
      this.app = initializeApp(firebaseConfig);
      this.auth = getAuth(this.app);

      console.log('Firebase Authentication initialized successfully');
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Firebase initialization error:', error);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Sign up new user with email and password
   */
  async signup(email, password) {
    try {
      if (!this.initialized) {
        return {
          success: false,
          error: 'Firebase not initialized. Please configure Firebase credentials.',
        };
      }

      // Create user in Firebase (but don't verify yet)
      const userCredential = await createUserWithEmailAndPassword(
        this.auth,
        email,
        password
      );

      // Generate verification code
      const verificationCode = this.generateVerificationCode(6);
      const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

      // Store verification code in database
      db.setVerificationCode(userCredential.user.uid, verificationCode, expiresAt);

      // Send verification email with code
      await emailService.sendVerificationCode(email, verificationCode);

      return {
        success: true,
        uid: userCredential.user.uid,
        email: userCredential.user.email,
        message: 'Account created! Please check your email for the verification code.',
      };
    } catch (error) {
      console.error('Firebase signup error:', error);
      
      let errorMessage = 'An error occurred during signup';
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorMessage = 'This email is already registered';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/weak-password':
          errorMessage = 'Password is too weak. Use at least 6 characters';
          break;
        case 'auth/operation-not-allowed':
          errorMessage = 'Email/password authentication is not enabled';
          break;
        default:
          errorMessage = error.message;
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Verify email with code
   */
  async verifyEmail(uid, code) {
    try {
      // Get stored verification code from database
      const storedData = db.getVerificationCode(uid);

      if (!storedData) {
        return { success: false, error: 'No verification code found. Please request a new one.' };
      }

      const now = Math.floor(Date.now() / 1000);

      // Check if code expired
      if (storedData.expires_at < now) {
        return { success: false, error: 'Verification code expired. Please request a new one.' };
      }

      // Check if code matches
      if (storedData.code !== code) {
        return { success: false, error: 'Invalid verification code. Please try again.' };
      }

      // Mark as verified in database
      db.markEmailAsVerified(uid);

      return {
        success: true,
        message: 'Email verified successfully! You can now log in.',
      };
    } catch (error) {
      console.error('Email verification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sign in user with email and password
   */
  async login(email, password) {
    try {
      if (!this.initialized) {
        return {
          success: false,
          error: 'Firebase not initialized. Please configure Firebase credentials.',
        };
      }

      const userCredential = await signInWithEmailAndPassword(
        this.auth,
        email,
        password
      );

      // Check if email is verified in our database
      const isVerified = db.isEmailVerified(userCredential.user.uid);

      if (!isVerified) {
        // Sign out if not verified
        await signOut(this.auth);
        return {
          success: false,
          error: 'Please verify your email before logging in',
          emailVerified: false,
        };
      }

      return {
        success: true,
        user: {
          uid: userCredential.user.uid,
          email: userCredential.user.email,
          emailVerified: true,
          displayName: userCredential.user.displayName,
        },
        message: 'Login successful',
      };
    } catch (error) {
      console.error('Firebase login error:', error);

      let errorMessage = 'Login failed';
      switch (error.code) {
        case 'auth/user-not-found':
        case 'auth/wrong-password':
          errorMessage = 'Invalid email or password';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/user-disabled':
          errorMessage = 'This account has been disabled';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Too many failed attempts. Please try again later';
          break;
        default:
          errorMessage = error.message;
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Sign out current user
   */
  async logout() {
    try {
      if (!this.initialized) {
        return { success: true };
      }

      await signOut(this.auth);
      return { success: true, message: 'Logged out successfully' };
    } catch (error) {
      console.error('Firebase logout error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Resend verification email by email address
   */
  async resendVerificationByEmail(email) {
    try {
      if (!this.initialized) {
        return {
          success: false,
          error: 'Firebase not initialized',
        };
      }

      // Get user by email from database
      const user = db.getUserByEmail(email);
      if (!user) {
        return { success: false, error: 'Account not found' };
      }

      return await this.resendVerificationCode(user.uid, email);
    } catch (error) {
      console.error('Resend verification by email error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationCode(uid, email) {
    try {
      if (!this.initialized) {
        return {
          success: false,
          error: 'Firebase not initialized',
        };
      }

      // Check if already verified
      const isVerified = db.isEmailVerified(uid);
      if (isVerified) {
        return { success: false, error: 'Email is already verified' };
      }

      // Generate new verification code
      const verificationCode = this.generateVerificationCode(6);
      const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

      // Store new verification code
      db.setVerificationCode(uid, verificationCode, expiresAt);

      // Send email
      await emailService.sendVerificationCode(email, verificationCode);

      return {
        success: true,
        message: 'Verification code sent successfully',
      };
    } catch (error) {
      console.error('Resend verification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send password reset email
   */
  async requestPasswordReset(email) {
    try {
      if (!this.initialized) {
        return {
          success: false,
          error: 'Firebase not initialized',
        };
      }

      await sendPasswordResetEmail(this.auth, email);
      return {
        success: true,
        message: 'Password reset email sent. Please check your inbox.',
      };
    } catch (error) {
      console.error('Password reset request error:', error);

      let errorMessage = 'Failed to send password reset email';
      switch (error.code) {
        case 'auth/user-not-found':
          errorMessage = 'No account found with this email';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        default:
          errorMessage = error.message;
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Check if current user's email is verified
   */
  async checkEmailVerified() {
    try {
      if (!this.initialized) {
        return {
          success: false,
          error: 'Firebase not initialized',
        };
      }

      const user = this.auth.currentUser;
      if (!user) {
        return { success: false, error: 'No user is currently signed in' };
      }

      // Check in our database
      const isVerified = db.isEmailVerified(user.uid);

      return {
        success: true,
        verified: isVerified,
        message: isVerified ? 'Email verified successfully' : 'Email not yet verified',
      };
    } catch (error) {
      console.error('Check email verification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current user
   */
  getCurrentUser() {
    if (!this.initialized) {
      return null;
    }

    const user = this.auth.currentUser;
    if (!user) {
      return null;
    }

    return {
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      photoURL: user.photoURL,
    };
  }

  /**
   * Check authentication state
   */
  onAuthStateChanged(callback) {
    if (!this.initialized) {
      return () => {};
    }

    return onAuthStateChanged(this.auth, (user) => {
      if (user) {
        callback({
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          displayName: user.displayName,
        });
      } else {
        callback(null);
      }
    });
  }
}

// Export singleton instance
module.exports = new FirebaseService();
