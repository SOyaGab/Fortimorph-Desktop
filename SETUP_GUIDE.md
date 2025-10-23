# FortiMorph Desktop - Setup Guide for Classmates

Welcome! This guide will help you set up and run FortiMorph Desktop on your computer.

## 📋 Prerequisites

Before starting, make sure you have these installed:

1. **Node.js** (v16 or higher)
   - Download from: https://nodejs.org/
   - Choose the LTS (Long Term Support) version
   - Verify installation: Open PowerShell and run `node --version`

2. **Git** (for cloning the repository)
   - Download from: https://git-scm.com/
   - Verify installation: Run `git --version`

3. **Code Editor** (Recommended: VS Code)
   - Download from: https://code.visualstudio.com/

## 🚀 Installation Steps

### Step 1: Clone the Repository

```powershell
# Open PowerShell and navigate to where you want the project
cd Desktop

# Clone the repository (replace with actual repo URL)
git clone <REPOSITORY_URL>

# Navigate into the project folder
cd fortimorph-desktop
```

### Step 2: Install Dependencies

```powershell
# Install all required packages
npm install
```

This will take a few minutes as it downloads all dependencies.

### Step 3: Set Up Firebase (Required for Authentication)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or use existing one
3. Enable **Email/Password Authentication**:
   - Go to Authentication → Sign-in method
   - Enable Email/Password
4. Get your Firebase configuration:
   - Go to Project Settings → General
   - Scroll to "Your apps" → Web app
   - Copy the configuration

5. Create a `.env` file in the project root:

```env
# Firebase Configuration
FIREBASE_API_KEY=your_api_key_here
FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id

# Email Service (Optional - for email verification)
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password

# Session Configuration
SESSION_TIMEOUT=1800000
NODE_ENV=development
```

**Note**: To use Gmail for sending verification codes:
1. Enable 2-Factor Authentication on your Google Account
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Use the App Password (not your regular password) in `.env`

### Step 4: Run the Application

```powershell
# Start the development server
npm run dev
```

The application will:
1. Start the Vite dev server (React frontend)
2. Wait for it to be ready
3. Launch the Electron app automatically

## 🎯 First Time Use

### Creating an Account

1. The app will open with a login screen
2. Click **"Sign up"** to create a new account
3. Enter your email and password (minimum 6 characters)
4. Click **"Sign Up"**
5. Check your email for the 6-digit verification code
6. Enter the code and click **"Verify Email"**
7. Now you can log in!

### Troubleshooting: Can't Verify Email?

If you're stuck on verification:

1. On the login page, scroll down and click **"🔧 Account Issues? Click here"**
2. A modal will show your account status
3. Click **"✓ Verify This Account"** button
4. Close the modal and try logging in

## 📱 Features Overview

### Module A: System Monitoring
- Real-time CPU, Memory, and Disk usage
- Process management (view and end processes)
- System optimization suggestions

### Module B: Battery Management
- Battery health monitoring
- Charging status and estimates
- Power usage analytics

### Module C: File Management
- Scan for large files by size
- View top folders consuming storage
- Delete files/folders directly
- Filter by file size (Large/Medium/Small/All)

### Module D: Installed Apps
- View all installed applications
- Sort by size
- See installation dates and publishers

## 🛠️ Development Scripts

```powershell
# Run development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Build for Windows only
npm run build:win

# Run linter
npm lint

# Format code
npm run format
```

## 📂 Project Structure

```
fortimorph-desktop/
├── app/                    # React frontend
│   ├── components/         # React components
│   ├── styles/            # CSS files
│   ├── App.jsx            # Main app component
│   └── main.jsx           # Entry point
├── main/                   # Electron main process
│   ├── services/          # Backend services
│   │   ├── firebase.js    # Firebase authentication
│   │   ├── database.js    # Local SQLite database
│   │   ├── monitoring.js  # System monitoring
│   │   └── emailService.js # Email verification
│   ├── index.js           # Electron main process
│   └── preload.js         # Bridge between main and renderer
├── .env                    # Environment variables (create this)
├── package.json           # Dependencies and scripts
└── README.md              # Project documentation
```

## 🔒 Security Notes

- Never commit your `.env` file to Git
- Never share your Firebase credentials publicly
- Use App Passwords for Gmail (not your main password)
- The app stores data locally in: `%APPDATA%\fortimorph-desktop\`

## ❓ Common Issues & Solutions

### Issue: "Port 5173 is already in use"
**Solution**: Kill the process using that port or let Vite use another port automatically.

```powershell
# Find and kill the process
netstat -ano | findstr :5173
taskkill /PID <PID_NUMBER> /F
```

### Issue: "Firebase not initialized"
**Solution**: Make sure your `.env` file has all Firebase credentials correctly set.

### Issue: "Failed to load resource: ERR_CACHE_READ_FAILURE"
**Solution**: Clear the Electron cache:

```powershell
Remove-Item -Path "$env:APPDATA\fortimorph-desktop\*" -Recurse -Force
```

### Issue: npm install fails
**Solution**: 
1. Delete `node_modules` folder and `package-lock.json`
2. Run `npm install` again
3. If still fails, try `npm install --legacy-peer-deps`

### Issue: "Module not found" errors
**Solution**: Make sure you're in the correct directory and ran `npm install`

## 📞 Getting Help

If you encounter issues:

1. Check the console output for error messages
2. Open DevTools in the app (F12 or Ctrl+Shift+I)
3. Check the terminal/PowerShell for backend errors
4. Review this guide again
5. Contact the developer

## 🎓 For Developers

### Making Changes

1. Frontend (React): Edit files in `app/` folder
2. Backend (Electron): Edit files in `main/` folder
3. Styles: Edit `app/styles/index.css` (uses Tailwind CSS)

### Hot Reload

- Frontend changes reload automatically
- Backend changes require restart (Ctrl+C then `npm run dev` again)

### Adding Features

1. Create new components in `app/components/`
2. Add new services in `main/services/`
3. Expose backend functions via IPC in `main/index.js`
4. Connect them in `main/preload.js`

## 📦 Building for Distribution

```powershell
# Build production version
npm run build:win

# Output will be in the 'dist' folder
# The .exe file can be shared with others
```

## ✅ Quick Start Checklist

- [ ] Node.js installed
- [ ] Git installed
- [ ] Repository cloned
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file created with Firebase credentials
- [ ] Firebase Email/Password authentication enabled
- [ ] App runs successfully (`npm run dev`)
- [ ] Account created and verified
- [ ] Can log in successfully

## 🌟 Tips

1. **Keep your .env file safe** - It contains sensitive credentials
2. **Regular commits** - Commit your changes frequently
3. **Test before sharing** - Always test the app after making changes
4. **Check console** - Console logs help debug issues
5. **Use DevTools** - F12 opens DevTools for debugging

## 📝 License

This project is for educational purposes.

---

**Happy Coding! 🚀**

If you have questions, contact the project maintainer.
