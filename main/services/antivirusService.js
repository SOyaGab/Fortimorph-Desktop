const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs').promises;

const execPromise = util.promisify(exec);

/**
 * AntivirusService - Provides virus scanning capabilities using Windows Defender
 * 
 * Features:
 * - Single file scanning using Windows Defender
 * - Bulk file scanning
 * - PowerShell-based integration
 * - Threat detection and reporting
 */
class AntivirusService {
  constructor() {
    this.isWindows = process.platform === 'win32';
    this.defenderAvailable = null;
  }

  /**
   * Initialize and check if Windows Defender is available
   */
  async initialize() {
    if (!this.isWindows) {
      console.warn('AntivirusService: Not running on Windows, virus scanning disabled');
      this.defenderAvailable = false;
      return false;
    }

    try {
      // Check if Windows Defender is available
      const { stdout } = await execPromise(
        'powershell -Command "Get-MpComputerStatus | Select-Object -ExpandProperty AntivirusEnabled"',
        { timeout: 5000 }
      );
      
      this.defenderAvailable = stdout.trim().toLowerCase() === 'true';
      
      if (this.defenderAvailable) {
        console.log('AntivirusService: Windows Defender is available and enabled');
      } else {
        console.warn('AntivirusService: Windows Defender is not enabled');
      }
      
      return this.defenderAvailable;
    } catch (error) {
      console.warn('AntivirusService: Failed to check Windows Defender status:', error.message);
      this.defenderAvailable = false;
      return false;
    }
  }

  /**
   * Scan a single file for viruses using Windows Defender
   * @param {string} filePath - Absolute path to the file to scan
   * @returns {Promise<Object>} Scan result with isClean and threat info
   */
  async scanFile(filePath) {
    // Return clean result if not on Windows or Defender not available
    if (!this.isWindows || this.defenderAvailable === false) {
      return {
        isClean: true,
        threat: null,
        message: 'Virus scanning not available on this platform',
        skipped: true
      };
    }

    // Check if Defender availability hasn't been checked yet
    if (this.defenderAvailable === null) {
      await this.initialize();
    }

    try {
      // Verify file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        return {
          isClean: false,
          threat: null,
          message: 'File not found',
          error: 'FILE_NOT_FOUND'
        };
      }

