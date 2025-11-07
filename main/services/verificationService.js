/**
 * FortiMorph Verification Service
 * 
 * Provides secure, time-limited token generation and verification
 * for backup validation and diagnostic authenticity confirmation.
 * 
 * Features:
 * - HMAC-SHA256 based signing
 * - Time-to-live (TTL) enforcement
 * - One-time use token support
 * - QR code generation
 * - Device/app-specific binding
 */

const crypto = require('crypto');
const QRCode = require('qrcode');
const os = require('os');
// FIX: database.js exports a singleton instance directly, not a getDatabase function
const db = require('./database');

class VerificationService {
  constructor() {
    this.appSecret = null;
    this.systemId = null;
    this.initialized = false;
  }

  /**
   * Initialize the verification service
   * Generates or retrieves app secret and system ID
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // FIX: Use getSetting instead of raw SQL
      // Get or create app secret (persistent key for HMAC)
      const secretValue = db.getSetting('verification_secret');

      if (secretValue) {
        this.appSecret = secretValue;
      } else {
        // Generate new secret
        this.appSecret = crypto.randomBytes(32).toString('hex');
        db.setSetting('verification_secret', this.appSecret);
      }

      // Generate system ID (based on hostname + platform + architecture)
      const systemInfo = {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        version: os.release()
      };
      this.systemId = crypto
        .createHash('sha256')
        .update(JSON.stringify(systemInfo))
        .digest('hex')
        .substring(0, 16);

      this.initialized = true;
      console.log('[VerificationService] Initialized successfully');
    } catch (error) {
      console.error('[VerificationService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Generate a verification token
   * @param {Object} options - Token generation options
   * @param {string} options.type - Token type (backup, diagnostic, file)
   * @param {string} options.resourceId - ID of the resource being verified
   * @param {string} options.resourceName - Name of the resource
   * @param {number|null} options.ttl - Time-to-live in seconds (null for permanent)
   * @param {boolean} options.oneTimeUse - Whether token is single-use
   * @param {Object} options.metadata - Additional metadata to include
   * @param {string} options.filePath - Optional file path for browsed files
   * @param {string} options.fileHash - Optional file hash for browsed files
   * @returns {Promise<Object>} Token data with signature and QR code
   */
  async generateToken(options) {
    await this.initialize();

    const {
      type = 'generic',
      resourceId,
      resourceName,
      ttl = 3600, // 1 hour default, null for permanent
      oneTimeUse = false,
      metadata = {},
      filePath = null,
      fileHash = null
    } = options;

    // Validate inputs
    if (!resourceId) {
      throw new Error('resourceId is required for token generation');
    }

  // Use integer milliseconds for timestamps and ensure numeric types
  const now = Math.floor(Date.now());
  // Support permanent tokens (ttl = null)
  const expiresAt = ttl === null ? null : Math.floor(now + (ttl * 1000));
    const tokenId = crypto.randomBytes(16).toString('hex');

    // Create token payload
    const payload = {
      id: tokenId,
      type,
      resourceId,
      resourceName: resourceName || resourceId,
      systemId: this.systemId,
      issuedAt: now,
      expiresAt,
      oneTimeUse,
      metadata
    };

    // Generate HMAC signature
    const dataToSign = JSON.stringify({
      id: payload.id,
      type: payload.type,
      resourceId: payload.resourceId,
      systemId: payload.systemId,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      oneTimeUse: payload.oneTimeUse
    });

    const signature = crypto
      .createHmac('sha256', this.appSecret)
      .update(dataToSign)
      .digest('hex');

    payload.signature = signature;

    // FIX: Store token in database using new method
    console.log(`[VerificationService] Storing token with TTL: ${ttl}, expiresAt: ${expiresAt}`);
    console.log(`[VerificationService] Token details:`, {
      tokenId,
      type,
      resourceId,
      resourceName: resourceName || resourceId,
      systemId: this.systemId,
      issuedAt: now,
      expiresAt,
      ttl,
      oneTimeUse,
      isPermanent: ttl === null
    });
    
    const success = db.addVerificationToken(
      tokenId,
      type,
      resourceId,
      resourceName || resourceId,
      this.systemId,
      now,
      expiresAt, // Can be NULL for permanent tokens
      ttl, // Store original TTL value (can be null)
      oneTimeUse,
      metadata,
      signature,
      filePath, // Store file path if browsed
      fileHash  // Store file hash if browsed
    );

    console.log(`[VerificationService] Database insert result: ${success}`);

    if (!success) {
      console.error('[VerificationService] Database returned false - token storage failed');
      throw new Error('Failed to store verification token in database');
    }

    // Generate compact token string for QR code
    const tokenString = this.encodeToken(payload);

    // Generate QR code
    const qrCodeDataUrl = await this.generateQRCode(tokenString);

    console.log(`[VerificationService] Generated token: ${tokenId} (${type})${expiresAt ? '' : ' [PERMANENT]'}`);

    return {
      tokenId,
      tokenString,
      qrCode: qrCodeDataUrl,
      payload: {
        ...payload,
        // Don't expose signature in response
        signature: undefined
      },
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      ttl
    };
  }

