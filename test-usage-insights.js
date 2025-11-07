/**
 * Test script for Usage Insights
 * This script helps verify that the timeframe data is being calculated correctly
 */

const path = require('path');
const initSqlJs = require('sql.js');
const fs = require('fs');
const { app } = require('electron');

async function testUsageInsights() {
  try {
    console.log('=== Testing Usage Insights ===\n');
    
    // Get database path
    const dbPath = path.join(app.getPath('userData'), 'fortimorph.db');
    console.log('Database path:', dbPath);
    
    if (!fs.existsSync(dbPath)) {
      console.error('❌ Database not found!');
      return;
    }
    
    // Load database
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    
    // Get current time info
    const now = new Date();
    console.log('Current time:', now.toLocaleString());
    console.log('Current timestamp (seconds):', Math.floor(Date.now() / 1000));
    console.log('');
    
    // Define timeframes
    const timeframes = {
      today: {
        name: 'Today',
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0),
        end: now
      },
      yesterday: {
        name: 'Yesterday',
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0),
        end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
      },
      lastWeek: {
        name: 'Last 7 Days',
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0),
        end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
      },
      lastMonth: {
        name: 'Last 30 Days',
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0),
        end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
      }
    };
    
    // Check each timeframe
    for (const [key, tf] of Object.entries(timeframes)) {
      console.log(`\n--- ${tf.name} ---`);
      console.log(`Range: ${tf.start.toLocaleString()} to ${tf.end.toLocaleString()}`);
      
      const startTimestamp = Math.floor(tf.start.getTime() / 1000);
      const endTimestamp = Math.floor(tf.end.getTime() / 1000);
      
      // Count total records
      const countStmt = db.prepare(
        'SELECT COUNT(*) as count FROM app_usage_history WHERE timestamp >= ? AND timestamp < ?'
      );
      countStmt.bind([startTimestamp, endTimestamp]);
      
      let recordCount = 0;
      if (countStmt.step()) {
        recordCount = countStmt.getAsObject().count;
      }
      countStmt.free();
      
      console.log(`Records in database: ${recordCount}`);
      
      if (recordCount > 0) {
        // Get app summary
        const appsStmt = db.prepare(`
          SELECT 
            app_name,
            COUNT(*) as samples,
            AVG(cpu_percent) as avg_cpu,
            SUM(battery_impact) as total_impact
          FROM app_usage_history
          WHERE timestamp >= ? AND timestamp < ?
          GROUP BY app_name
          ORDER BY total_impact DESC
          LIMIT 5
        `);
        appsStmt.bind([startTimestamp, endTimestamp]);
        
        console.log('Top apps:');
        let rank = 1;
        while (appsStmt.step()) {
          const row = appsStmt.getAsObject();
          console.log(`  ${rank}. ${row.app_name} - ${row.samples} samples, ${Math.round(row.total_impact)} impact`);
          rank++;
        }
        appsStmt.free();
      } else {
        console.log('  ⚠️ No data found for this timeframe');
      }
    }
    
    // Check oldest and newest records
    console.log('\n\n--- Data Range Summary ---');
    
    const oldestStmt = db.prepare(
      'SELECT timestamp, app_name FROM app_usage_history ORDER BY timestamp ASC LIMIT 1'
    );
    if (oldestStmt.step()) {
      const oldest = oldestStmt.getAsObject();
      const oldestDate = new Date(oldest.timestamp * 1000);
      console.log(`Oldest record: ${oldestDate.toLocaleString()} (${oldest.app_name})`);
    }
    oldestStmt.free();
    
    const newestStmt = db.prepare(
      'SELECT timestamp, app_name FROM app_usage_history ORDER BY timestamp DESC LIMIT 1'
    );
    if (newestStmt.step()) {
      const newest = newestStmt.getAsObject();
      const newestDate = new Date(newest.timestamp * 1000);
      console.log(`Newest record: ${newestDate.toLocaleString()} (${newest.app_name})`);
    }
    newestStmt.free();
    
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM app_usage_history');
    if (totalStmt.step()) {
      const total = totalStmt.getAsObject().count;
      console.log(`Total records: ${total}`);
    }
    totalStmt.free();
    
    db.close();
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testUsageInsights().catch(console.error);