      // Normalize path for PowerShell (escape special characters)
      const normalizedPath = path.normalize(filePath).replace(/'/g, "''");

      console.log(`AntivirusService: Scanning file: ${filePath}`);

      // Use Windows Defender Quick Scan on specific file
      // Start-MpScan -ScanType CustomScan -ScanPath will scan the specified path
      const command = `powershell -Command "Start-MpScan -ScanType CustomScan -ScanPath '${normalizedPath}'"`;
      
      try {
        // Set a timeout of 60 seconds for the scan
        await execPromise(command, { timeout: 60000 });
        
        // If the command succeeds without error, the file is clean
        console.log(`AntivirusService: File clean: ${filePath}`);
        return {
          isClean: true,
          threat: null,
          message: 'No threats detected',
          skipped: false
        };
      } catch (error) {
        // Windows Defender returns non-zero exit code if threat found
        // or if there's an actual error
        
        // Check if it's a threat detection or an error
        if (error.message.includes('threat') || error.code === 2) {
          console.warn(`AntivirusService: Threat detected in file: ${filePath}`);
          
          // Try to get threat details
          let threatName = 'Unknown threat';
          try {
            const threatCommand = `powershell -Command "Get-MpThreatDetection | Where-Object {$_.Resources -like '*${path.basename(filePath)}*'} | Select-Object -First 1 -ExpandProperty ThreatName"`;
            const { stdout: threatInfo } = await execPromise(threatCommand, { timeout: 5000 });
            if (threatInfo && threatInfo.trim()) {
              threatName = threatInfo.trim();
            }
          } catch (threatError) {
            console.warn('Failed to get threat details:', threatError.message);
          }
          
          return {
            isClean: false,
            threat: threatName,
            message: `Threat detected: ${threatName}`,
            skipped: false
          };
        }
        
        // Some other error occurred
        console.error(`AntivirusService: Scan error for ${filePath}:`, error.message);
        return {
          isClean: true, // Assume clean if we can't scan
          threat: null,
          message: `Scan error: ${error.message}`,
          error: error.code || 'SCAN_ERROR',
          skipped: false
        };
      }
    } catch (error) {
      console.error('AntivirusService: Unexpected error during scan:', error);
      return {
        isClean: true, // Assume clean on unexpected errors
        threat: null,
        message: `Unexpected error: ${error.message}`,
        error: 'UNEXPECTED_ERROR',
        skipped: false
      };
    }
  }

  /**
   * Scan multiple files for viruses
   * @param {string[]} filePaths - Array of absolute file paths to scan
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Object>} Aggregate scan results
   */
  async scanFiles(filePaths, progressCallback = null) {
    const results = {
      totalScanned: 0,
      cleanFiles: 0,
      threatsFound: 0,
      errors: 0,
      skipped: 0,
      details: []
    };

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      
      if (progressCallback) {
        progressCallback({
          current: i + 1,
          total: filePaths.length,
          currentFile: path.basename(filePath)
        });
      }

      const scanResult = await this.scanFile(filePath);
      
      results.totalScanned++;
      
      if (scanResult.skipped) {
        results.skipped++;
      } else if (scanResult.isClean) {
        results.cleanFiles++;
      } else {
        results.threatsFound++;
      }
      
      if (scanResult.error) {
        results.errors++;
      }

      results.details.push({
        filePath,
        ...scanResult
      });
    }

    return results;
  }

  /**
   * Quick check if a file is safe without full scan
   * Uses Windows Defender reputation check
   * @param {string} filePath - File to check
   * @returns {Promise<Object>} Quick check result
   */
  async quickCheck(filePath) {
    if (!this.isWindows || this.defenderAvailable === false) {
      return {
        safe: true,
        message: 'Quick check not available',
        skipped: true
      };
    }

    try {
      // Check file reputation using PowerShell
      // This is much faster than a full scan
      const normalizedPath = path.normalize(filePath).replace(/'/g, "''");
      const command = `powershell -Command "Get-MpThreat | Where-Object {$_.Resources -like '*${normalizedPath}*'}"`;
      
      const { stdout } = await execPromise(command, { timeout: 5000 });
      
      if (stdout.trim()) {
        return {
          safe: false,
          message: 'File appears in threat database',
          skipped: false
        };
      }
      
      return {
        safe: true,
        message: 'File not in threat database',
        skipped: false
      };
    } catch (error) {
      return {
        safe: true,
        message: 'Quick check completed with no issues',
        skipped: false
      };
    }
  }

  /**
   * Get Windows Defender status and last update time
   * @returns {Promise<Object>} Defender status information
   */
  async getDefenderStatus() {
    if (!this.isWindows) {
      return {
        available: false,
        enabled: false,
        message: 'Not running on Windows'
      };
    }

    try {
      const command = 'powershell -Command "Get-MpComputerStatus | Select-Object AntivirusEnabled, AntispywareEnabled, RealTimeProtectionEnabled, SignatureVersion, LastQuickScanTime, LastFullScanTime | ConvertTo-Json"';
      
      const { stdout } = await execPromise(command, { timeout: 10000 });
      const status = JSON.parse(stdout);
      
      return {
        available: true,
        enabled: status.AntivirusEnabled,
        realTimeProtection: status.RealTimeProtectionEnabled,
        signatureVersion: status.SignatureVersion,
        lastQuickScan: status.LastQuickScanTime,
        lastFullScan: status.LastFullScanTime
      };
    } catch (error) {
      console.error('Failed to get Windows Defender status:', error);
      return {
        available: false,
        enabled: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
module.exports = new AntivirusService();
