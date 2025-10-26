/**
 * Database User Viewer
 * Run this script to view all registered users in the database
 * Usage: node view-users.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function viewUsers() {
  try {
    // Determine the database path (same as in the app)
    const userDataPath = path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'fortimorph-desktop'
    );
    const dbPath = path.join(userDataPath, 'fortimorph.db');

    console.log('Database path:', dbPath);
    console.log('');

    // Check if database exists
    if (!fs.existsSync(dbPath)) {
      console.log('❌ Database not found!');
      console.log('The app may not have been run yet, or no users have been created.');
      return;
    }

    // Initialize SQL.js
    const SQL = await initSqlJs();

    // Load database
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    // Check for local mode users (in user table)
    const users = db.exec('SELECT id, email, verified, created_at, last_login FROM user');
    
    console.log('='.repeat(80));
    console.log('� DATABASE CONTENTS');
    console.log('='.repeat(80));
    console.log('');

    // LOCAL MODE USERS
    console.log('🏠 LOCAL MODE USERS (user table):');
    console.log('-'.repeat(80));
    if (users.length === 0 || users[0].values.length === 0) {
      console.log('  No local users found.');
    } else {
      users[0].values.forEach((row, index) => {
        console.log(`  User #${index + 1}:`);
        console.log('    ID:', row[0]);
        console.log('    Email:', row[1]);
        console.log('    Verified:', row[2] ? '✅ Yes' : '❌ No');
        console.log('    Created:', row[3] ? new Date(row[3] * 1000).toLocaleString() : 'N/A');
        console.log('    Last Login:', row[4] ? new Date(row[4] * 1000).toLocaleString() : 'Never');
        console.log('');
      });
      console.log(`  Total local users: ${users[0].values.length}`);
    }
    
    console.log('');
    
    // FIREBASE MODE USERS (verification_codes table)
    console.log('🔥 FIREBASE MODE USERS (verification_codes table):');
    console.log('-'.repeat(80));
    const firebaseUsers = db.exec('SELECT uid, code, expires_at, verified, created_at FROM verification_codes');
    
    if (firebaseUsers.length === 0 || firebaseUsers[0].values.length === 0) {
      console.log('  No Firebase users found.');
    } else {
      firebaseUsers[0].values.forEach((row, index) => {
        const uid = row[0];
        const code = row[1];
        const expires = row[2];
        const verified = row[3];
        const created = row[4];
        const now = Math.floor(Date.now() / 1000);
        const isExpired = expires && expires < now;
        
        console.log(`  User #${index + 1}:`);
        console.log('    Firebase UID:', uid);
        console.log('    Verified:', verified ? '✅ Yes' : '❌ No');
        if (code && !verified) {
          console.log('    Verification Code:', code);
          console.log('    Code Status:', isExpired ? '❌ Expired' : '✅ Valid');
          if (!isExpired && expires) {
            const minutesLeft = Math.floor((expires - now) / 60);
            console.log('    Expires in:', minutesLeft > 0 ? `${minutesLeft} minutes` : 'less than a minute');
          }
        }
        console.log('    Created:', created ? new Date(created * 1000).toLocaleString() : 'N/A');
        console.log('');
      });
      console.log(`  Total Firebase users: ${firebaseUsers[0].values.length}`);
    }

    console.log('='.repeat(80));
    
    // Get pending verification codes from user table
    const codes = db.exec('SELECT email, verification_code, verification_expires FROM user WHERE verification_code IS NOT NULL');
    
    if (codes.length > 0 && codes[0].values.length > 0) {
      console.log('');
      console.log('🔑 PENDING VERIFICATION CODES (Local Mode):');
      console.log('-'.repeat(80));
      codes[0].values.forEach((row) => {
        const email = row[0];
        const code = row[1];
        const expires = row[2];
        const now = Math.floor(Date.now() / 1000);
        const isExpired = expires < now;
        
        console.log(`  Email: ${email}`);
        console.log(`  Code: ${code}`);
        console.log(`  Status: ${isExpired ? '❌ Expired' : '✅ Valid'}`);
        if (!isExpired) {
          const minutesLeft = Math.floor((expires - now) / 60);
          console.log(`  Expires in: ${minutesLeft} minutes`);
        }
        console.log('');
      });
      console.log('='.repeat(80));
    }

    db.close();
  } catch (error) {
    console.error('❌ Error reading database:', error.message);
  }
}

viewUsers();
