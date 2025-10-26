/**
 * Database User Management Script
 * Run this script to manage users in the database
 * Usage: node manage-users.js [command] [email]
 * 
 * Commands:
 *   list                - List all users
 *   delete <email>      - Delete a specific user
 *   verify <email>      - Manually verify a user's email
 *   clear               - Delete all users (use with caution!)
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Get database path
function getDbPath() {
  const userDataPath = path.join(
    os.homedir(),
    'AppData',
    'Roaming',
    'fortimorph-desktop'
  );
  return path.join(userDataPath, 'fortimorph.db');
}

async function listUsers(db) {
  const users = db.exec('SELECT id, email, verified, created_at, last_login FROM user');
  
  if (users.length === 0 || users[0].values.length === 0) {
    console.log('📭 No users found in the database.');
    return;
  }

  console.log('='.repeat(80));
  console.log('👥 REGISTERED USERS');
  console.log('='.repeat(80));
  console.log('');

  users[0].values.forEach((row, index) => {
    console.log(`User #${index + 1}:`);
    console.log('  ID:', row[0]);
    console.log('  Email:', row[1]);
    console.log('  Verified:', row[2] ? '✅ Yes' : '❌ No');
    console.log('  Created:', row[3] ? new Date(row[3] * 1000).toLocaleString() : 'N/A');
    console.log('  Last Login:', row[4] ? new Date(row[4] * 1000).toLocaleString() : 'Never');
    console.log('');
  });

  console.log('='.repeat(80));
  console.log(`Total users: ${users[0].values.length}`);
  console.log('='.repeat(80));
}

async function deleteUser(db, dbPath, email) {
  const stmt = db.prepare('DELETE FROM user WHERE email = ?');
  stmt.bind([email]);
  stmt.step();
  stmt.free();
  
  // Save database
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
  
  console.log(`✅ User '${email}' has been deleted.`);
}

async function verifyUser(db, dbPath, email) {
  const stmt = db.prepare('UPDATE user SET verified = 1, verification_code = NULL, verification_expires = NULL WHERE email = ?');
  stmt.bind([email]);
  stmt.step();
  stmt.free();
  
  // Save database
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
  
  console.log(`✅ User '${email}' has been manually verified.`);
}

async function clearAllUsers(db, dbPath) {
  db.exec('DELETE FROM user');
  
  // Save database
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
  
  console.log('✅ All users have been deleted.');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const email = args[1];

  const dbPath = getDbPath();
  
  if (!fs.existsSync(dbPath)) {
    console.log('❌ Database not found!');
    console.log('Path:', dbPath);
    console.log('The app may not have been run yet.');
    return;
  }

  try {
    // Initialize SQL.js and load database
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    switch (command) {
      case 'list':
        await listUsers(db);
        break;
        
      case 'delete':
        if (!email) {
          console.log('❌ Please provide an email address.');
          console.log('Usage: node manage-users.js delete <email>');
        } else {
          await deleteUser(db, dbPath, email);
        }
        break;
        
      case 'verify':
        if (!email) {
          console.log('❌ Please provide an email address.');
          console.log('Usage: node manage-users.js verify <email>');
        } else {
          await verifyUser(db, dbPath, email);
        }
        break;
        
      case 'clear':
        console.log('⚠️  WARNING: This will delete ALL users!');
        console.log('Are you sure? Run: node manage-users.js clear-confirmed');
        break;
        
      case 'clear-confirmed':
        await clearAllUsers(db, dbPath);
        break;
        
      default:
        console.log('FortiMorph Database User Management');
        console.log('');
        console.log('Usage:');
        console.log('  node manage-users.js list                - List all users');
        console.log('  node manage-users.js delete <email>      - Delete a user');
        console.log('  node manage-users.js verify <email>      - Manually verify a user');
        console.log('  node manage-users.js clear               - Delete all users (with confirmation)');
        console.log('');
        console.log('Database location:', dbPath);
    }

    db.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main();
