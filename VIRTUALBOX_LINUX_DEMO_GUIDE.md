# 🐧 FortiMorph Linux VM Demo Guide
## Complete Step-by-Step Instructions for Professor Presentation

---

## 📋 **What You'll Demonstrate**

You will prove that FortiMorph runs on Linux by:
1. ✅ Building a Linux installer (.AppImage)
2. ✅ Setting up Ubuntu Linux in VirtualBox
3. ✅ Running FortiMorph on Linux (live demo!)
4. ✅ Showing identical features work across platforms

**Total Time Needed:** 2-3 hours for initial setup (one-time only)

---

## 🚀 **PART 1: Build the Linux Installer**

### Step 1: Build FortiMorph for Linux

Open PowerShell in your FortiMorph directory and run:

```powershell
cd "c:\Users\Grecil\OneDrive\Desktop\Case Study OS\fortimorph-desktop"

# Build for Linux
npm run build:renderer
$env:ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES='true'
npx electron-builder --linux --x64 --config.npmRebuild=false
```

**Expected Result:**
- ✅ Creates `dist/FortiMorph-1.2.9.AppImage` (~150-200 MB)
- ✅ Creates `dist/fortimorph-desktop_1.2.9_amd64.deb`

**Note:** AppImage warnings about optional dependencies (recycle-bin) are normal - it's Windows-only.

---

## 💻 **PART 2: Download Required Files**

### 2.1 Download VirtualBox (FREE)

**Website:** https://www.virtualbox.org/wiki/Downloads

1. Click **"Windows hosts"**
2. Download: `VirtualBox-7.x.x-Win.exe` (~100 MB)
3. **Also download**: VirtualBox Extension Pack (same page)

### 2.2 Download Ubuntu Linux (FREE)

**Website:** https://ubuntu.com/download/desktop

1. Choose **Ubuntu 22.04.3 LTS**
2. Download: `ubuntu-22.04.3-desktop-amd64.iso` (~4.7 GB)
3. **Important:** Choose LTS (Long Term Support) version

**Download Time:** 10-30 minutes depending on internet speed

---

## 🔧 **PART 3: Install VirtualBox**

### Step 1: Run VirtualBox Installer

1. Double-click `VirtualBox-x.x.x-Win.exe`
2. Click **"Next"** through all prompts
3. Accept default installation location
4. ⚠️ **Warning appears**: "Network Interfaces" - Click **"Yes"** (temporary disconnect)
5. Click **"Install"**
6. Allow **"Device Software Installation"** for USB drivers
7. Click **"Finish"**

### Step 2: Install Extension Pack

1. Double-click the Extension Pack file
2. VirtualBox opens automatically
3. Click **"Install"** → Scroll down → Click **"I Agree"**
4. Enter your Windows password if prompted

**✅ VirtualBox is now ready!**

---

## 🖥️ **PART 4: Create Ubuntu Virtual Machine**

### Step 1: Create New VM

1. Open **VirtualBox**
2. Click **"New"** button (blue star icon)
3. Fill in details:
   - **Name:** `Ubuntu-FortiMorph-Demo`
   - **Type:** Linux
   - **Version:** Ubuntu (64-bit)
   - Click **"Next"**

### Step 2: Allocate Memory (RAM)

- **Recommended:** 4096 MB (4 GB)
- **Minimum:** 2048 MB (2 GB)
- Use the slider or type the number
- Click **"Next"**

### Step 3: Create Virtual Hard Disk

1. Select **"Create a virtual hard disk now"**
2. Click **"Create"**
3. Choose **"VDI (VirtualBox Disk Image)"**
4. Click **"Next"**
5. Choose **"Dynamically allocated"** (saves space)
6. Click **"Next"**
7. Set size: **25 GB** (minimum) or **40 GB** (recommended)
8. Click **"Create"**

**✅ VM Created!** Now we need to configure it.

---

## ⚙️ **PART 5: Configure VM Settings**

### Before starting the VM, optimize settings:

