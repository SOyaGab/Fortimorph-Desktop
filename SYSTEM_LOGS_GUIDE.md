# 📊 FortiMorph System Logs Guide

## Overview
The System Logs feature allows you to view, filter, search, and export application logs in various formats. This guide explains how to use each function and the available export formats.

---

## 🔍 How to Access System Logs

1. **Login to FortiMorph Desktop**
2. **Navigate to Dashboard**
3. **Click on "Logs" tab** (or System Logs section)

---

## 📋 Log Viewer Features

### 1. **View Logs**
- Logs are displayed in a paginated table with the following columns:
  - **ID** - Unique log identifier
  - **Date & Time** - When the event occurred
  - **Type** - Category of the log (auth, system, database, email, logs)
  - **Level** - Severity level (info, warning, error, success)
  - **Message** - Description of the event
  - **Metadata** - Additional details (if available)

### 2. **Filter Logs**

#### **By Level** (Severity)
- **All** - Show all log levels
- **Info** - Informational messages (blue)
- **Warning** - Warning messages (yellow)
- **Error** - Error messages (red)
- **Success** - Success messages (green)

#### **By Type** (Category)
Select from dropdown:
- **Auth** - Authentication and authorization logs
- **System** - System operations and monitoring
- **Database** - Database operations
- **Email** - Email sending and verification
- **Logs** - Logging system events
- Or leave empty to show all types

#### **By Date Range**
- **Start Date** - Filter logs from this date onwards
- **End Date** - Filter logs up to this date

#### **By Search Text**
- Search in log messages
- Case-insensitive
- Searches across all visible logs

### 3. **Pagination**
- Navigate through pages using:
  - **Previous** button
  - **Page number** display
  - **Next** button
- Shows: `Page X of Y (Total: Z logs)`

---

## 📥 Export Logs - Multiple Formats!

Click the **"📥 Export Logs"** button to see all available formats:

### 📄 **Data Formats**

#### 1. **CSV (Spreadsheet)** 📊
- **Best for:** Excel, Google Sheets, data analysis
- **Format:** Comma-separated values
- **Columns:** ID, Type, Level, Message, Metadata, Timestamp, DateTime
- **Use case:** Importing into spreadsheet software for analysis

#### 2. **JSON (Structured Data)** { }
- **Best for:** Programming, APIs, data processing
- **Format:** JSON with metadata
- **Structure:**
  ```json
  {
    "exportDate": "2025-10-26T...",
    "filters": {...},
    "count": 150,
    "logs": [...]
  }
  ```
- **Use case:** Parsing with scripts, API integration

#### 3. **XML (Markup)** 🏷️
- **Best for:** Enterprise systems, legacy software
- **Format:** XML with nested elements
- **Structure:**
  ```xml
  <LogsExport exportDate="..." count="150">
    <Log id="1">...</Log>
  </LogsExport>
  ```
- **Use case:** Integration with enterprise systems

### 📋 **Document Formats**

#### 4. **TXT (Plain Text)** 📝
- **Best for:** Reading, simple sharing, email
- **Format:** Human-readable text with separators
- **Layout:**
  ```
  FortiMorph System Logs Export
  Export Date: ...
  Total Logs: 150
  ================
  
  [1] 2025-10-26 13:28:45
  Type: auth | Level: INFO
  Message: User logged in
  ```
- **Use case:** Quick review, email attachments, documentation

#### 5. **HTML (Web Page)** 🌐
- **Best for:** Viewing in browser, reports, presentations
- **Format:** Styled HTML with CSS
- **Features:**
  - Color-coded by severity level
  - Responsive table design
  - Beautiful Ocean Vibe theme
  - Search/filter within browser
- **Use case:** Presentations, reports, sharing with non-technical users

#### 6. **Markdown (.md)** 📖
- **Best for:** Documentation, GitHub, technical reports
- **Format:** Markdown with emojis and formatting
- **Features:**
  - Emoji indicators (ℹ️ info, ⚠️ warning, ❌ error, ✅ success)
  - Hierarchical structure
  - Code blocks for metadata
- **Use case:** GitHub issues, technical documentation, wikis

### 📦 **Package Format**

#### 7. **Diagnostic ZIP** 🗜️
- **Best for:** Technical support, bug reports, comprehensive analysis
- **Contents:**
  - `system_info.json` - System diagnostics (OS, CPU, memory, etc.)
  - `logs.json` - Sanitized log entries
  - `README.txt` - Package information
- **Features:**
  - Compressed for easy sharing
  - Sanitized sensitive information
  - Complete system snapshot
- **Use case:** Sending to support team, debugging, system audits

---

## 🎯 Common Use Cases

### **1. Debug Application Issues**
1. Filter by **Level: Error**
2. Set date range to when issue occurred
3. Export to **TXT or HTML** for easy reading
4. Or export **Diagnostic ZIP** for support team

