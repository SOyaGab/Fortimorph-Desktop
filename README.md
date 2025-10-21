# FortiMorph Desktop

**Version:** 1.2.0  
**Platform:** Electron + React + Node.js  
**UI System:** Ocean Vibe Design System

## Overview

FortiMorph is a Windows desktop application that intelligently manages system resources, battery performance, and data integrity through real-time monitoring, process optimization, and secure file handling.

## Features

- 🖥️ **System Monitoring** - Real-time CPU, RAM, disk, and process tracking
- 🔋 **Battery Center** - Smart battery health monitoring with custom alerts
- 🔄 **Optimization Engine** - Automated system cleanup and process management
- 💾 **Backup & Recovery** - Encrypted incremental backups with restoration
- 🗑️ **Quarantine Delete** - Safe file deletion with recovery options
- 🤖 **AI Assistant** (Optional) - Natural language command execution
- 🔐 **Local Authentication** - Secure single-user system with email verification

## Tech Stack

- **Runtime:** Electron v28
- **Frontend:** React 18 + TailwindCSS
- **Database:** SQLite (better-sqlite3)
- **Security:** bcrypt, crypto-js, context isolation, CSP headers
- **Build Tools:** Vite, electron-builder

## Getting Started

### Prerequisites

- Node.js 18+ 
- Windows OS
- npm or yarn

### Installation

```powershell
# Navigate to project directory
cd fortimorph-desktop

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Build

```powershell
# Build for Windows
npm run build:win
```

## Project Structure

```
fortimorph-desktop/
├── main/              # Electron main process
│   ├── index.js      # Main entry point with security configs
│   └── preload.js    # Secure context bridge
├── app/               # React renderer process
│   ├── components/   # React components
│   ├── styles/       # CSS and Tailwind styles
│   ├── App.jsx       # Main app component
│   └── main.jsx      # React entry point
├── assets/            # Icons and static resources
├── build/             # Build resources (icons, installers)
├── Docs/              # Documentation
│   ├── PRD.md
│   ├── Implementation Plan.md
│   └── Rules and Regulations.md
└── package.json       # Dependencies and scripts
```

## Development Modules

- ✅ **Module A** - Project Initialization & Environment Setup
- ⏳ **Module B** - Local Authentication & User Management
- ⏳ **Module C** - System Monitoring & Optimization
- ⏳ **Module D** - Battery Center
- ⏳ **Module E** - Backup & Recovery System
- ⏳ **Module F** - AI Assistant Integration

## Ocean Vibe Design System

| Color | Hex | Usage |
|-------|-----|-------|
| Primary (Depth) | #0077B6 | Buttons, accents, active states |
| Surface | #48CAE4 | Highlights, focus states |
| Deep | #001D3D | Main background |
| Container | #003566 | Panel backgrounds |
| Success | #4CAF50 | Completed actions |
| Warning | #FFC300 | Alerts |

## Security Features

- Context isolation enabled
- Content Security Policy (CSP) headers
- No remote module access
- Secure IPC communication via contextBridge
- Password hashing with bcrypt
- Local-only data storage

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run build:win` - Build Windows installer
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## License

MIT

## Authors

FortiMorph Team

---

**Status:** Module A Complete ✅
