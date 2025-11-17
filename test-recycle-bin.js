// Quick test script to verify Recycle Bin parsing
const fs = require('fs');
const path = require('path');

console.log('='.repeat(60));
console.log('RECYCLE BIN METADATA PARSER TEST');
console.log('='.repeat(60));

async function testRecycleBin() {
  console.log('\n[1] Finding Recycle Bin paths...\n');
  
  // Find Recycle Bin paths
  const drives = [];
  for (let i = 65; i <= 90; i++) { // A-Z
    const drive = String.fromCharCode(i);
    const drivePath = `${drive}:\\`;
    if (fs.existsSync(drivePath)) {
      const recycleBinPath = path.join(drivePath, '$Recycle.Bin');
      if (fs.existsSync(recycleBinPath)) {
        drives.push(recycleBinPath);
        console.log(`  ✅ Found: ${recycleBinPath}`);
      }
    }
  }
  
  if (drives.length === 0) {
    console.log('  ❌ No Recycle Bin paths found');
    return;
  }
  
  console.log(`\n[2] Found ${drives.length} Recycle Bin(s)\n`);
  
  let totalParsed = 0;
  let totalErrors = 0;
  
  // Scan each Recycle Bin
  for (const recycleBinPath of drives) {
    console.log('-'.repeat(60));
    console.log(`Scanning: ${recycleBinPath}`);
    console.log('-'.repeat(60));
    
    try {
      const entries = await fs.promises.readdir(recycleBinPath);
      const sidFolders = [];
      
      for (const entry of entries) {
        const entryPath = path.join(recycleBinPath, entry);
        try {
          const stats = await fs.promises.stat(entryPath);
          if (stats.isDirectory() && entry.startsWith('S-1-5-')) {
            sidFolders.push(entry);
          }
        } catch (err) {
          // Skip inaccessible entries
        }
      }
      
      console.log(`\nFound ${sidFolders.length} user SID folder(s)\n`);
      
      for (const sidFolder of sidFolders) {
        const sidPath = path.join(recycleBinPath, sidFolder);
        console.log(`User: ${sidFolder}`);
        
        try {
          const files = await fs.promises.readdir(sidPath);
          const rFiles = files.filter(f => f.startsWith('$R'));
          const iFiles = files.filter(f => f.startsWith('$I'));
          
          console.log(`  Data files ($R): ${rFiles.length}`);
          console.log(`  Meta files ($I): ${iFiles.length}\n`);
          
          // Test parsing first 3 items
          const testCount = Math.min(3, rFiles.length);
          if (testCount === 0) {
            console.log('  (No files to test)\n');
            continue;
          }
          
          for (let i = 0; i < testCount; i++) {
            const rFile = rFiles[i];
            const identifier = rFile.substring(2);
            const iFile = `$I${identifier}`;
            
            console.log(`  [${i+1}/${testCount}] ${rFile}`);
            
            if (iFiles.includes(iFile)) {
              try {
                const metaPath = path.join(sidPath, iFile);
                const metaBuffer = await fs.promises.readFile(metaPath);
                
                if (metaBuffer.length >= 24) {
                  const fileSize = Number(metaBuffer.readBigUInt64LE(8));
                  const fileTime = metaBuffer.readBigUInt64LE(16);
                  const deletionTime = Number((fileTime / 10000n) - 11644473600000n);
                  
                  if (metaBuffer.length > 28) {
                    // Try Windows 10+ format (byte 28)
                    let pathBuffer = metaBuffer.slice(28);
                    let pathStr = pathBuffer.toString('utf16le');
                    let originalPath = pathStr.split('\0')[0].trim();
                    
                    // If doesn't look like a valid path, try legacy format (byte 24)
                    if (!originalPath.includes(':\\') && !originalPath.startsWith('\\')) {
                      pathBuffer = metaBuffer.slice(24);
                      pathStr = pathBuffer.toString('utf16le');
                      originalPath = pathStr.split('\0')[0].trim();
                    }
                    
                    if (originalPath) {
                      console.log(`      ✅ Original: ${originalPath}`);
                      console.log(`         Size: ${(fileSize / 1024).toFixed(2)} KB`);
                      console.log(`         Deleted: ${new Date(deletionTime).toLocaleString()}`);
                      totalParsed++;
                    } else {
                      console.log(`      ⚠️  Empty path extracted`);
                      totalErrors++;
                    }
                  } else {
                    console.log(`      ⚠️  Metadata too small (${metaBuffer.length} bytes)`);
                    totalErrors++;
                  }
                } else {
                  console.log(`      ⚠️  Invalid metadata (${metaBuffer.length} bytes)`);
                  totalErrors++;
                }
              } catch (err) {
                console.log(`      ❌ Parse error: ${err.message}`);
                totalErrors++;
              }
            } else {
              console.log(`      ⚠️  No metadata file`);
              totalErrors++;
            }
            console.log('');
          }
        } catch (err) {
          console.log(`  ❌ Error reading SID folder: ${err.message}\n`);
        }
      }
    } catch (err) {
      console.log(`❌ Error scanning Recycle Bin: ${err.message}\n`);
    }
  }
  
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`✅ Successfully parsed: ${totalParsed}`);
  console.log(`❌ Errors encountered: ${totalErrors}`);
  console.log('='.repeat(60));
}

testRecycleBin().catch(err => {
  console.error('\n❌ FATAL ERROR:', err);
  process.exit(1);
});
