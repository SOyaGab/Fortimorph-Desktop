// Detailed hex dump of Recycle Bin metadata to understand the structure
const fs = require('fs');
const path = require('path');

async function analyzeMetadata() {
  console.log('Analyzing Recycle Bin metadata structure...\n');
  
  // Find a user SID folder
  const recycleBinPath = 'C:\\$Recycle.Bin';
  const entries = await fs.promises.readdir(recycleBinPath);
  
  for (const entry of entries) {
    if (entry.startsWith('S-1-5-21')) {
      const sidPath = path.join(recycleBinPath, entry);
      console.log(`Found user folder: ${entry}\n`);
      
      try {
        const files = await fs.promises.readdir(sidPath);
        const iFiles = files.filter(f => f.startsWith('$I'));
        
        // Analyze first metadata file
        if (iFiles.length > 0) {
          const metaPath = path.join(sidPath, iFiles[0]);
          const buffer = await fs.promises.readFile(metaPath);
          
          console.log(`Analyzing: ${iFiles[0]}`);
          console.log(`Total size: ${buffer.length} bytes\n`);
          
          // Show header (first 8 bytes)
          console.log('Header (bytes 0-7):');
          console.log(buffer.slice(0, 8).toString('hex'));
          console.log('');
          
          // Show file size (bytes 8-15)
          console.log('File size (bytes 8-15):');
          console.log(buffer.slice(8, 16).toString('hex'));
          const fileSize = Number(buffer.readBigUInt64LE(8));
          console.log(`Parsed: ${fileSize} bytes (${(fileSize/1024).toFixed(2)} KB)`);
          console.log('');
          
          // Show deletion time (bytes 16-23)
          console.log('Deletion time (bytes 16-23):');
          console.log(buffer.slice(16, 24).toString('hex'));
          const fileTime = buffer.readBigUInt64LE(16);
          const deletionTime = Number((fileTime / 10000n) - 11644473600000n);
          console.log(`Parsed: ${new Date(deletionTime).toLocaleString()}`);
          console.log('');
          
          // Show path bytes (from byte 24 onwards)
          console.log('Path data (bytes 24+):');
          const pathBytes = buffer.slice(24);
          console.log(`Length: ${pathBytes.length} bytes`);
          console.log('First 200 bytes as hex:');
          console.log(pathBytes.slice(0, 200).toString('hex'));
          console.log('');
          
          // Try different parsing methods
          console.log('Parsing attempts:');
          
          console.log('1. UTF-16LE (with split):');
          const utf16 = pathBytes.toString('utf16le').split('\0')[0];
          console.log(`   Result: "${utf16}"`);
          console.log(`   Length: ${utf16.length} chars`);
          console.log('');
          
          console.log('2. UTF-16LE (no split):');
          const utf16NoSplit = pathBytes.toString('utf16le');
          console.log(`   Result (first 100 chars): "${utf16NoSplit.substring(0, 100)}"`);
          console.log('');
          
          console.log('3. Character by character (UTF-16LE):');
          let chars = [];
          for (let i = 0; i < Math.min(60, pathBytes.length); i += 2) {
            if (i + 1 < pathBytes.length) {
              const charCode = pathBytes.readUInt16LE(i);
              if (charCode === 0) break;
              chars.push(String.fromCharCode(charCode));
            }
          }
          console.log(`   Result: "${chars.join('')}"`);
          console.log('');
          
          console.log('4. ASCII (for comparison):');
          const ascii = pathBytes.toString('ascii', 0, 100);
          console.log(`   Result: "${ascii}"`);
        }
        
        break; // Only analyze one file
      } catch (err) {
        console.log(`Error: ${err.message}`);
      }
    }
  }
}

analyzeMetadata().catch(err => {
  console.error('Fatal error:', err);
});
