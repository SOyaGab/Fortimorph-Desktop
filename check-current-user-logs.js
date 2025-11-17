const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function checkUserLogs() {
  const SQL = await initSqlJs();
  const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'fortimorph-desktop', 'fortimorph.db');
  
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);
  
  console.log('\n📊 CURRENT USER LOGS ANALYSIS\n');
  
  // Get all users
  const users = db.exec('SELECT uid, email FROM firebase_users_cache ORDER BY created_at DESC');
  if (users.length > 0) {
    console.log('👥 Users in system:');
    users[0].values.forEach(([uid, email]) => {
      console.log(`   - ${email} (${uid})`);
    });
  }
  
  console.log('\n📋 Log types per user:\n');
  
  // Get log types for each user
  const logsByUser = db.exec(`
    SELECT 
      l.user_id,
      f.email,
      l.type,
      COUNT(*) as count
    FROM logs l
    LEFT JOIN firebase_users_cache f ON l.user_id = f.uid
    WHERE l.user_id IS NOT NULL
    GROUP BY l.user_id, l.type
    ORDER BY f.email, l.type
  `);
  
  if (logsByUser.length > 0) {
    let currentUser = null;
    logsByUser[0].values.forEach(([uid, email, type, count]) => {
      if (email !== currentUser) {
        console.log(`\n👤 ${email || 'Unknown'} (${uid}):`);
        currentUser = email;
      }
      console.log(`   ✓ ${type}: ${count} logs`);
    });
  }
  
  console.log('\n💡 EXPLANATION:');
  console.log('The Module/Type dropdown only shows log types that YOU have created.');
  console.log('To see "conversion", "backup", etc., you need to:');
  console.log('  1. Use the Conversion Center feature → creates "ConversionService" logs');
  console.log('  2. Create a backup → creates "backup" logs');
  console.log('  3. Use other features → creates their respective logs');
  console.log('\nThis is CORRECT behavior - you only see YOUR log types! ✅\n');
  
  db.close();
}

checkUserLogs().catch(console.error);
