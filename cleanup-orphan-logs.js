const SQL = require('sql.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Get database path
const dbPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'fortimorph-desktop', 'fortimorph.db');

console.log('='.repeat(70));
console.log('  CLEANING UP ORPHAN LOGS');
console.log('='.repeat(70));
console.log('\nDatabase path:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.error('\n❌ Database file not found!');
  process.exit(1);
}

// Read database file
const buffer = fs.readFileSync(dbPath);

// Initialize SQL.js
const initSqlJs = SQL;

initSqlJs().then(SQL => {
  const db = new SQL.Database(buffer);
  
  // Check orphan logs before deletion
  console.log('\n📋 Checking orphan logs before cleanup...\n');
  const beforeResult = db.exec('SELECT COUNT(*) as count, type FROM logs WHERE user_id IS NULL GROUP BY type ORDER BY type');
  
  let totalOrphans = 0;
  if (beforeResult.length > 0) {
    console.log('Found orphan logs:');
    beforeResult[0].values.forEach(row => {
      console.log(`  - ${row[1]}: ${row[0]} logs`);
      totalOrphans += row[0];
    });
    console.log(`\nTotal orphan logs: ${totalOrphans}`);
  } else {
    console.log('✅ No orphan logs found!');
    db.close();
    process.exit(0);
  }
  
  // Confirm deletion
  console.log('\n⚠️  WARNING: This will permanently delete all orphan logs.');
  console.log('These are logs that are not associated with any user.');
  console.log('\nProceeding with cleanup in 2 seconds...\n');
  
  setTimeout(() => {
    // Delete orphan logs
    console.log('🗑️  Deleting orphan logs...\n');
    
    db.run('DELETE FROM logs WHERE user_id IS NULL');
    
    // Verify deletion
    const afterResult = db.exec('SELECT COUNT(*) as count FROM logs WHERE user_id IS NULL');
    const remainingOrphans = afterResult[0].values[0][0];
    
    if (remainingOrphans === 0) {
      console.log(`✅ SUCCESS! Deleted ${totalOrphans} orphan logs.`);
      console.log('✅ Database is now clean - all logs are user-associated.\n');
      
      // Show current state
      const userLogsResult = db.exec('SELECT COUNT(*) as count FROM logs WHERE user_id IS NOT NULL');
      const userLogs = userLogsResult[0].values[0][0];
      
      console.log('📊 Current database state:');
      console.log(`   User logs: ${userLogs}`);
      console.log(`   Orphan logs: 0`);
      console.log(`   Total logs: ${userLogs}\n`);
      
      // Save database
      const data = db.export();
      const newBuffer = Buffer.from(data);
      fs.writeFileSync(dbPath, newBuffer);
      console.log('💾 Database saved successfully!\n');
      
      console.log('🎯 Next steps:');
      console.log('   1. Restart your application');
      console.log('   2. New users will start with zero logs');
      console.log('   3. All future logs will be user-specific');
      console.log('   4. Deleting a user will remove all their data\n');
    } else {
      console.log(`⚠️  WARNING: ${remainingOrphans} orphan logs still remain.`);
    }
    
    db.close();
    
    console.log('='.repeat(70));
    console.log('  CLEANUP COMPLETE');
    console.log('='.repeat(70) + '\n');
    
  }, 2000);
  
}).catch(err => {
  console.error('Error:', err);
});
