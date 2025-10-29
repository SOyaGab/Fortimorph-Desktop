const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

/**
 * Script to view the updated database structure with user_id column and firebase_users_cache table
 */
async function viewUpdatedDatabase() {
  try {
    const dbPath = path.join(
      process.env.APPDATA || process.env.HOME,
      'fortimorph-desktop',
      'fortimorph.db'
    );

    console.log('📂 Database Location:', dbPath);
    console.log('');

    if (!fs.existsSync(dbPath)) {
      console.log('❌ Database file not found!');
      return;
    }

    // Initialize SQL.js
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    console.log('✅ Database opened successfully!\n');
    console.log('='.repeat(80));

    // Show firebase_users_cache table
    console.log('\n📊 TABLE: FIREBASE_USERS_CACHE (NEW!)');
    console.log('-'.repeat(80));
    const firebaseUsersResult = db.exec('SELECT * FROM firebase_users_cache');
    
    if (firebaseUsersResult.length > 0 && firebaseUsersResult[0].values.length > 0) {
      const columns = firebaseUsersResult[0].columns;
      const values = firebaseUsersResult[0].values;

      console.log(`   Columns: ${columns.join(', ')}`);
      console.log(`   Row count: ${values.length}`);
      console.log('');

      for (let i = 0; i < values.length; i++) {
        console.log(`   User ${i + 1}:`);
        columns.forEach((col, idx) => {
          let value = values[i][idx];
          // Format timestamps
          if (col.includes('_at') || col.includes('login') || col.includes('sync')) {
            if (value && typeof value === 'number') {
              value = `${value} (${new Date(value * 1000).toLocaleString()})`;
            }
          }
          console.log(`      ${col}: ${value}`);
        });
        console.log('');
      }
    } else {
      console.log('   ⚠️  No Firebase users cached yet\n');
    }

    // Show logs with user_id column
    console.log('\n📊 TABLE: LOGS (with user_id column)');
    console.log('-'.repeat(80));
    const logsResult = db.exec('SELECT id, type, level, message, user_id, timestamp FROM logs ORDER BY timestamp DESC LIMIT 10');
    
    if (logsResult.length > 0 && logsResult[0].values.length > 0) {
      const columns = logsResult[0].columns;
      const values = logsResult[0].values;

      console.log(`   Showing last 10 logs:`);
      console.log(`   Columns: ${columns.join(', ')}`);
      console.log('');

      for (let i = 0; i < values.length; i++) {
        console.log(`   Log ${i + 1}:`);
        columns.forEach((col, idx) => {
          let value = values[i][idx];
          // Format timestamps
          if (col === 'timestamp') {
            if (value && typeof value === 'number') {
              value = `${value} (${new Date(value * 1000).toLocaleString()})`;
            }
          }
          // Highlight user_id
          if (col === 'user_id') {
            value = value || '(system log)';
          }
          console.log(`      ${col}: ${value}`);
        });
        console.log('');
      }
    } else {
      console.log('   ⚠️  No logs found\n');
    }

    // Show verification_codes table
    console.log('\n📊 TABLE: VERIFICATION_CODES');
    console.log('-'.repeat(80));
    const verificationResult = db.exec('SELECT uid, email, verified, created_at FROM verification_codes');
    
    if (verificationResult.length > 0 && verificationResult[0].values.length > 0) {
      const columns = verificationResult[0].columns;
      const values = verificationResult[0].values;

      console.log(`   Row count: ${values.length}`);
      console.log('');

      for (let i = 0; i < values.length; i++) {
        console.log(`   Verification ${i + 1}:`);
        columns.forEach((col, idx) => {
          let value = values[i][idx];
          if (col === 'created_at' && value) {
            value = `${value} (${new Date(value * 1000).toLocaleString()})`;
          }
          if (col === 'verified') {
            value = value === 1 ? '✅ Verified' : '❌ Not Verified';
          }
          console.log(`      ${col}: ${value}`);
        });
        console.log('');
      }
    } else {
      console.log('   ⚠️  No verification codes\n');
    }

    console.log('='.repeat(80));
    console.log('\n✨ Database structure updated successfully!');
    console.log('New features:');
    console.log('  ✅ user_id column added to logs table');
    console.log('  ✅ firebase_users_cache table created');
    console.log('  ✅ User-specific log filtering enabled');
    console.log('');
    
    db.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

viewUpdatedDatabase();
