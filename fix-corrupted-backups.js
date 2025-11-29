/**
 * Utility script to diagnose and fix corrupted backups
 * Run with: node fix-corrupted-backups.js
 */

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

async function main() {
  console.log('='.repeat(60));
  console.log('BACKUP DIAGNOSTIC AND REPAIR TOOL');
  console.log('='.repeat(60));
  
  // Find the database file
  const dbPath = path.join(
    process.env.APPDATA || path.join(process.env.HOME, 'AppData', 'Roaming'),
    'fortimorph-desktop',
    'fortimorph.db'
  );
  
  console.log('\nDatabase path:', dbPath);
  
  if (!fs.existsSync(dbPath)) {
    console.error('Database file not found!');
    process.exit(1);
  }
  
  // Load SQL.js
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);
  
  // Get all backups
  console.log('\n' + '-'.repeat(60));
  console.log('ANALYZING BACKUPS');
  console.log('-'.repeat(60));
  
  const backups = db.exec('SELECT * FROM backups ORDER BY created_at DESC');
  
  if (!backups.length || !backups[0].values.length) {
    console.log('No backups found in database.');
    db.close();
    return;
  }
  
  const columns = backups[0].columns;
  const rows = backups[0].values;
  
  console.log(`\nFound ${rows.length} backup(s)\n`);
  
  const issues = [];
  const toDelete = [];
  
  for (const row of rows) {
    const backup = {};
    columns.forEach((col, i) => backup[col] = row[i]);
    
    console.log(`\n--- Backup ID: ${backup.id} ---`);
    console.log(`  Name: ${backup.name}`);
    console.log(`  Source: ${backup.source_path}`);
    console.log(`  Backup Path: ${backup.backup_path}`);
    console.log(`  Size: ${backup.size} bytes`);
    console.log(`  File Count: ${backup.file_count}`);
    console.log(`  Encrypted: ${backup.encrypted ? 'Yes' : 'No'}`);
    console.log(`  User ID: ${backup.user_id || 'NULL'}`);
    
    // Check for issues
    const backupIssues = [];
    
    // Check if size is 0
    if (backup.size === 0 || backup.size === null) {
      backupIssues.push('Size is 0 or null');
    }
    
    // Check if file count is 0
    if (backup.file_count === 0 || backup.file_count === null) {
      backupIssues.push('File count is 0 or null');
    }
    
    // Check if backup path exists
    if (backup.backup_path && !fs.existsSync(backup.backup_path)) {
      backupIssues.push(`Backup directory does not exist: ${backup.backup_path}`);
    }
    
    // Check manifest
    if (backup.manifest) {
      try {
        const manifest = JSON.parse(backup.manifest);
        
        if (!manifest.files || manifest.files.length === 0) {
          backupIssues.push('Manifest has no files');
        } else {
          console.log(`  Manifest Files: ${manifest.files.length}`);
          
          // Check if backup files exist
          let missingFiles = 0;
          for (const file of manifest.files) {
            if (file.backupPath && !fs.existsSync(file.backupPath)) {
              missingFiles++;
            }
          }
          
          if (missingFiles > 0) {
            backupIssues.push(`${missingFiles} backup file(s) missing from disk`);
          }
        }
      } catch (e) {
        backupIssues.push(`Invalid manifest JSON: ${e.message}`);
      }
    } else {
      backupIssues.push('No manifest stored');
    }
    
    if (backupIssues.length > 0) {
      console.log(`  ⚠️  ISSUES FOUND:`);
      backupIssues.forEach(issue => console.log(`      - ${issue}`));
      issues.push({ id: backup.id, name: backup.name, issues: backupIssues });
      
      // Mark for potential deletion if completely broken
      if (backupIssues.includes('Size is 0 or null') && 
          backupIssues.includes('File count is 0 or null')) {
        toDelete.push(backup.id);
      }
    } else {
      console.log(`  ✅ No issues found`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`\nTotal backups: ${rows.length}`);
  console.log(`Backups with issues: ${issues.length}`);
  console.log(`Completely broken (recommended for deletion): ${toDelete.length}`);
  
  if (toDelete.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('BROKEN BACKUPS (IDs):', toDelete.join(', '));
    console.log('-'.repeat(60));
    
    // AUTO-DELETE BROKEN BACKUPS
    console.log('\nDeleting broken backups...');
    for (const id of toDelete) {
      db.run('DELETE FROM backups WHERE id = ?', [id]);
      console.log(`  ✅ Deleted backup ID: ${id}`);
    }
    
    // Save changes
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
    console.log('\n✅ Database saved successfully.');
    console.log('The broken backup entries have been removed.');
  }
  
  db.close();
  console.log('\nDiagnostic complete.');
}

main().catch(console.error);