  /**
   * Verify a token
   * @param {string} tokenString - Token string to verify
   * @param {boolean} markAsUsed - Whether to mark token as used
   * @returns {Promise<Object>} Verification result
   */
  async verifyToken(tokenString, markAsUsed = true) {
    await this.initialize();

    try {
      // Decode token
      const payload = this.decodeToken(tokenString);

      // FIX: Retrieve token from database using new method
      const tokenRecord = db.getVerificationToken(payload.id);

      if (!tokenRecord) {
        return {
          valid: false,
          error: 'TOKEN_NOT_FOUND',
          message: 'Token does not exist'
        };
      }

      // Check if token was already used (for one-time use tokens)
      if (tokenRecord.one_time_use && tokenRecord.used) {
        return {
          valid: false,
          error: 'TOKEN_ALREADY_USED',
          message: 'This token has already been used'
        };
      }

      // Check expiration (skip for permanent tokens where expires_at is NULL)
      const now = Date.now();
      if (tokenRecord.expires_at !== null && now > tokenRecord.expires_at) {
        return {
          valid: false,
          error: 'TOKEN_EXPIRED',
          message: 'Token has expired',
          expiredAt: new Date(tokenRecord.expires_at).toISOString()
        };
      }

      // Verify system ID matches
      if (payload.systemId !== this.systemId) {
        return {
          valid: false,
          error: 'SYSTEM_MISMATCH',
          message: 'Token was generated on a different system'
        };
      }

      // Verify signature
      const dataToSign = JSON.stringify({
        id: payload.id,
        type: payload.type,
        resourceId: payload.resourceId,
        systemId: payload.systemId,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        oneTimeUse: payload.oneTimeUse
      });

      const expectedSignature = crypto
        .createHmac('sha256', this.appSecret)
        .update(dataToSign)
        .digest('hex');

      if (expectedSignature !== payload.signature) {
        return {
          valid: false,
          error: 'INVALID_SIGNATURE',
          message: 'Token signature is invalid (possible forgery attempt)'
        };
      }

      // FIX: Mark as used if requested using new method
      if (markAsUsed && tokenRecord.one_time_use) {
        db.markTokenAsUsed(payload.id);
      }

      console.log(`[VerificationService] Token verified: ${payload.id}`);

      // Build verification result
      const result = {
        valid: true,
        token: {
          id: payload.id,
          type: payload.type,
          resourceId: payload.resourceId,
          resourceName: payload.resourceName,
          issuedAt: new Date(payload.issuedAt).toISOString(),
          expiresAt: payload.expiresAt ? new Date(payload.expiresAt).toISOString() : null,
          isPermanent: payload.expiresAt === null,
          metadata: JSON.parse(tokenRecord.metadata || '{}')
        },
        resourceVerification: {
          exists: true,
          verified: true
        }
      };

      // If token has file path and hash, verify file integrity
      if (tokenRecord.file_path && tokenRecord.file_hash) {
        try {
          const fs = require('fs');
          const fileExists = fs.existsSync(tokenRecord.file_path);
          
          if (!fileExists) {
            result.resourceVerification.exists = false;
            result.resourceVerification.verified = false;
            result.resourceVerification.message = 'File no longer exists at original location';
          } else {
            // Calculate current hash and compare
            const currentHash = await this.calculateFileHashInternal(tokenRecord.file_path);
            const hashMatch = currentHash === tokenRecord.file_hash;
            
            result.resourceVerification.hashMatch = hashMatch;
            result.resourceVerification.verified = hashMatch;
            if (!hashMatch) {
              result.resourceVerification.message = 'File has been modified (hash mismatch)';
            }
          }
        } catch (error) {
          result.resourceVerification.error = error.message;
        }
      }

      return result;
    } catch (error) {
      console.error('[VerificationService] Verification error:', error);
      return {
        valid: false,
        error: 'VERIFICATION_ERROR',
        message: error.message
      };
    }
  }

  /**
   * Encode token payload to compact string
   * @param {Object} payload - Token payload
   * @returns {string} Encoded token string
   */
  encodeToken(payload) {
    const compactPayload = {
      i: payload.id,
      t: payload.type,
      r: payload.resourceId,
      s: payload.systemId,
      ia: payload.issuedAt,
      ea: payload.expiresAt,
      o: payload.oneTimeUse,
      sg: payload.signature
    };

    return Buffer.from(JSON.stringify(compactPayload)).toString('base64');
  }

