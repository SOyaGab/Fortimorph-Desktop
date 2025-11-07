/**
 * Quick database viewer for app_usage_history
 * Run with: node view-app-usage.js
 */

const path = require('path');
const initSqlJs = require('sql.js');
const fs = require('fs');

// Get database path
const userDataPath = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share");
const dbPath = path.join(userDataPath, 'fortimorph-desktop', 'fortimorph.db');

console.log('Database path:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.error('❌ Database not found at:', dbPath);
  process.exit(1);
}

async function viewAppUsage() {
  try {
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    
    console.log('\n=== App Usage History Summary ===\n');
    
    // Count total records
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM app_usage_history');
    if (countStmt.step()) {
      console.log(`Total records: ${countStmt.getAsObject().count}`);
    }
    countStmt.free();
    
    // Show date range
    const rangeStmt = db.prepare(`
      SELECT 
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM app_usage_history
    `);
    
    if (rangeStmt.step()) {
      const range = rangeStmt.getAsObject();
      if (range.oldest && range.newest) {
        const oldestDate = new Date(range.oldest * 1000);
        const newestDate = new Date(range.newest * 1000);
        console.log(`Date range: ${oldestDate.toLocaleString()} to ${newestDate.toLocaleString()}`);
      }
    }
    rangeStmt.free();
    
    // Show top apps all-time
    console.log('\n--- Top 10 Apps (All Time) ---');
    const topStmt = db.prepare(`
      SELECT 
        app_name,
        COUNT(*) as samples,
        ROUND(AVG(cpu_percent), 1) as avg_cpu,
        ROUND(SUM(battery_impact), 0) as total_impact
      FROM app_usage_history
      GROUP BY app_name
      ORDER BY total_impact DESC
      LIMIT 10
    `);
    
    let rank = 1;
    while (topStmt.step()) {
      const row = topStmt.getAsObject();
      console.log(`${rank}. ${row.app_name}`);
      console.log(`   Samples: ${row.samples} | Avg CPU: ${row.avg_cpu}% | Impact: ${row.total_impact}`);
      rank++;
    }
    topStmt.free();
    
    // Show today's data
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayStartTs = Math.floor(todayStart.getTime() / 1000);
    const nowTs = Math.floor(Date.now() / 1000);
    
    console.log(`\n--- Today's Data (since ${todayStart.toLocaleTimeString()}) ---`);
    const todayStmt = db.prepare(`
      SELECT 
        app_name,
        COUNT(*) as samples,
        ROUND(SUM(battery_impact), 0) as total_impact
      FROM app_usage_history
      WHERE timestamp >= ? AND timestamp < ?
      GROUP BY app_name
      ORDER BY total_impact DESC
      LIMIT 5
    `);
    todayStmt.bind([todayStartTs, nowTs]);
    
    rank = 1;
    let foundToday = false;
    while (todayStmt.step()) {
      foundToday = true;
      const row = todayStmt.getAsObject();
      console.log(`${rank}. ${row.app_name} - ${row.samples} samples, ${row.total_impact} impact`);
      rank++;
    }
    todayStmt.free();
    
    if (!foundToday) {
      console.log('  ⚠️ No data for today yet. Keep FortiMorph running to collect data.');
    }
    
    db.close();
    console.log('\n✅ Done!\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

viewAppUsage();
