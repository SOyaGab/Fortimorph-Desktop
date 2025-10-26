/**
 * List All Users
 * Shows users in both local SQLite database and provides Firebase info
 * 
 * Usage: node list-all-users.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function listAllUsers() {
  try {
    // Get the database path
    const appDataPath = path.join(
      process.env.APPDATA || 
      (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : 
       path.join(os.homedir(), '.config')),
      'fortimorph-desktop'
    );
    const dbPath = path.join(appDataPath, 'fortimorph.db');

    console.log('🗄️  Database location:', dbPath);
    console.log('');

    if (!fs.existsSync(dbPath)) {
      console.log('❌ No local database found\n');
    } else {
      // Load database
      const SQL = await initSqlJs();
      const buffer = fs.readFileSync(dbPath);
      const db = new SQL.Database(buffer);

      // Get all users
      const usersStmt = db.prepare('SELECT * FROM user ORDER BY created_at DESC');
      const users = [];
      while (usersStmt.step()) {
        users.push(usersStmt.getAsObject());
      }
      usersStmt.free();

      console.log('═'.repeat(70));
      console.log('📋 LOCAL SQLITE DATABASE USERS');
      console.log('═'.repeat(70));

      if (users.length === 0) {
        console.log('\n   No users found in local database\n');
      } else {
        users.forEach((user, i) => {
          console.log(`\n${i + 1}. ${user.email}`);
          console.log(`   ├─ Verified: ${user.verified === 1 ? '✅ Yes' : '❌ No'}`);
          console.log(`   ├─ Created: ${new Date(user.created_at * 1000).toLocaleString()}`);
          console.log(`   ├─ Last Login: ${user.last_login ? new Date(user.last_login * 1000).toLocaleString() : 'Never'}`);
          if (user.verification_code) {
            console.log(`   └─ Verification Code: ${user.verification_code} (expires: ${new Date(user.verification_expires * 1000).toLocaleString()})`);
          }
        });
        console.log('');
      }

      // Get verification codes
      const codesStmt = db.prepare('SELECT * FROM verification_codes');
      const codes = [];
      while (codesStmt.step()) {
        codes.push(codesStmt.getAsObject());
      }
      codesStmt.free();

      if (codes.length > 0) {
        console.log('═'.repeat(70));
        console.log('🔑 VERIFICATION CODES TABLE');
        console.log('═'.repeat(70));
        codes.forEach((code, i) => {
          console.log(`\n${i + 1}. UID: ${code.uid}`);
          console.log(`   ├─ Code: ${code.code}`);
          console.log(`   ├─ Verified: ${code.verified === 1 ? '✅ Yes' : '❌ No'}`);
          console.log(`   └─ Expires: ${new Date(code.expires_at * 1000).toLocaleString()}`);
        });
        console.log('');
      }

      db.close();
    }

    console.log('═'.repeat(70));
    console.log('🔥 FIREBASE USERS (Cloud)');
    console.log('═'.repeat(70));
    console.log('\nFirebase stores users separately in the cloud.');
    console.log('To view Firebase users:');
    console.log('  1. Go to: https://console.firebase.google.com/');
    console.log('  2. Select project: forti--desktop');
    console.log('  3. Click "Authentication" → "Users" tab');
    console.log('\nNote: Firebase users may not appear in local database.');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

listAllUsers();