  /**
   * Decode token string to payload
   * @param {string} tokenString - Encoded token string
   * @returns {Object} Decoded payload
   */
  decodeToken(tokenString) {
    try {
      const json = Buffer.from(tokenString, 'base64').toString('utf-8');
      const compact = JSON.parse(json);

      return {
        id: compact.i,
        type: compact.t,
        resourceId: compact.r,
        systemId: compact.s,
        issuedAt: compact.ia,
        expiresAt: compact.ea,
        oneTimeUse: compact.o,
        signature: compact.sg
      };
    } catch (error) {
      throw new Error('Invalid token format');
    }
  }

  /**
   * Generate QR code from token string
   * @param {string} tokenString - Token string to encode
   * @returns {Promise<string>} QR code as data URL
   */
  async generateQRCode(tokenString) {
    try {
      // Generate QR code with high error correction
      const qrCodeDataUrl = await QRCode.toDataURL(tokenString, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        quality: 1,
        margin: 2,
        width: 300,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      return qrCodeDataUrl;
    } catch (error) {
      console.error('[VerificationService] QR generation error:', error);
      throw error;
    }
  }

  /**
   * Get token information by ID
   * @param {string} tokenId - Token ID
   * @returns {Promise<Object|null>} Token information
   */
  async getTokenInfo(tokenId) {
    // Get token by ID from database
    const token = db.getVerificationToken(tokenId);

    if (!token) return null;

    return {
      tokenId: token.token_id,
      type: token.type,
      resourceId: token.resource_id,
      resourceName: token.resource_name,
  issuedAt: token.issued_at ? new Date(token.issued_at).toISOString() : null,
  expiresAt: token.expires_at ? new Date(token.expires_at).toISOString() : null,
      oneTimeUse: token.one_time_use === 1,
      used: token.used === 1,
      usedAt: token.used_at ? new Date(token.used_at).toISOString() : null,
      metadata: JSON.parse(token.metadata || '{}')
    };
  }

  /**
   * List all tokens with optional filtering
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} List of tokens
   */
  async listTokens(filters = {}) {
    // FIX: db is now imported directly at top
    
    let query = 'SELECT * FROM verification_tokens WHERE 1=1';
    const params = [];

    if (filters.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    if (filters.resourceId) {
      query += ' AND resource_id = ?';
      params.push(filters.resourceId);
    }

    if (filters.activeOnly) {
      query += ' AND expires_at > ? AND (one_time_use = 0 OR used = 0)';
      params.push(Date.now());
    }

    query += ' ORDER BY issued_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const tokens = db.getAllVerificationTokens(query, params);

    return tokens.map(token => {
      const issuedAt = token.issued_at ? Number(token.issued_at) : null;
      const expiresAt = token.expires_at ? Number(token.expires_at) : null;
      const now = Date.now();

      return {
        tokenId: token.token_id,
        type: token.type,
        resourceId: token.resource_id,
        resourceName: token.resource_name,
        issuedAt: issuedAt ? new Date(issuedAt).toISOString() : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        oneTimeUse: token.one_time_use === 1,
        used: token.used === 1,
        usedAt: token.used_at ? new Date(token.used_at).toISOString() : null,
        isExpired: expiresAt ? expiresAt < now : false,
        isValid: expiresAt ? (expiresAt > now && (!token.one_time_use || !token.used)) : true // permanent tokens are valid unless deleted
      };
    });
  }

  /**
   * Delete a token
   * @param {string} tokenId - Token ID to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteToken(tokenId) {
    // Use the dedicated database helper to delete a token
    const result = db.deleteVerificationToken(tokenId);
    return result === true;
  }

  /**
   * Clean up expired and used tokens
   * @returns {Promise<number>} Number of tokens deleted
   */
  async cleanupExpiredTokens() {
    // FIX: db is now imported directly at top
    const now = Date.now();
    // Delegate to database implementation. The DB helper returns boolean success.
    const deleted = db.deleteExpiredTokens();
    // Return 1 if something was deleted, 0 otherwise (caller expects a number)
    return deleted ? 1 : 0;
  }

  /**
   * Calculate SHA-256 hash of a file (internal method)
   * @param {string} filePath - Path to file
   * @returns {Promise<string>} SHA-256 hash
   */
  async calculateFileHashInternal(filePath) {
    return new Promise((resolve, reject) => {
      const fs = require('fs');
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (error) => reject(error));
    });
  }
}

// Export singleton instance
const verificationService = new VerificationService();

module.exports = {
  verificationService,
  VerificationService
};

