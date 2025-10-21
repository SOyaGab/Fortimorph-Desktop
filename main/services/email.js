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
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      };

      // Check if credentials are configured
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn('Email credentials not configured. Email features will be disabled.');
        console.warn('Please set SMTP_USER and SMTP_PASS in your .env file');
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
          console.log('Email service initialized and ready');
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
    if (!this.initialized) {
      console.log('Email not configured. Verification code:', code);
      return {
        success: true,
        message: 'Email service not configured. Check console for code.',
      };
    }

    try {
      const mailOptions = {
        from: `"FortiMorph" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Verify Your Email - FortiMorph',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0077B6 0%, #003566 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">FortiMorph</h1>
              <p style="color: #48CAE4; margin: 5px 0;">Adaptive Resource Management</p>
            </div>
            <div style="background: #f8f9fa; padding: 30px;">
              <h2 style="color: #001D3D;">Email Verification</h2>
              <p style="color: #003566; font-size: 16px;">
                Thank you for signing up! Please use the verification code below to complete your registration:
              </p>
              <div style="background: white; border: 2px solid #0077B6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="color: #0077B6; font-size: 36px; letter-spacing: 5px; margin: 0;">${code}</h1>
              </div>
              <p style="color: #6c757d; font-size: 14px;">
                This code will expire in 10 minutes. If you didn't request this code, please ignore this email.
              </p>
            </div>
            <div style="background: #001D3D; padding: 20px; text-align: center;">
              <p style="color: #48CAE4; font-size: 12px; margin: 0;">
                © 2025 FortiMorph. All rights reserved.
              </p>
            </div>
          </div>
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
        success: false,
        error: 'Failed to send verification email',
      };
    }
  }

  /**
   * Send password reset code email
   */
  async sendPasswordResetCode(email, code) {
    if (!this.initialized) {
      console.log('Email not configured. Reset code:', code);
      return {
        success: true,
        message: 'Email service not configured. Check console for code.',
      };
    }

    try {
      const mailOptions = {
        from: `"FortiMorph" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Password Reset Request - FortiMorph',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0077B6 0%, #003566 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">FortiMorph</h1>
              <p style="color: #48CAE4; margin: 5px 0;">Adaptive Resource Management</p>
            </div>
            <div style="background: #f8f9fa; padding: 30px;">
              <h2 style="color: #001D3D;">Password Reset Request</h2>
              <p style="color: #003566; font-size: 16px;">
                We received a request to reset your password. Use the code below to proceed:
              </p>
              <div style="background: white; border: 2px solid #FFC300; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="color: #FFC300; font-size: 36px; letter-spacing: 5px; margin: 0;">${code}</h1>
              </div>
              <p style="color: #6c757d; font-size: 14px;">
                This code will expire in 15 minutes. If you didn't request a password reset, please ignore this email and ensure your account is secure.
              </p>
            </div>
            <div style="background: #001D3D; padding: 20px; text-align: center;">
              <p style="color: #48CAE4; font-size: 12px; margin: 0;">
                © 2025 FortiMorph. All rights reserved.
              </p>
            </div>
          </div>
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
        success: false,
        error: 'Failed to send reset email',
      };
    }
  }

  /**
   * Send welcome email after verification
   */
  async sendWelcomeEmail(email) {
    if (!this.initialized) {
      return { success: true, message: 'Email service not configured' };
    }

    try {
      const mailOptions = {
        from: `"FortiMorph" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Welcome to FortiMorph!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0077B6 0%, #003566 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0;">Welcome to FortiMorph!</h1>
              <p style="color: #48CAE4; margin: 5px 0;">Your account is now active</p>
            </div>
            <div style="background: #f8f9fa; padding: 30px;">
              <h2 style="color: #001D3D;">Get Started</h2>
              <p style="color: #003566; font-size: 16px;">
                Thank you for verifying your email! You now have full access to FortiMorph's features:
              </p>
              <ul style="color: #003566; font-size: 16px;">
                <li>System Resource Monitoring</li>
                <li>Battery Health Management</li>
                <li>Automated Optimization</li>
                <li>Secure Backup & Recovery</li>
                <li>AI-Powered Assistant</li>
              </ul>
              <p style="color: #003566; font-size: 16px;">
                Start optimizing your system today!
              </p>
            </div>
            <div style="background: #001D3D; padding: 20px; text-align: center;">
              <p style="color: #48CAE4; font-size: 12px; margin: 0;">
                © 2025 FortiMorph. All rights reserved.
              </p>
            </div>
          </div>
        `,
      };

      await this.transporter.sendMail(mailOptions);

      return { success: true, message: 'Welcome email sent' };
    } catch (error) {
      console.error('Send welcome email error:', error);
      return { success: false, error: 'Failed to send welcome email' };
    }
  }
}

module.exports = new EmailService();