### **2. Generate Reports**
1. Filter by date range (e.g., last month)
2. Filter by type (e.g., auth for security audit)
3. Export to **HTML** for visual reports
4. Or export to **CSV** for Excel charts

### **3. Monitor System Activity**
1. View logs with **All Levels**
2. Use search to find specific events
3. Export to **Markdown** for documentation
4. Or export to **JSON** for programmatic analysis

### **4. Compliance and Auditing**
1. Filter by **auth** type
2. Set date range for audit period
3. Export to **CSV** for compliance reports
4. Or export **Diagnostic ZIP** for comprehensive audit

### **5. Share with Team**
1. Filter relevant logs
2. Export to **HTML** (for non-technical team members)
3. Export to **JSON** (for developers)
4. Export to **TXT** (for email)

---

## 📂 Export Folder

### **Opening Export Folder**
Click **"📂 Open Export Folder"** button to:
- View all exported files
- Access recent exports
- Organize export files

### **Default Location**
- **Windows:** `C:\Users\[YourName]\AppData\Roaming\fortimorph-desktop\exports`
- **macOS:** `~/Library/Application Support/fortimorph-desktop/exports`
- **Linux:** `~/.config/fortimorph-desktop/exports`

---

## ⚙️ Log Levels Explained

| Level | Color | Icon | Description | Example |
|-------|-------|------|-------------|---------|
| **INFO** | Blue | ℹ️ | Normal operations | "User logged in" |
| **WARNING** | Yellow | ⚠️ | Potential issues | "Session about to expire" |
| **ERROR** | Red | ❌ | Failures and errors | "Database connection failed" |
| **SUCCESS** | Green | ✅ | Successful operations | "Email sent successfully" |

---

## 🔧 Log Types Explained

| Type | Description | Examples |
|------|-------------|----------|
| **auth** | Authentication & Authorization | Login, logout, signup, password reset |
| **system** | System Operations | Optimization, process monitoring, resource usage |
| **database** | Database Operations | Queries, connections, migrations |
| **email** | Email Services | Verification emails, notifications |
| **logs** | Logging System | Export operations, cleanup tasks |

---

## 💡 Tips and Best Practices

### **Performance Tips**
1. **Use Filters** - Narrow down logs before exporting to reduce file size
2. **Date Ranges** - Export specific time periods instead of all logs
3. **Regular Cleanup** - Old logs are automatically cleaned (default: 30 days retention)

### **Export Tips**
1. **Choose Right Format:**
   - Quick review → TXT or HTML
   - Data analysis → CSV or JSON
   - Documentation → Markdown
   - Support ticket → Diagnostic ZIP

2. **File Naming:**
   - Files are named with timestamps: `logs_export_1730000000000.csv`
   - Rename for better organization: `auth_logs_october_2025.csv`

3. **Sharing:**
   - HTML → Best for non-technical users
   - ZIP → Best for technical support
   - CSV → Best for analysts

### **Troubleshooting**
- **No logs showing?** - Check filters, try "Reset Filters"
- **Export failed?** - Check disk space and permissions
- **Can't open export folder?** - Try navigating manually (see Default Location)

---

## 🛡️ Privacy & Security

### **Data Protection**
- Logs are stored locally (not sent to cloud)
- Diagnostic ZIP sanitizes sensitive paths
- Personal data is minimized in logs

### **Automatic Cleanup**
- Logs older than 30 days are automatically deleted
- Prevents disk space issues
- Configurable retention period

---

## 📊 Export Format Comparison

| Format | Size | Readability | Processing | Best For |
|--------|------|-------------|------------|----------|
| CSV | Small | Medium | Easy | Excel analysis |
| JSON | Medium | Low | Very Easy | Programming |
| XML | Large | Low | Easy | Enterprise systems |
| TXT | Small | High | Manual | Quick review |
| HTML | Medium | Very High | Manual | Reports |
| Markdown | Small | High | Easy | Documentation |
| ZIP | Medium | N/A | Complex | Diagnostics |

---

## 🆘 Need Help?

1. **Check Export Status** - Success/error messages appear after export
2. **View Console Logs** - Press F12 to see detailed errors
3. **Contact Support** - Export Diagnostic ZIP and include in support ticket

---

## 📝 Summary

FortiMorph's System Logs feature provides:
- ✅ **7 Export Formats** (CSV, JSON, XML, TXT, HTML, Markdown, ZIP)
- ✅ **Powerful Filtering** (by level, type, date, search)
- ✅ **Easy Navigation** (pagination, search, sort)
- ✅ **Professional Reports** (styled HTML, formatted documents)
- ✅ **Developer-Friendly** (JSON, CSV for analysis)
- ✅ **Support-Ready** (Diagnostic ZIP with system info)

**Now you have a wide selection of export formats to choose from!** 🎉
