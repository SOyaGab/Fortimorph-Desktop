/**
 * Delete User from Local Database
 * Run this after deleting a user from Firebase Console
 * 
 * Usage: node delete-user.js <email>
 * Example: node delete-user.js gabrielgarrate8@gmail.com
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function deleteUser(email) {
  try {
    // Get the database path
    const appDataPath = path.join(
      process.env.APPDATA || 
      (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : 
       path.join(os.homedir(), '.config')),
      'fortimorph-desktop'
    );
    const dbPath = path.join(appDataPath, 'fortimorph.db');

    console.log('Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
      console.error('Database not found at:', dbPath);
      process.exit(1);
    }

    // Load database
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    let uid = null;
    let found = false;

    // Check firebase_users_cache
    let stmt = db.prepare('SELECT * FROM firebase_users_cache WHERE email = ?');
    stmt.bind([email]);
    if (stmt.step()) {
      const user = stmt.getAsObject();
      uid = user.uid;
      found = true;
      console.log('\n📌 Found in firebase_users_cache:');
      console.log('- UID:', user.uid);
      console.log('- Email:', user.email);
    }
    stmt.free();

    // Check verification_codes
    stmt = db.prepare('SELECT * FROM verification_codes WHERE email = ?');
    stmt.bind([email]);
    if (stmt.step()) {
      const vc = stmt.getAsObject();
      if (!uid) uid = vc.uid;
      found = true;
      console.log('\n📌 Found in verification_codes:');
      console.log('- UID:', vc.uid);
      console.log('- Email:', vc.email);
    }
    stmt.free();

    // Check local user table
    stmt = db.prepare('SELECT * FROM user WHERE email = ?');
    stmt.bind([email]);
    if (stmt.step()) {
      const user = stmt.getAsObject();
      if (!uid) uid = `local_${user.id}`;
      found = true;
      console.log('\n📌 Found in user table:');
      console.log('- ID:', user.id);
      console.log('- Email:', user.email);
    }
    stmt.free();

    if (!found) {
      console.log(`\n✅ No data found for: ${email}`);
      console.log('User may have already been deleted.');
      db.close();
      process.exit(0);
    }

    console.log('\n🗑️ Deleting user data...');
    let deletedCount = 0;

    // Delete from firebase_users_cache
    stmt = db.prepare('DELETE FROM firebase_users_cache WHERE email = ?');
    stmt.bind([email]);
    stmt.step();
    stmt.free();
    console.log('  ✓ Deleted from firebase_users_cache');
    deletedCount++;

    // Delete from verification_codes
    stmt = db.prepare('DELETE FROM verification_codes WHERE email = ?');
    stmt.bind([email]);
    stmt.step();
    stmt.free();
    console.log('  ✓ Deleted from verification_codes');
    deletedCount++;

    // Delete from user table
    stmt = db.prepare('DELETE FROM user WHERE email = ?');
    stmt.bind([email]);
    stmt.step();
    stmt.free();
    console.log('  ✓ Deleted from user table');
    deletedCount++;

    // Delete related data by UID
    if (uid) {
      const tables = [
        'logs',
        'settings', 
        'backups',
        'verification_tokens',
        'deleted_files',
        'duplicate_scans',
        'conversions',
        'app_usage_history',
        'app_usage_sessions'
      ];

      for (const table of tables) {
        try {
          stmt = db.prepare(`DELETE FROM ${table} WHERE user_id = ?`);
          stmt.bind([uid]);
          stmt.step();
          stmt.free();
          console.log(`  ✓ Deleted from ${table}`);
          deletedCount++;
        } catch (e) {
          // Table might not exist, skip
        }
      }

      // Try quarantine table
      try {
        stmt = db.prepare('DELETE FROM quarantine WHERE user_id = ?');
        stmt.bind([uid]);
        stmt.step();
        stmt.free();
        console.log('  ✓ Deleted from quarantine');
        deletedCount++;
      } catch (e) {
        // Table might not exist
      }
    }

    // Save database
    const data = db.export();
    const newBuffer = Buffer.from(data);
    fs.writeFileSync(dbPath, newBuffer);

    console.log(`\n✅ User "${email}" completely deleted from local database!`);
    console.log(`🗑️ Cleaned up ${deletedCount} tables.`);
    console.log('\n📝 You can now sign up again with this email.');
    
    db.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Get email from command line arguments
const email = process.argv[2];

if (!email) {
  console.error('Usage: node delete-user.js <email>');
  console.error('Example: node delete-user.js user@example.com');
  console.error('\nRun this AFTER deleting the user from Firebase Console.');
  process.exit(1);
}

deleteUser(email);
