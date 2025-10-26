/**
 * Manual User Verification Tool
 * Run this script to manually verify a user account in local development
 * 
 * Usage: node verify-user.js <email>
 * Example: node verify-user.js gabrielgarrate8@gmail.com
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function verifyUser(email) {
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

    // Check if user exists
    const checkStmt = db.prepare('SELECT * FROM user WHERE email = ?');
    checkStmt.bind([email]);
    
    if (!checkStmt.step()) {
      console.error(`User not found: ${email}`);
      checkStmt.free();
      process.exit(1);
    }
    
    const user = checkStmt.getAsObject();
    checkStmt.free();
    
    console.log('\nUser found:');
    console.log('- Email:', user.email);
    console.log('- Verified:', user.verified === 1 ? 'Yes' : 'No');
    console.log('- Created at:', new Date(user.created_at * 1000).toLocaleString());

    if (user.verified === 1) {
      console.log('\n✓ User is already verified!');
      process.exit(0);
    }

    // Verify the user
    const verifyStmt = db.prepare(
      'UPDATE user SET verified = 1, verification_code = NULL, verification_expires = NULL WHERE email = ?'
    );
    verifyStmt.bind([email]);
    verifyStmt.step();
    verifyStmt.free();

    // Save database
    const data = db.export();
    const newBuffer = Buffer.from(data);
    fs.writeFileSync(dbPath, newBuffer);

    console.log('\n✓ User successfully verified!');
    console.log('You can now log in with this account.');
    
    db.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Get email from command line arguments
const email = process.argv[2];

if (!email) {
  console.error('Usage: node verify-user.js <email>');
  console.error('Example: node verify-user.js user@example.com');
  process.exit(1);
}

verifyUser(email);
