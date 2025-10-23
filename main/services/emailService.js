const nodemailer = require('nodemailer');
require('dotenv').config();

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
  }

  /**
   * Initialize email transporter
   */
  initialize() {
    try {
      const smtpConfig = {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      };

      // Check if credentials are configured
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn('Email credentials not configured. Verification codes will be shown in console.');
        this.initialized = false;
        return false;
      }

      this.transporter = nodemailer.createTransport(smtpConfig);

      // Verify connection
      this.transporter.verify((error, _success) => {
        if (error) {
          console.error('Email service verification failed:', error);
          this.initialized = false;
        } else {
          console.log('Email service initialized and ready to send verification codes');
          this.initialized = true;
        }
      });

      return true;
    } catch (error) {
      console.error('Email service initialization error:', error);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Send verification code email
   */
  async sendVerificationCode(email, code) {
    // Always log to console for development
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📧 VERIFICATION CODE FOR: ${email}`);
    console.log(`🔢 CODE: ${code}`);
    console.log(`${'='.repeat(60)}\n`);

    if (!this.initialized) {
      return {
        success: true,
        message: 'Verification code displayed in console',
      };
    }

    try {
      const mailOptions = {
        from: `"FortiMorph" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Your FortiMorph Verification Code',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #0077B6 0%, #003566 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .header h1 { color: white; margin: 0; font-size: 28px; }
              .header p { color: #48CAE4; margin: 5px 0 0 0; }
              .content { background: #f8f9fa; padding: 40px 30px; }
              .code-box { background: white; border: 3px solid #0077B6; border-radius: 10px; padding: 30px; text-align: center; margin: 30px 0; }
              .code { font-size: 48px; font-weight: bold; color: #0077B6; letter-spacing: 8px; font-family: 'Courier New', monospace; }
              .footer { background: #001D3D; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
              .footer p { color: #48CAE4; font-size: 12px; margin: 0; }
              .warning { background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; padding: 15px; margin: 20px 0; }
              .warning p { color: #856404; margin: 0; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>FortiMorph</h1>
                <p>Adaptive Resource Management</p>
              </div>
              <div class="content">
                <h2 style="color: #001D3D; margin-top: 0;">Email Verification</h2>
                <p style="color: #003566; font-size: 16px;">
                  Thank you for signing up! Please use the verification code below to complete your registration:
                </p>
                <div class="code-box">
                  <div class="code">${code}</div>
                </div>
                <div class="warning">
                  <p><strong>⏰ Important:</strong> This code will expire in 10 minutes.</p>
                </div>
                <p style="color: #6c757d; font-size: 14px;">
                  If you didn't request this code, please ignore this email. Your account will not be created without verification.
                </p>
              </div>
              <div class="footer">
                <p>© 2025 FortiMorph. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      };

      await this.transporter.sendMail(mailOptions);

      return {
        success: true,
        message: 'Verification code sent successfully',
      };
    } catch (error) {
      console.error('Send verification email error:', error);
      return {
        success: true, // Don't block signup if email fails
        message: 'Verification code displayed in console',
      };
    }
  }

  /**
   * Send password reset code email
   */
  async sendPasswordResetCode(email, code) {
    // Always log to console for development
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔐 PASSWORD RESET CODE FOR: ${email}`);
    console.log(`🔢 CODE: ${code}`);
    console.log(`${'='.repeat(60)}\n`);

    if (!this.initialized) {
      return {
        success: true,
        message: 'Reset code displayed in console',
      };
    }

    try {
      const mailOptions = {
        from: `"FortiMorph" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Your FortiMorph Password Reset Code',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #0077B6 0%, #003566 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .header h1 { color: white; margin: 0; font-size: 28px; }
              .header p { color: #48CAE4; margin: 5px 0 0 0; }
              .content { background: #f8f9fa; padding: 40px 30px; }
              .code-box { background: white; border: 3px solid #FFC300; border-radius: 10px; padding: 30px; text-align: center; margin: 30px 0; }
              .code { font-size: 48px; font-weight: bold; color: #FFC300; letter-spacing: 8px; font-family: 'Courier New', monospace; }
              .footer { background: #001D3D; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
              .footer p { color: #48CAE4; font-size: 12px; margin: 0; }
              .warning { background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; padding: 15px; margin: 20px 0; }
              .warning p { color: #856404; margin: 0; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>FortiMorph</h1>
                <p>Adaptive Resource Management</p>
              </div>
              <div class="content">
                <h2 style="color: #001D3D; margin-top: 0;">Password Reset Request</h2>
                <p style="color: #003566; font-size: 16px;">
                  We received a request to reset your password. Use the code below to proceed:
                </p>
                <div class="code-box">
                  <div class="code">${code}</div>
                </div>
                <div class="warning">
                  <p><strong>⏰ Important:</strong> This code will expire in 15 minutes.</p>
                </div>
                <p style="color: #6c757d; font-size: 14px;">
                  If you didn't request a password reset, please ignore this email and ensure your account is secure.
                </p>
              </div>
              <div class="footer">
                <p>© 2025 FortiMorph. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      };

      await this.transporter.sendMail(mailOptions);

      return {
        success: true,
        message: 'Password reset code sent successfully',
      };
    } catch (error) {
      console.error('Send reset email error:', error);
      return {
        success: true,
        message: 'Reset code displayed in console',
      };
    }
  }
}

// Export singleton instance
module.exports = new EmailService();
