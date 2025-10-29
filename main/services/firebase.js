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
      // LOCAL MODE: Use database-only authentication when Firebase is not configured
      if (!this.initialized) {
        console.log('Using local authentication (Firebase not configured)');
        
        // Check if user already exists
        const existingUser = db.getUserByEmail(email);
        if (existingUser) {
          // If user exists but is not verified, allow them to resend verification code
          if (!existingUser.verified) {
            // Generate new verification code
            const verificationCode = this.generateVerificationCode(6);
            const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes
            
            // Store verification code
            db.setVerificationCode(email, verificationCode, expiresAt);
            
            // Try to send verification email
            try {
              await emailService.sendVerificationCode(email, verificationCode);
              console.log(`New verification code for ${email}: ${verificationCode}`);
            } catch (emailError) {
              console.warn('Email service not configured. Verification code:', verificationCode);
              console.log('\n========================================');
              console.log('LOCAL DEV MODE - VERIFICATION CODE');
              console.log(`Email: ${email}`);
              console.log(`Code: ${verificationCode}`);
              console.log('========================================\n');
            }
            
            return {
              success: true,
              uid: `local_${existingUser.id}`,
              email: email,
              message: 'Account exists but not verified. New verification code sent.',
              localMode: true,
              verificationCode: verificationCode // Include in dev mode
            };
          }
          
          // User exists and is verified
          return {
            success: false,
            error: 'An account with this email already exists and is verified. Please login instead.',
          };
        }

        // Hash password using bcrypt
        const bcrypt = require('bcrypt');
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user in local database
        db.createUser(email, passwordHash);
        
        // Generate verification code
        const verificationCode = this.generateVerificationCode(6);
        const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes
        const uid = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store verification code
        db.setVerificationCode(email, verificationCode, expiresAt);
        
        // Try to send verification email (will fail gracefully if not configured)
        try {
          await emailService.sendVerificationCode(email, verificationCode);
          console.log(`Verification code for ${email}: ${verificationCode}`);
        } catch (emailError) {
          console.warn('Email service not configured. Verification code:', verificationCode);
          console.log('\n========================================');
          console.log('LOCAL DEV MODE - VERIFICATION CODE');
          console.log(`Email: ${email}`);
          console.log(`Code: ${verificationCode}`);
          console.log('========================================\n');
        }

        return {
          success: true,
          uid: uid,
          email: email,
          message: 'Account created! Check console for verification code (local mode).',
          localMode: true,
          verificationCode: verificationCode // Include in dev mode
        };
      }

      // FIREBASE MODE: Use Firebase authentication when configured
      
      // Clean up orphaned local data for this email first (in case user was deleted from Firebase)
      const orphanedCachedUser = db.getFirebaseUserByEmail(email);
      if (orphanedCachedUser) {
        console.log(`🧹 Cleaning up orphaned cached user data for ${email} (UID: ${orphanedCachedUser.uid})`);
        db.deleteUserData(orphanedCachedUser.uid, { deleteLogs: true });
      }
      
      // Also clean up any orphaned verification codes for this email
      const orphanedVerification = db.getVerificationCode(email);
      if (orphanedVerification && orphanedVerification.uid) {
        console.log(`🧹 Cleaning up orphaned verification code for ${email}`);
        db.deleteUserData(orphanedVerification.uid, { deleteLogs: true });
      }
      
      const userCredential = await createUserWithEmailAndPassword(
        this.auth,
        email,
        password
      );

      console.log(`\n🔥 Firebase user created: ${userCredential.user.email}`);
      console.log(`🆔 UID: ${userCredential.user.uid}`);

      // Sync Firebase user to local database cache
      db.syncFirebaseUserToLocal(userCredential.user);

      // Generate verification code
      const verificationCode = this.generateVerificationCode(6);
      const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

      console.log(`🔑 Storing verification code for UID: ${userCredential.user.uid}`);
      console.log(`📧 Code: ${verificationCode}`);
      console.log(`⏰ Generated at: ${Math.floor(Date.now() / 1000)} (${new Date().toLocaleString()})`);
      console.log(`⏰ Expires at: ${expiresAt} (${new Date(expiresAt * 1000).toLocaleString()})`);
      console.log(`⏰ Valid for: 10 minutes (600 seconds)`);

      // Store verification code in database using UID and email
      // For Firebase users, we store directly in verification_codes table
      db.setVerificationCodeForFirebase(userCredential.user.uid, email, verificationCode, expiresAt);

      // Send verification email with code
      try {
        await emailService.sendVerificationCode(email, verificationCode);
        console.log(`Verification code sent to ${email}: ${verificationCode}`);
      } catch (emailError) {
        console.warn('Email service error:', emailError.message);
        console.log('\n============================================================');
        console.log(`📧 VERIFICATION CODE FOR: ${email}`);
        console.log(`🔢 CODE: ${verificationCode}`);
        console.log(`🆔 UID: ${userCredential.user.uid}`);
        console.log('============================================================\n');
      }

      // Log signup event with user ID
      db.addLog('auth', `User signup: ${email}`, { uid: userCredential.user.uid }, 'info', userCredential.user.uid);

      return {
        success: true,
        uid: userCredential.user.uid,
        email: userCredential.user.email,
        message: 'Account created! Check your email (or console in dev mode) for the verification code.',
        verificationCode: process.env.NODE_ENV === 'development' ? verificationCode : undefined
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
  async verifyEmail(identifier, code) {
    try {
      console.log(`\n🔍 Verifying email for identifier: ${identifier}, code: ${code}`);
      
      // identifier can be either email or uid
      // For signup flow, we need to check by email since we might not have the UID yet
      let storedData = db.getVerificationCode(identifier);

      // If not found and identifier looks like email, try to find by UID from cached user
      if (!storedData && identifier.includes('@')) {
        const cachedUser = db.getFirebaseUserByEmail(identifier);
        if (cachedUser) {
          console.log(`📧 Found cached user by email, trying UID: ${cachedUser.uid}`);
          storedData = db.getVerificationCode(cachedUser.uid);
        }
      }

      console.log('📋 Stored verification data:', storedData);

      if (!storedData) {
        console.log('❌ No verification code found in database');
        return { success: false, error: 'No verification code found. Please request a new one.' };
      }

      const now = Math.floor(Date.now() / 1000);
      console.log(`⏰ Current time: ${now} (${new Date(now * 1000).toLocaleString()})`);
      console.log(`⏰ Expires at: ${storedData.expires_at} (${new Date(storedData.expires_at * 1000).toLocaleString()})`);
      console.log(`⏰ Time remaining: ${storedData.expires_at - now} seconds`);

      // Check if code expired
      if (storedData.expires_at < now) {
        console.log('❌ Verification code expired');
        return { success: false, error: 'Verification code expired. Please request a new one.' };
      }

      // Check if code matches (handle both string and number)
      const storedCode = String(storedData.code).trim();
      const enteredCode = String(code).trim();
      console.log(`🔢 Comparing codes - Stored: "${storedCode}" vs Entered: "${enteredCode}"`);
      
      if (storedCode !== enteredCode) {
        console.log('❌ Code mismatch!');
        return { success: false, error: 'Invalid verification code. Please try again.' };
      }

      // Mark as verified in database (use UID if available, otherwise email)
      const verifyIdentifier = storedData.uid || identifier;
      console.log('✅ Code matches! Marking as verified with identifier:', verifyIdentifier);
      db.markEmailAsVerified(verifyIdentifier);

      return {
        success: true,
        message: 'Email verified successfully! You can now log in.',
      };
    } catch (error) {
      console.error('❌ Email verification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sign in user with email and password
   */
  async login(email, password) {
    try {
      const bcrypt = require('bcrypt');
      
      // Try FIREBASE MODE first if initialized
      if (this.initialized) {
        try {
          console.log('Attempting Firebase authentication for:', email);
          const userCredential = await signInWithEmailAndPassword(
            this.auth,
            email,
            password
          );

          // Sync/update Firebase user to local cache
          db.syncFirebaseUserToLocal(userCredential.user);
          db.updateFirebaseUserLastLogin(userCredential.user.uid);

          // Check if email is verified in our database
          let isVerified = db.isEmailVerified(userCredential.user.uid);
          
          // Also check by email as fallback
          if (!isVerified) {
            console.log('⚠️ Not verified by UID, checking by email...');
            isVerified = db.isEmailVerified(email);
          }
          
          console.log(`📧 Email verification status for ${email}: ${isVerified}`);

          if (!isVerified) {
            // Sign out if not verified
            await signOut(this.auth);
            db.addLog('auth', `Login failed - email not verified: ${email}`, 
              { uid: userCredential.user.uid }, 'warning', userCredential.user.uid);
            return {
              success: false,
              error: 'Please verify your email before logging in',
              emailVerified: false,
            };
          }

          // Log successful login with user ID
          db.addLog('auth', `User login successful: ${email}`, 
            { uid: userCredential.user.uid }, 'info', userCredential.user.uid);

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
        } catch (firebaseError) {
          // If Firebase auth fails, try local database as fallback
          console.log('Firebase authentication failed, trying local database:', firebaseError.code);
          
          // Only fallback to local if user not found in Firebase
          if (firebaseError.code === 'auth/user-not-found' || 
              firebaseError.code === 'auth/invalid-credential' ||
              firebaseError.code === 'auth/wrong-password') {
            console.log('Falling back to local authentication');
            // Continue to local auth below
          } else {
            // For other errors, return the Firebase error
            let errorMessage = 'Login failed';
            switch (firebaseError.code) {
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
                errorMessage = firebaseError.message;
            }
            return { success: false, error: errorMessage };
          }
        }
      }

      // LOCAL MODE: Use database-only authentication
      console.log('Using local authentication for:', email);
      
      // Get user from database
      const user = db.getUserByEmail(email);
      
      if (!user) {
        db.addLog('auth', `Login failed - user not found: ${email}`, null, 'warning');
        return {
          success: false,
          error: 'Invalid email or password',
        };
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordMatch) {
        db.addLog('auth', `Login failed - incorrect password: ${email}`, 
          { userId: `local_${user.id}` }, 'warning', `local_${user.id}`);
        return {
          success: false,
          error: 'Invalid email or password',
        };
      }

      // Check if email is verified
      if (!user.verified) {
        db.addLog('auth', `Login failed - email not verified: ${email}`, 
          { userId: `local_${user.id}` }, 'warning', `local_${user.id}`);
        return {
          success: false,
          error: 'Please verify your email before logging in',
          emailVerified: false,
        };
      }

      // Update last login
      db.updateLastLogin(email);

      const localUserId = `local_${user.id}`;
      
      // Log successful login with user ID
      db.addLog('auth', `User login successful (local): ${email}`, 
        { userId: localUserId }, 'info', localUserId);

      return {
        success: true,
        user: {
          uid: localUserId,
          email: user.email,
          emailVerified: true,
          displayName: user.email.split('@')[0],
        },
        message: 'Login successful',
        localMode: true,
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message || 'Login failed' };
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
      // Get user by email from database
      const user = db.getUserByEmail(email);
      if (!user) {
        return { success: false, error: 'Account not found' };
      }

      // Check if already verified
      if (user.verified) {
        return { success: false, error: 'Email is already verified' };
      }

      // Generate new verification code
      const verificationCode = this.generateVerificationCode(6);
      const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

      // Use email as identifier for both modes (we'll handle both tables in setVerificationCode)
      db.setVerificationCode(email, verificationCode, expiresAt);

      // Send email (will work in both local and Firebase mode)
      try {
        await emailService.sendVerificationCode(email, verificationCode);
        console.log(`Verification code sent to ${email}: ${verificationCode}`);
      } catch (emailError) {
        console.warn('Email service not configured. Verification code:', verificationCode);
        console.log('\n========================================');
        console.log('LOCAL DEV MODE - VERIFICATION CODE');
        console.log(`Email: ${email}`);
        console.log(`Code: ${verificationCode}`);
        console.log('========================================\n');
      }

      return {
        success: true,
        message: 'Verification code sent successfully. Check console for code in dev mode.',
        verificationCode: process.env.NODE_ENV === 'development' ? verificationCode : undefined
      };
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
   * Delete user account (both Firebase and local data)
   * @param {String} uid - User UID
   * @param {Object} options - Deletion options
   * @param {Boolean} options.deleteLogs - Delete user's logs (default: true)
   * @param {Boolean} options.anonymizeLogs - Anonymize logs instead (default: false)
   */
  async deleteUserAccount(uid, options = {}) {
    try {
      console.log(`🗑️ Initiating user deletion for UID: ${uid}`);
      
      // Delete from local database first
      const localResult = db.deleteUserData(uid, options);
      console.log('Local data deletion result:', localResult);
      
      // Delete from Firebase if initialized and not a local user
      if (this.initialized && !uid.startsWith('local_')) {
        try {
          // Note: This requires Firebase Admin SDK for deleting users
          // Standard Firebase Auth doesn't allow deleting other users
          // For now, we'll just delete local data
          console.warn('⚠️ Firebase user deletion requires Admin SDK');
          console.warn('To delete Firebase user, go to Firebase Console > Authentication > Users');
          
          return {
            success: true,
            localDataDeleted: true,
            firebaseUserDeleted: false,
            message: 'Local user data deleted. Please delete Firebase user manually from Firebase Console.',
            ...localResult
          };
        } catch (firebaseError) {
          console.error('Firebase deletion error:', firebaseError);
          return {
            success: true,
            localDataDeleted: true,
            firebaseUserDeleted: false,
            message: 'Local data deleted, but Firebase deletion failed. Delete user manually from Firebase Console.',
            error: firebaseError.message
          };
        }
      }
      
      // Local user - fully deleted
      return {
        success: true,
        localDataDeleted: true,
        firebaseUserDeleted: false,
        message: 'Local user data deleted successfully',
        ...localResult
      };
      
    } catch (error) {
      console.error('User deletion error:', error);
      return { success: false, error: error.message };
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
