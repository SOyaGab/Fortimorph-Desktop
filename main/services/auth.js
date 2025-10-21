const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./database');

const SALT_ROUNDS = 10;
const MAX_LOGIN_ATTEMPTS = 3;
const LOCKOUT_DURATION = 5 * 60; // 5 minutes in seconds
const VERIFICATION_CODE_EXPIRY = 10 * 60; // 10 minutes
const RESET_CODE_EXPIRY = 15 * 60; // 15 minutes

class AuthService {
  /**
   * Generate a random verification code (4-6 digits)
   */
  generateCode(length = 6) {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(Math.random() * (max - min + 1) + min).toString();
  }

  /**
   * Hash password using bcrypt
   */
  async hashPassword(password) {
    return await bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Compare password with hash
   */
  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  /**
   * Sign up new user
   */
  async signup(email, password) {
    try {
      // Check if user already exists
      const existingUser = db.getUserByEmail(email);
      if (existingUser) {
        return { success: false, error: 'User already exists' };
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return { success: false, error: 'Invalid email format' };
      }

      // Validate password strength
      if (password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' };
      }

      // Hash password
      const passwordHash = await this.hashPassword(password);

      // Create user
      db.createUser(email, passwordHash);

      // Generate verification code
      const code = this.generateCode(6);
      const expiresAt = Math.floor(Date.now() / 1000) + VERIFICATION_CODE_EXPIRY;
      db.setVerificationCode(email, code, expiresAt);

      // Log the action
      db.addLog('auth', 'User registered', { email });

      return {
        success: true,
        message: 'User created successfully. Please verify your email.',
        verificationCode: code, // In production, this would be sent via email
      };
    } catch (error) {
      console.error('Signup error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify email with code
   */
  verifyEmail(email, code) {
    try {
      const user = db.getUserByEmail(email);

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      if (user.verified) {
        return { success: false, error: 'Email already verified' };
      }

      const now = Math.floor(Date.now() / 1000);

      if (user.verification_expires < now) {
        return { success: false, error: 'Verification code expired' };
      }

      if (user.verification_code !== code) {
        return { success: false, error: 'Invalid verification code' };
      }

      // Mark as verified
      db.updateUserVerification(email, 1);
      db.addLog('auth', 'Email verified', { email });

      return { success: true, message: 'Email verified successfully' };
    } catch (error) {
      console.error('Verification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Resend verification code
   */
  resendVerificationCode(email) {
    try {
      const user = db.getUserByEmail(email);

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      if (user.verified) {
        return { success: false, error: 'Email already verified' };
      }

      const code = this.generateCode(6);
      const expiresAt = Math.floor(Date.now() / 1000) + VERIFICATION_CODE_EXPIRY;
      db.setVerificationCode(email, code, expiresAt);

      db.addLog('auth', 'Verification code resent', { email });

      return {
        success: true,
        message: 'Verification code sent',
        verificationCode: code,
      };
    } catch (error) {
      console.error('Resend verification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Login user
   */
  async login(email, password) {
    try {
      const user = db.getUserByEmail(email);

      if (!user) {
        return { success: false, error: 'Invalid email or password' };
      }

      // Check if account is locked
      const now = Math.floor(Date.now() / 1000);
      if (user.locked_until > now) {
        const remainingTime = Math.ceil((user.locked_until - now) / 60);
        return {
          success: false,
          error: `Account locked. Try again in ${remainingTime} minute(s)`,
          locked: true,
        };
      }

      // Check if email is verified
      if (!user.verified) {
        return { success: false, error: 'Please verify your email first' };
      }

      // Verify password
      const isPasswordValid = await this.verifyPassword(password, user.password_hash);

      if (!isPasswordValid) {
        // Increment login attempts
        db.incrementLoginAttempts(email);

        const attempts = user.login_attempts + 1;

        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          // Lock account
          const lockUntil = now + LOCKOUT_DURATION;
          db.lockAccount(email, lockUntil);
          db.addLog('auth', 'Account locked due to failed attempts', { email });

          return {
            success: false,
            error: `Too many failed attempts. Account locked for ${LOCKOUT_DURATION / 60} minutes`,
            locked: true,
          };
        }

        return {
          success: false,
          error: `Invalid email or password. ${MAX_LOGIN_ATTEMPTS - attempts} attempt(s) remaining`,
        };
      }

      // Successful login
      db.updateLastLogin(email);
      db.resetLoginAttempts(email);
      db.addLog('auth', 'User logged in', { email });

      // Generate session token
      const sessionToken = crypto.randomBytes(32).toString('hex');

      return {
        success: true,
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          verified: user.verified,
          lastLogin: user.last_login,
        },
        sessionToken,
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Request password reset
   */
  requestPasswordReset(email) {
    try {
      const user = db.getUserByEmail(email);

      if (!user) {
        // Don't reveal if email exists for security
        return {
          success: true,
          message: 'If the email exists, a reset code has been sent',
        };
      }

      const code = this.generateCode(6);
      const expiresAt = Math.floor(Date.now() / 1000) + RESET_CODE_EXPIRY;
      db.setResetCode(email, code, expiresAt);

      db.addLog('auth', 'Password reset requested', { email });

      return {
        success: true,
        message: 'Reset code sent',
        resetCode: code, // In production, this would be sent via email
      };
    } catch (error) {
      console.error('Password reset request error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reset password with code
   */
  async resetPassword(email, code, newPassword) {
    try {
      const user = db.getUserByEmail(email);

      if (!user) {
        return { success: false, error: 'Invalid reset code' };
      }

      const now = Math.floor(Date.now() / 1000);

      if (!user.reset_code || user.reset_expires < now) {
        return { success: false, error: 'Reset code expired or invalid' };
      }

      if (user.reset_code !== code) {
        return { success: false, error: 'Invalid reset code' };
      }

      // Validate new password
      if (newPassword.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' };
      }

      // Hash new password
      const passwordHash = await this.hashPassword(newPassword);

      // Update password
      db.updatePassword(email, passwordHash);
      db.resetLoginAttempts(email);
      db.addLog('auth', 'Password reset successfully', { email });

      return { success: true, message: 'Password reset successfully' };
    } catch (error) {
      console.error('Password reset error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user by email
   */
  getUserByEmail(email) {
    try {
      const user = db.getUserByEmail(email);
      if (!user) {
        return null;
      }

      // Remove sensitive data
      // eslint-disable-next-line no-unused-vars
      const { password_hash, verification_code, reset_code, ...safeUser } = user;
      return safeUser;
    } catch (error) {
      console.error('Get user error:', error);
      return null;
    }
  }
}

module.exports = new AuthService();