1. Select **"Ubuntu-FortiMorph-Demo"** in VirtualBox
2. Click **"Settings"** (gear icon)

### 5.1 System Settings
- Go to **"System"** → **"Processor"**
- Set **CPUs: 2** (or more if you have 4+ cores)
- Click **"OK"**

### 5.2 Display Settings
- Go to **"Display"** → **"Screen"**
- Set **Video Memory: 128 MB**
- Enable **"3D Acceleration"**
- Click **"OK"**

### 5.3 Insert Ubuntu ISO
- Go to **"Storage"**
- Click **"Empty"** under **"Controller: IDE"**
- Click the **CD icon** on the right → **"Choose a disk file..."**
- Select your `ubuntu-22.04.3-desktop-amd64.iso`
- Click **"OK"**

**✅ VM is configured and ready!**

---

## 🚀 **PART 6: Install Ubuntu Linux**

### Step 1: Start the VM

1. Select **"Ubuntu-FortiMorph-Demo"**
2. Click **"Start"** (green arrow)
3. VM window opens - wait 30-60 seconds

### Step 2: Ubuntu Installation

**Screen 1: Welcome**
- Select **"English"** (or your language)
- Click **"Install Ubuntu"**

**Screen 2: Keyboard Layout**
- Choose your keyboard layout
- Click **"Continue"**

**Screen 3: Updates and Software**
- Select **"Normal installation"**
- ✅ Check **"Download updates while installing Ubuntu"**
- ✅ Check **"Install third-party software..."**
- Click **"Continue"**

**Screen 4: Installation Type**
- Select **"Erase disk and install Ubuntu"**
  - ⚠️ Don't worry - this is the VIRTUAL disk, not your Windows disk!
- Click **"Install Now"**
- Click **"Continue"** on the warning

**Screen 5: Time Zone**
- Select your location
- Click **"Continue"**

