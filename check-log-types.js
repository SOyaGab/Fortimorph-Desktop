const SQL = require('sql.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Get database path
const dbPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'fortimorph-desktop', 'fortimorph.db');

console.log('Database path:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.error('Database file not found!');
  process.exit(1);
}

// Read database file
const buffer = fs.readFileSync(dbPath);

// Initialize SQL.js
const initSqlJs = SQL;

initSqlJs().then(SQL => {
  const db = new SQL.Database(buffer);
  
  // Check all distinct log types
  console.log('\n=== All Distinct Log Types in Database ===');
  const typesResult = db.exec('SELECT DISTINCT type FROM logs ORDER BY type');
  if (typesResult.length > 0) {
    typesResult[0].values.forEach(row => {
      console.log(' -', row[0]);
    });
  } else {
    console.log('No log types found');
  }
  
  // Check log counts by type
  console.log('\n=== Log Counts by Type ===');
  const countsResult = db.exec('SELECT type, COUNT(*) as count FROM logs GROUP BY type ORDER BY type');
  if (countsResult.length > 0) {
    countsResult[0].values.forEach(row => {
      console.log(` - ${row[0]}: ${row[1]} logs`);
    });
  }
  
  // Check if user_id column exists and has values
  console.log('\n=== User ID Check ===');
  const userCheckResult = db.exec('SELECT COUNT(*) as total, COUNT(user_id) as with_user FROM logs');
  if (userCheckResult.length > 0) {
    console.log(` - Total logs: ${userCheckResult[0].values[0][0]}`);
    console.log(` - Logs with user_id: ${userCheckResult[0].values[0][1]}`);
  }
  
  // Check most recent logs
  console.log('\n=== Recent Logs (last 5) ===');
  const recentResult = db.exec('SELECT id, type, user_id, message, timestamp FROM logs ORDER BY id DESC LIMIT 5');
  if (recentResult.length > 0) {
    recentResult[0].values.forEach(row => {
      console.log(` - ID: ${row[0]}, Type: ${row[1]}, User: ${row[2]}, Message: ${row[3].substring(0, 50)}...`);
    });
  }
  
  db.close();
}).catch(err => {
  console.error('Error:', err);
});
