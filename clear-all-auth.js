/**
 * Clear All Authentication Data
 * This script clears BOTH local SQLite database users AND shows Firebase deletion instructions
 * 
 * Usage: node clear-all-auth.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function clearAllAuth() {
  try {
    // Get the database path
    const appDataPath = path.join(
      process.env.APPDATA || 
      (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : 
       path.join(os.homedir(), '.config')),
      'fortimorph-desktop'
    );
    const dbPath = path.join(appDataPath, 'fortimorph.db');

    console.log('🗄️  Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
      console.log('❌ No local database found');
    } else {
      // Load database
      const SQL = await initSqlJs();
      const buffer = fs.readFileSync(dbPath);
      const db = new SQL.Database(buffer);

      // Get all users before deleting
      const usersStmt = db.prepare('SELECT email, verified FROM user');
      const users = [];
      while (usersStmt.step()) {
        users.push(usersStmt.getAsObject());
      }
      usersStmt.free();

      if (users.length === 0) {
        console.log('✓ No users in local database');
      } else {
        console.log('\n📋 Users in LOCAL SQLite database:');
        users.forEach((user, i) => {
          console.log(`   ${i + 1}. ${user.email} (Verified: ${user.verified === 1 ? 'Yes' : 'No'})`);
        });

        // Delete all users
        db.exec('DELETE FROM user');
        db.exec('DELETE FROM verification_codes');

        // Save database
        const data = db.export();
        const newBuffer = Buffer.from(data);
        fs.writeFileSync(dbPath, newBuffer);

        console.log('\n✅ All local users deleted from SQLite database!');
      }

      db.close();
    }

    // Firebase instructions
    console.log('\n' + '='.repeat(60));
    console.log('🔥 FIREBASE USERS (Cloud Storage)');
    console.log('='.repeat(60));
    console.log('\nTo delete Firebase users, you have 3 options:\n');
    console.log('Option 1 - Firebase Console (Recommended):');
    console.log('  1. Go to: https://console.firebase.google.com/');
    console.log('  2. Select your project: forti--desktop');
    console.log('  3. Click "Authentication" in the left menu');
    console.log('  4. Click "Users" tab');
    console.log('  5. Select users and delete them\n');
    
    console.log('Option 2 - Use Firebase Admin SDK (Advanced):');
    console.log('  Requires service account key and admin privileges\n');
    
    console.log('Option 3 - Disable Firebase temporarily:');
    console.log('  1. Rename .env file to .env.backup');
    console.log('  2. App will use local-only mode');
    console.log('  3. Rename back when you want Firebase again\n');

    console.log('='.repeat(60));
    console.log('\n✨ Local cleanup complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

clearAllAuth();