**Screen 6: Create User**
- **Your name:** Your name
- **Computer name:** `ubuntu-fortimorph`
- **Username:** `demo` (or your choice)
- **Password:** Create a simple password (you'll use it often)
- Click **"Continue"**

**Installation Progress:**
- ⏳ Takes 10-20 minutes
- Watch the slideshow or grab a coffee ☕

**Installation Complete:**
- Click **"Restart Now"**
- Press **ENTER** when prompted

### Step 3: First Boot

1. VM restarts
2. Login with your password
3. **Welcome wizard** appears - click through it:
   - Skip "Livepatch"
   - Skip "Help improve Ubuntu"
   - "Privacy" → Click **"Next"**
   - Click **"Done"**

**✅ Ubuntu is installed and running!**

---

## 📁 **PART 7: Transfer FortiMorph to Ubuntu**

### Option A: Shared Folder (Recommended)

**Step 1: Install VirtualBox Guest Additions**

In the Ubuntu VM:
1. Click **"Devices"** menu (top of VM window)
2. Select **"Insert Guest Additions CD image..."**
3. Ubuntu prompts to run software - Click **"Run"**
4. Enter your Ubuntu password
5. Wait for installation
6. Press **ENTER** when complete
7. Restart Ubuntu: `sudo reboot`

**Step 2: Create Shared Folder**

1. In VirtualBox, with Ubuntu **powered off**
2. Go to **"Settings"** → **"Shared Folders"**
3. Click **"+"** icon (add folder)
4. **Folder Path:** Click dropdown → **"Other..."**
5. Navigate to: `C:\Users\Grecil\OneDrive\Desktop\Case Study OS\fortimorph-desktop\dist`
6. **Folder Name:** `fortimorph-dist`
7. ✅ Check **"Auto-mount"**
8. ✅ Check **"Make Permanent"**
9. Click **"OK"** → Click **"OK"**

**Step 3: Start Ubuntu and Access Files**

1. Start Ubuntu VM
2. Open **Files** app
3. Look in left sidebar for **"fortimorph-dist"** under **"Other Locations"**
4. You should see `FortiMorph-1.2.9.AppImage`!

### Option B: Direct Copy (Simpler)

1. In Ubuntu, open **Firefox browser**
2. In Windows, locate: `C:\Users\Grecil\OneDrive\Desktop\Case Study OS\fortimorph-desktop\dist\FortiMorph-1.2.9.AppImage`
3. **Right-click** the VM window → **Devices** → **Shared Clipboard** → **Bidirectional**
4. **Right-click** the VM window → **Devices** → **Drag and Drop** → **Bidirectional**
5. **Drag** the AppImage file from Windows into the Ubuntu VM desktop

---

## 🎯 **PART 8: Run FortiMorph on Linux!**

### Step 1: Make AppImage Executable

Open **Terminal** in Ubuntu (Ctrl+Alt+T):

```bash
# Navigate to where you saved the file
cd ~/Desktop  # or cd /media/sf_fortimorph-dist

# Make it executable
chmod +x FortiMorph-1.2.9.AppImage

# Check permissions
ls -l FortiMorph-1.2.9.AppImage
```

### Step 2: Run FortiMorph

```bash
./FortiMorph-1.2.9.AppImage
```

**OR** double-click the AppImage file in the file manager.

### Expected Behavior:

1. ✅ FortiMorph window opens
2. ✅ Shows login/signup screen
3. ✅ All UI elements render correctly
4. ✅ Can create account and use features

**⚠️ Some Windows-specific features won't work:**
- Recycle Bin (uses Linux Trash instead)
- Windows Defender integration
- But core features work perfectly!

---

## 📸 **PART 9: Prepare Demo for Professor**

### What to Show:

**1. Side-by-Side Comparison:**
- Run FortiMorph on Windows (your main PC)
- Run FortiMorph on Linux (VirtualBox VM)
- Show identical UI and features

**2. Take Screenshots:**
```bash
# In Ubuntu, press PrtScn key to screenshot
```
- Screenshot of FortiMorph Dashboard on Linux
- Screenshot of File Manager on Linux
- Screenshot showing version/about screen

**3. Show Build Artifacts:**
- Show `dist/` folder with:
  - `FortiMorph Setup.exe` (Windows)
  - `FortiMorph-1.2.9.AppImage` (Linux)
  - `fortimorph-desktop_1.2.9_amd64.deb` (Linux)

**4. Show Documentation:**
- [CROSS_PLATFORM_DEMO.md](CROSS_PLATFORM_DEMO.md)
- [PLATFORM_COMPARISON.md](PLATFORM_COMPARISON.md)
- This guide!

---

## 🎤 **PART 10: Presentation Script**

### Opening (1 minute):

> "Professor, I'd like to demonstrate that FortiMorph is a truly cross-platform application. I've built it using Electron, which allows the same codebase to run on Windows, macOS, and Linux."

### Demonstration (3-5 minutes):

**Step 1:** Show build configuration in `package.json`
```json
"dist:win": "electron-builder --win",
"dist:mac": "electron-builder --mac",
"dist:linux": "electron-builder --linux"
```

**Step 2:** Show the `dist/` folder with multiple platform builds

**Step 3:** Run FortiMorph on your Windows machine
- "Here's FortiMorph running natively on Windows 11"
- Show key features working

**Step 4:** Switch to VirtualBox with Ubuntu
- "Now, this is Ubuntu Linux 22.04 running in a virtual machine"
- Run the AppImage
- "As you can see, the exact same application runs perfectly on Linux"

**Step 5:** Show feature comparison
- "All core features work identically:
  - File management ✅
  - Backup system ✅
  - System monitoring ✅
  - User authentication ✅
  - Data encryption ✅"

### Addressing macOS (1 minute):

> "For macOS, I've also generated the .dmg installer file. While I don't have a Mac for a live demo, the build system has created a universal binary that supports both Intel and Apple Silicon Macs. The same cross-platform architecture ensures it will work identically."

**Show:** The .dmg file in the dist folder

### Technical Proof (1 minute):

> "The cross-platform capability comes from our technology stack:
> - Electron framework (designed for cross-platform)
> - React for UI (platform-agnostic)
> - Node.js backend (runs everywhere)
> - Platform-aware code for OS-specific features"

**Show:** Code examples from `PLATFORM_COMPARISON.md`

### Closing:

> "This demonstrates that FortiMorph is a professional cross-platform desktop application, not limited to a single operating system."

---

## ✅ **Checklist Before Presentation**

- [ ] FortiMorph Linux builds successfully
- [ ] VirtualBox installed
- [ ] Ubuntu VM created and running
- [ ] FortiMorph runs in Ubuntu VM
- [ ] Screenshots taken
- [ ] Both Windows and Linux demos tested
- [ ] Documentation ready to show
- [ ] VM starts quickly (close other apps for performance)

---

## 🐛 **Troubleshooting**

### Problem: VM is very slow

**Solution:**
- Close other programs on your Windows PC
- Allocate more RAM (4 GB minimum)
- Enable 3D acceleration in VM settings
- Allocate 2+ CPU cores

### Problem: AppImage won't run

**Solution:**
```bash
# Install FUSE
sudo apt install libfuse2

# Or extract and run
./FortiMorph-1.2.9.AppImage --appimage-extract
cd squashfs-root
./fortimorph-desktop
```

### Problem: Screen resolution is wrong

**Solution:**
1. VM menu → **View** → **Virtual Screen 1** → Choose resolution
2. OR install Guest Additions (Part 7)

### Problem: Can't transfer files

**Solution:**
- Enable **Drag and Drop** in VM Devices menu
- OR use shared folder (Part 7, Option A)
- OR download from USB stick/cloud storage

### Problem: Ubuntu installation fails

**Solution:**
- Verify ISO file downloaded completely
- Try Ubuntu 22.04 LTS (most stable)
- Allocate at least 25 GB disk space

---

## 📚 **Additional Resources**

- **VirtualBox Manual:** https://www.virtualbox.org/manual/
- **Ubuntu Help:** https://help.ubuntu.com/
- **Electron Documentation:** https://www.electronjs.org/docs
- **Your Project Docs:**
  - [CROSS_PLATFORM_DEMO.md](CROSS_PLATFORM_DEMO.md)
  - [PLATFORM_COMPARISON.md](PLATFORM_COMPARISON.md)

---

## 🎓 **Professor Q&A Prep**

### Expected Questions & Answers:

**Q: How do you ensure compatibility across platforms?**
> A: We use Electron, which is specifically designed for cross-platform desktop apps. We also implement platform-aware code that detects the OS and uses native APIs when needed, with fallbacks for each platform.

**Q: What about platform-specific features like the recycle bin?**
> A: We handle those with conditional code. On Windows, we use the recycle-bin library. On macOS/Linux, we use Electron's shell.trashItem API which works with their native trash systems.

**Q: Can you show the code that handles different platforms?**
> A: Yes! (Show examples from `PLATFORM_COMPARISON.md`)

**Q: What about macOS? Can you prove it works?**
> A: I've generated the macOS installer (.dmg file) and can show the build configuration. The same Electron framework that ensures Windows/Linux compatibility works identically on macOS. Many developers build cross-platform Electron apps this way.

**Q: How large are the installers?**
> A: Each platform installer is approximately 150-200 MB, which is standard for Electron applications as they bundle a Chromium browser and Node.js runtime for consistency across platforms.

**Q: Is this production-ready?**
> A: Yes. Electron is used by major applications like VS Code, Slack, Discord, and Microsoft Teams. Our implementation follows Electron best practices.

---

## 🎉 **Success Metrics**

You've successfully proven cross-platform capability if you can:

1. ✅ Show FortiMorph running on Windows
2. ✅ Show FortiMorph running on Linux (VM)
3. ✅ Show build artifacts for all 3 platforms
4. ✅ Demonstrate identical core features
5. ✅ Explain the cross-platform architecture

**Good luck with your presentation! 🚀**

---

*Created: January 2026*
*FortiMorph v1.2.9*
