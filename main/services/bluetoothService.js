/**
 * FortiMorph Bluetooth Service
 * 
 * Handles Bluetooth file transfers using Web Bluetooth API
 * - Send files via Bluetooth after QR scan
 * - Receive files via Bluetooth
 * - Pair devices securely
 * 
 * SAFETY FEATURES:
 * - Non-blocking async operations
 * - Timeout protection
 * - Error recovery
 * - Progress tracking
 */

const { app } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class BluetoothService {
  constructor() {
    this.transfers = new Map(); // Active transfers
    this.maxChunkSize = 512; // bytes per chunk (BLE limitation)
    this.transferTimeout = 300000; // 5 minutes
  }

  /**
   * Prepare file for Bluetooth transfer
   * @param {string} filePath - Path to file to send
   * @returns {Promise<Object>} Transfer metadata
   */
  async prepareFileTransfer(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const fileBuffer = await fs.readFile(filePath);
      
      // Generate transfer ID
      const transferId = crypto.randomBytes(16).toString('hex');
      
      // Calculate checksum
      const hash = crypto.createHash('sha256');
      hash.update(fileBuffer);
      const checksum = hash.digest('hex');
      
      // Store transfer data
      this.transfers.set(transferId, {
        filePath,
        fileName: path.basename(filePath),
        fileSize: stats.size,
        buffer: fileBuffer,
        checksum,
        chunks: Math.ceil(stats.size / this.maxChunkSize),
        status: 'ready',
        progress: 0,
        createdAt: Date.now()
      });
      
      // Auto-cleanup after timeout
      setTimeout(() => {
        if (this.transfers.has(transferId)) {
          console.log(`[Bluetooth] Transfer ${transferId} expired`);
          this.transfers.delete(transferId);
        }
      }, this.transferTimeout);
      
      return {
        success: true,
        transferId,
        fileName: path.basename(filePath),
        fileSize: stats.size,
        checksum,
        chunks: Math.ceil(stats.size / this.maxChunkSize),
        maxChunkSize: this.maxChunkSize
      };
    } catch (error) {
      console.error('[Bluetooth] Failed to prepare transfer:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get file chunk for transfer
   * @param {string} transferId - Transfer ID
   * @param {number} chunkIndex - Chunk index
   * @returns {Promise<Object>} Chunk data
   */
  async getFileChunk(transferId, chunkIndex) {
    try {
      const transfer = this.transfers.get(transferId);
      
      if (!transfer) {
        throw new Error('Transfer not found');
      }
      
      const start = chunkIndex * this.maxChunkSize;
      const end = Math.min(start + this.maxChunkSize, transfer.buffer.length);
      const chunk = transfer.buffer.slice(start, end);
      
      // Update progress
      transfer.progress = ((chunkIndex + 1) / transfer.chunks) * 100;
      transfer.status = 'transferring';
      
      return {
        success: true,
        data: chunk.toString('base64'),
        chunkIndex,
        totalChunks: transfer.chunks,
        progress: transfer.progress,
        isLastChunk: chunkIndex === transfer.chunks - 1
      };
    } catch (error) {
      console.error('[Bluetooth] Failed to get chunk:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Complete file transfer
   * @param {string} transferId - Transfer ID
   */
  completeTransfer(transferId) {
    try {
      const transfer = this.transfers.get(transferId);
      
      if (transfer) {
        transfer.status = 'completed';
        transfer.progress = 100;
        
        // Cleanup after 1 minute
        setTimeout(() => {
          this.transfers.delete(transferId);
        }, 60000);
        
        return { success: true };
      }
      
      return { success: false, error: 'Transfer not found' };
    } catch (error) {
      console.error('[Bluetooth] Failed to complete transfer:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel active transfer
   * @param {string} transferId - Transfer ID
   */
  cancelTransfer(transferId) {
    try {
      if (this.transfers.has(transferId)) {
        this.transfers.delete(transferId);
        return { success: true };
      }
      
      return { success: false, error: 'Transfer not found' };
    } catch (error) {
      console.error('[Bluetooth] Failed to cancel transfer:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Receive and save file from Bluetooth transfer
   * @param {Object} fileData - File metadata and chunks
   * @returns {Promise<Object>} Save result
   */
  async receiveFile(fileData) {
    try {
      const { fileName, chunks, checksum } = fileData;
      
      // Reconstruct file from base64 chunks
      const buffers = chunks.map(chunk => Buffer.from(chunk, 'base64'));
      const fileBuffer = Buffer.concat(buffers);
      
      // Verify checksum
      const hash = crypto.createHash('sha256');
      hash.update(fileBuffer);
      const receivedChecksum = hash.digest('hex');
      
      if (receivedChecksum !== checksum) {
        throw new Error('File checksum mismatch - transfer corrupted');
      }
      
      // Save to downloads folder
      const downloadsPath = app.getPath('downloads');
      const savePath = path.join(downloadsPath, fileName);
      
      // Check if file exists and add number
      let finalPath = savePath;
      let counter = 1;
      while (await fs.access(finalPath).then(() => true).catch(() => false)) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        finalPath = path.join(downloadsPath, `${base} (${counter})${ext}`);
        counter++;
      }
      
      await fs.writeFile(finalPath, fileBuffer);
      
      return {
        success: true,
        savedPath: finalPath,
        fileName: path.basename(finalPath),
        fileSize: fileBuffer.length
      };
    } catch (error) {
      console.error('[Bluetooth] Failed to receive file:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get transfer status
   * @param {string} transferId - Transfer ID
   */
  getTransferStatus(transferId) {
    const transfer = this.transfers.get(transferId);
    
    if (!transfer) {
      return { success: false, error: 'Transfer not found' };
    }
    
    return {
      success: true,
      status: transfer.status,
      progress: transfer.progress,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      chunks: transfer.chunks
    };
  }

  /**
   * Get all active transfers
   */
  getActiveTransfers() {
    const active = [];
    
    for (const [id, transfer] of this.transfers.entries()) {
      active.push({
        transferId: id,
        fileName: transfer.fileName,
        fileSize: transfer.fileSize,
        status: transfer.status,
        progress: transfer.progress
      });
    }
    
    return { success: true, transfers: active };
  }
}

module.exports = new BluetoothService();
