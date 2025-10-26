/**
 * Logs Service
 * Handles log exports, diagnostic generation, and log management
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const os = require('os');
const archiver = require('archiver');
const { createWriteStream } = require('fs');

class LogsService {
  constructor(dbService) {
    this.db = dbService;
    this.exportDir = path.join(app.getPath('userData'), 'exports');
  }

  /**
   * Initialize logs service
   */
  async initialize() {
    try {
      // Ensure export directory exists
      await fs.mkdir(this.exportDir, { recursive: true });
      console.log('Logs service initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize logs service:', error);
      throw error;
    }
  }

  /**
   * Export logs to CSV format
   * @param {Object} filters - Log filters
   * @param {String} filename - Output filename
   */
  async exportToCSV(filters = {}, filename = null) {
    try {
      const logs = this.db.exportLogs(filters);
      
      if (!filename) {
        filename = `logs_export_${Date.now()}.csv`;
      }
      
      const filepath = path.join(this.exportDir, filename);
      
      // CSV header
      let csv = 'ID,Type,Level,Message,Metadata,Timestamp,DateTime\n';
      
      // CSV rows
      logs.forEach(log => {
        const timestamp = new Date(log.timestamp * 1000).toISOString();
        const message = this.sanitizeCSV(log.message);
        const metadata = log.metadata ? this.sanitizeCSV(log.metadata) : '';
        
        csv += `${log.id},${log.type},${log.level},"${message}","${metadata}",${log.timestamp},${timestamp}\n`;
      });
      
      await fs.writeFile(filepath, csv, 'utf-8');
      
      this.db.addLog('logs', `Exported ${logs.length} logs to CSV: ${filename}`, null, 'info');
      
      return {
        success: true,
        filepath,
        filename,
        count: logs.length
      };
    } catch (error) {
      console.error('Failed to export logs to CSV:', error);
      this.db.addLog('logs', 'Failed to export logs to CSV', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Export logs to JSON format
   * @param {Object} filters - Log filters
   * @param {String} filename - Output filename
   */
  async exportToJSON(filters = {}, filename = null) {
    try {
      const logs = this.db.exportLogs(filters);
      
      if (!filename) {
        filename = `logs_export_${Date.now()}.json`;
      }
      
      const filepath = path.join(this.exportDir, filename);
      
      // Convert timestamps to human-readable format
      const processedLogs = logs.map(log => ({
        ...log,
        datetime: new Date(log.timestamp * 1000).toISOString(),
        metadata: log.metadata ? JSON.parse(log.metadata) : null
      }));
      
      const jsonData = {
        exportDate: new Date().toISOString(),
        filters,
        count: logs.length,
        logs: processedLogs
      };
      
      await fs.writeFile(filepath, JSON.stringify(jsonData, null, 2), 'utf-8');
      
      this.db.addLog('logs', `Exported ${logs.length} logs to JSON: ${filename}`, null, 'info');
      
      return {
        success: true,
        filepath,
        filename,
        count: logs.length
      };
    } catch (error) {
      console.error('Failed to export logs to JSON:', error);
      this.db.addLog('logs', 'Failed to export logs to JSON', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Export logs to XML format
   * @param {Object} filters - Log filters
   * @param {String} filename - Output filename
   */
  async exportToXML(filters = {}, filename = null) {
    try {
      const logs = this.db.exportLogs(filters);
      
      if (!filename) {
        filename = `logs_export_${Date.now()}.xml`;
      }
      
      const filepath = path.join(this.exportDir, filename);
      
      // Build XML
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xml += `<LogsExport exportDate="${new Date().toISOString()}" count="${logs.length}">\n`;
      
      logs.forEach(log => {
        const datetime = new Date(log.timestamp * 1000).toISOString();
        const message = this.escapeXML(log.message);
        const metadata = log.metadata ? this.escapeXML(log.metadata) : '';
        
        xml += `  <Log id="${log.id}">\n`;
        xml += `    <Type>${log.type}</Type>\n`;
        xml += `    <Level>${log.level}</Level>\n`;
        xml += `    <Message>${message}</Message>\n`;
        xml += `    <Metadata>${metadata}</Metadata>\n`;
        xml += `    <Timestamp>${log.timestamp}</Timestamp>\n`;
        xml += `    <DateTime>${datetime}</DateTime>\n`;
        xml += `  </Log>\n`;
      });
      
      xml += '</LogsExport>';
      
      await fs.writeFile(filepath, xml, 'utf-8');
      
      this.db.addLog('logs', `Exported ${logs.length} logs to XML: ${filename}`, null, 'info');
      
      return {
        success: true,
        filepath,
        filename,
        count: logs.length
      };
    } catch (error) {
      console.error('Failed to export logs to XML:', error);
      this.db.addLog('logs', 'Failed to export logs to XML', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Export logs to TXT format (plain text)
   * @param {Object} filters - Log filters
   * @param {String} filename - Output filename
   */
  async exportToTXT(filters = {}, filename = null) {
    try {
      const logs = this.db.exportLogs(filters);
      
      if (!filename) {
        filename = `logs_export_${Date.now()}.txt`;
      }
      
      const filepath = path.join(this.exportDir, filename);
      
      // Build plain text
      let txt = `FortiMorph System Logs Export\n`;
      txt += `Export Date: ${new Date().toISOString()}\n`;
      txt += `Total Logs: ${logs.length}\n`;
      txt += `${'='.repeat(80)}\n\n`;
      
      logs.forEach((log, index) => {
        const datetime = new Date(log.timestamp * 1000).toISOString();
        txt += `[${index + 1}] ${datetime}\n`;
        txt += `Type: ${log.type} | Level: ${log.level.toUpperCase()}\n`;
        txt += `Message: ${log.message}\n`;
        if (log.metadata) {
          txt += `Metadata: ${log.metadata}\n`;
        }
        txt += `${'-'.repeat(80)}\n\n`;
      });
      
      await fs.writeFile(filepath, txt, 'utf-8');
      
      this.db.addLog('logs', `Exported ${logs.length} logs to TXT: ${filename}`, null, 'info');
      
      return {
        success: true,
        filepath,
        filename,
        count: logs.length
      };
    } catch (error) {
      console.error('Failed to export logs to TXT:', error);
      this.db.addLog('logs', 'Failed to export logs to TXT', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Export logs to HTML format (styled table)
   * @param {Object} filters - Log filters
   * @param {String} filename - Output filename
   */
  async exportToHTML(filters = {}, filename = null) {
    try {
      const logs = this.db.exportLogs(filters);
      
      if (!filename) {
        filename = `logs_export_${Date.now()}.html`;
      }
      
      const filepath = path.join(this.exportDir, filename);
      
      // Build HTML with styling
      let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FortiMorph System Logs</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #001D3D; color: #fff; padding: 20px; }
    .header { background: linear-gradient(135deg, #0077B6, #48CAE4); padding: 30px; border-radius: 10px; margin-bottom: 20px; }
    .header h1 { font-size: 32px; margin-bottom: 10px; }
    .header p { opacity: 0.9; }
    .stats { display: flex; gap: 20px; margin-bottom: 20px; }
    .stat-card { background: #023E8A; padding: 20px; border-radius: 10px; flex: 1; }
    .stat-card h3 { font-size: 14px; opacity: 0.7; margin-bottom: 5px; }
    .stat-card p { font-size: 24px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; background: #023E8A; border-radius: 10px; overflow: hidden; }
    th { background: #0077B6; padding: 15px; text-align: left; font-weight: 600; }
    td { padding: 12px 15px; border-bottom: 1px solid #0077B6; }
    tr:hover { background: #034078; }
    .level-info { color: #48CAE4; }
    .level-warning { color: #FFD60A; }
    .level-error { color: #F72585; }
    .level-success { color: #06FFA5; }
    .metadata { font-size: 12px; opacity: 0.7; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .footer { text-align: center; margin-top: 30px; opacity: 0.5; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🛡️ FortiMorph System Logs</h1>
    <p>Export Date: ${new Date().toISOString()}</p>
  </div>
  
  <div class="stats">
    <div class="stat-card">
      <h3>Total Logs</h3>
      <p>${logs.length}</p>
    </div>
    <div class="stat-card">
      <h3>Export Format</h3>
      <p>HTML</p>
    </div>
    <div class="stat-card">
      <h3>Application</h3>
      <p>FortiMorph Desktop</p>
    </div>
  </div>
  
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Date & Time</th>
        <th>Type</th>
        <th>Level</th>
        <th>Message</th>
        <th>Metadata</th>
      </tr>
    </thead>
    <tbody>\n`;
      
      logs.forEach(log => {
        const datetime = new Date(log.timestamp * 1000).toLocaleString();
        const message = this.escapeHTML(log.message);
        const metadata = log.metadata ? this.escapeHTML(log.metadata) : '-';
        const levelClass = `level-${log.level}`;
        
        html += `      <tr>
        <td>${log.id}</td>
        <td>${datetime}</td>
        <td>${log.type}</td>
        <td class="${levelClass}">${log.level.toUpperCase()}</td>
        <td>${message}</td>
        <td class="metadata">${metadata}</td>
      </tr>\n`;
      });
      
      html += `    </tbody>
  </table>
  
  <div class="footer">
    <p>Generated by FortiMorph Desktop v${app.getVersion()}</p>
  </div>
</body>
</html>`;
      
      await fs.writeFile(filepath, html, 'utf-8');
      
      this.db.addLog('logs', `Exported ${logs.length} logs to HTML: ${filename}`, null, 'info');
      
      return {
        success: true,
        filepath,
        filename,
        count: logs.length
      };
    } catch (error) {
      console.error('Failed to export logs to HTML:', error);
      this.db.addLog('logs', 'Failed to export logs to HTML', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Export logs to Markdown format
   * @param {Object} filters - Log filters
   * @param {String} filename - Output filename
   */
  async exportToMarkdown(filters = {}, filename = null) {
    try {
      const logs = this.db.exportLogs(filters);
      
      if (!filename) {
        filename = `logs_export_${Date.now()}.md`;
      }
      
      const filepath = path.join(this.exportDir, filename);
      
      // Build Markdown
      let md = `# 🛡️ FortiMorph System Logs\n\n`;
      md += `**Export Date:** ${new Date().toISOString()}  \n`;
      md += `**Total Logs:** ${logs.length}  \n`;
      md += `**Application:** FortiMorph Desktop v${app.getVersion()}\n\n`;
      md += `---\n\n`;
      md += `## Log Entries\n\n`;
      
      logs.forEach((log, index) => {
        const datetime = new Date(log.timestamp * 1000).toISOString();
        const levelEmoji = {
          info: 'ℹ️',
          warning: '⚠️',
          error: '❌',
          success: '✅'
        }[log.level] || '📝';
        
        md += `### ${levelEmoji} Log #${index + 1}\n\n`;
        md += `- **ID:** ${log.id}\n`;
        md += `- **Date & Time:** ${datetime}\n`;
        md += `- **Type:** \`${log.type}\`\n`;
        md += `- **Level:** \`${log.level.toUpperCase()}\`\n`;
        md += `- **Message:** ${log.message}\n`;
        if (log.metadata) {
          md += `- **Metadata:**\n  \`\`\`json\n  ${log.metadata}\n  \`\`\`\n`;
        }
        md += `\n---\n\n`;
      });
      
      await fs.writeFile(filepath, md, 'utf-8');
      
      this.db.addLog('logs', `Exported ${logs.length} logs to Markdown: ${filename}`, null, 'info');
      
      return {
        success: true,
        filepath,
        filename,
        count: logs.length
      };
    } catch (error) {
      console.error('Failed to export logs to Markdown:', error);
      this.db.addLog('logs', 'Failed to export logs to Markdown', { error: error.message }, 'error');
      throw error;
    }
  }

  /**
   * Generate system diagnostic information
   */
  async generateDiagnostics() {
    try {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        system: {
          platform: os.platform(),
          arch: os.arch(),
          release: os.release(),
          hostname: os.hostname(),
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          cpus: os.cpus().length,
          uptime: os.uptime()
        },
        app: {
          version: app.getVersion(),
          name: app.getName(),
          path: app.getPath('userData')
        },
        logs: {
          total: this.db.getLogsFiltered({}, 1, 1).total,
          types: this.db.getLogTypes()
        }
      };
      
      return diagnostics;
    } catch (error) {
      console.error('Failed to generate diagnostics:', error);
      throw error;
    }
  }

  /**
   * Export diagnostic package as ZIP
   * @param {Object} filters - Log filters for included logs
   * @param {String} filename - Output filename
   */
  async exportDiagnosticZIP(filters = {}, filename = null) {
    return new Promise((resolve, reject) => {
      const processExport = async () => {
        try {
          if (!filename) {
            filename = `diagnostic_${Date.now()}.zip`;
          }
          
          const filepath = path.join(this.exportDir, filename);
          const output = createWriteStream(filepath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        output.on('close', () => {
          this.db.addLog('logs', `Exported diagnostic package: ${filename}`, 
            { size: archive.pointer() }, 'info');
          
          resolve({
            success: true,
            filepath,
            filename,
            size: archive.pointer()
          });
        });
        
        archive.on('error', (err) => {
          this.db.addLog('logs', 'Failed to create diagnostic ZIP', 
            { error: err.message }, 'error');
          reject(err);
        });
        
        archive.pipe(output);
        
        // Add system diagnostics
        const diagnostics = await this.generateDiagnostics();
        archive.append(JSON.stringify(diagnostics, null, 2), { 
          name: 'system_info.json' 
        });
        
        // Add logs as JSON
        const logs = this.db.exportLogs(filters);
        const sanitizedLogs = logs.map(log => ({
          id: log.id,
          type: log.type,
          level: log.level,
          message: log.message,
          timestamp: log.timestamp,
          datetime: new Date(log.timestamp * 1000).toISOString(),
          // Don't include raw metadata that might have sensitive info
          hasMetadata: !!log.metadata
        }));
        
        archive.append(JSON.stringify(sanitizedLogs, null, 2), { 
          name: 'logs.json' 
        });
        
        // Add a README
        const readme = `FortiMorph Diagnostic Package
Generated: ${new Date().toISOString()}
Platform: ${os.platform()} ${os.arch()}

Contents:
- system_info.json: System and application information
- logs.json: Sanitized application logs (${logs.length} entries)

Note: Sensitive information like file paths and user data have been sanitized.
`;
        
        archive.append(readme, { name: 'README.txt' });
        
        await archive.finalize();
        
      } catch (error) {
        console.error('Failed to export diagnostic ZIP:', error);
        this.db.addLog('logs', 'Failed to export diagnostic ZIP', 
          { error: error.message }, 'error');
        reject(error);
      }
      };
      
      processExport();
    });
  }

  /**
   * Schedule automatic log cleanup
   * @param {Number} retentionDays - Days to keep logs
   */
  scheduleCleanup(retentionDays = 30) {
    // Run cleanup every 24 hours
    const interval = 24 * 60 * 60 * 1000;
    
    const cleanup = () => {
      try {
        this.db.cleanupOldLogs(retentionDays);
        console.log(`Log cleanup completed. Retention: ${retentionDays} days`);
      } catch (error) {
        console.error('Failed to cleanup logs:', error);
      }
    };
    
    // Run immediately on startup
    setTimeout(cleanup, 5000); // 5 seconds after startup
    
    // Schedule recurring cleanup
    setInterval(cleanup, interval);
    
    this.db.addLog('logs', `Scheduled automatic log cleanup (${retentionDays} days retention)`, 
      null, 'info');
  }

  /**
   * Sanitize text for CSV export
   */
  sanitizeCSV(text) {
    if (!text) return '';
    return text.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  }

  /**
   * Escape XML special characters
   */
  escapeXML(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Escape HTML special characters
   */
  escapeHTML(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Get export directory path
   */
  getExportDir() {
    return this.exportDir;
  }
}

module.exports = LogsService;
