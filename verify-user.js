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

    let userFound = false;
    let alreadyVerified = false;

    // Check user table (local accounts)
    const checkStmt = db.prepare('SELECT * FROM user WHERE email = ?');
    checkStmt.bind([email]);
    
    if (checkStmt.step()) {
      const user = checkStmt.getAsObject();
      userFound = true;
      console.log('\n📌 Found in user table (local account):');
      console.log('- Email:', user.email);
      console.log('- Verified:', user.verified === 1 ? 'Yes' : 'No');
      console.log('- Created at:', new Date(user.created_at * 1000).toLocaleString());
      
      if (user.verified === 1) {
        alreadyVerified = true;
      }
    }
    checkStmt.free();

    // Check verification_codes table (Firebase accounts)
    const checkVcStmt = db.prepare('SELECT * FROM verification_codes WHERE email = ?');
    checkVcStmt.bind([email]);
    
    if (checkVcStmt.step()) {
      const vc = checkVcStmt.getAsObject();
      userFound = true;
      console.log('\n📌 Found in verification_codes table (Firebase account):');
      console.log('- UID:', vc.uid);
      console.log('- Email:', vc.email);
      console.log('- Verified:', vc.verified === 1 ? 'Yes' : 'No');
      console.log('- Code:', vc.code);
      
      if (vc.verified === 1) {
        alreadyVerified = true;
      }
    }
    checkVcStmt.free();

    // Check firebase_users_cache table
    const checkFbStmt = db.prepare('SELECT * FROM firebase_users_cache WHERE email = ?');
    checkFbStmt.bind([email]);
    
    let fbUser = null;
    if (checkFbStmt.step()) {
      fbUser = checkFbStmt.getAsObject();
      userFound = true; // Also counts as user found!
      console.log('\n📌 Found in firebase_users_cache:');
      console.log('- UID:', fbUser.uid);
      console.log('- Email:', fbUser.email);
      console.log('- Email Verified:', fbUser.email_verified === 1 ? 'Yes' : 'No');
      
      if (fbUser.email_verified === 1) {
        alreadyVerified = true;
      }
    }
    checkFbStmt.free();

    if (!userFound) {
      console.error(`\n❌ User not found: ${email}`);
      console.log('\nTip: Make sure you have signed up first.');
      db.close();
      process.exit(1);
    }

    // Check if --force flag is passed
    const forceUpdate = process.argv.includes('--force');

    if (alreadyVerified && !forceUpdate) {
      console.log('\n✅ User is already verified in at least one table!');
      console.log('If you still cannot login, run with --force flag:');
      console.log(`  node verify-user.js ${email} --force`);
      db.close();
      process.exit(0);
    }
    
    if (alreadyVerified && forceUpdate) {
      console.log('\n🔧 Force updating all verification flags...');
    }

    console.log('\n🔧 Verifying user...');

    // Verify in user table (local accounts)
    const verifyStmt = db.prepare(
      'UPDATE user SET verified = 1, verification_code = NULL, verification_expires = NULL WHERE email = ?'
    );
    verifyStmt.bind([email]);
    verifyStmt.step();
    verifyStmt.free();
    console.log('✓ Updated user table');

    // If user exists in firebase_users_cache but not in verification_codes, create the entry
    if (fbUser) {
      // Check if verification_codes entry exists
      const checkVcExists = db.prepare('SELECT uid FROM verification_codes WHERE email = ?');
      checkVcExists.bind([email]);
      const vcExists = checkVcExists.step();
      checkVcExists.free();
      
      if (!vcExists) {
        // Create verification_codes entry
        const insertVc = db.prepare(
          'INSERT INTO verification_codes (uid, email, code, expires_at, verified) VALUES (?, ?, ?, ?, 1)'
        );
        insertVc.bind([fbUser.uid, email, '000000', Math.floor(Date.now() / 1000)]);
        insertVc.step();
        insertVc.free();
        console.log('✓ Created verification_codes entry (was missing)');
      }
    }

    // Verify in verification_codes table (Firebase accounts)
    const verifyVcStmt = db.prepare('UPDATE verification_codes SET verified = 1 WHERE email = ?');
    verifyVcStmt.bind([email]);
    verifyVcStmt.step();
    verifyVcStmt.free();
    console.log('✓ Updated verification_codes table');

    // Update firebase_users_cache email_verified flag
    const verifyFbStmt = db.prepare('UPDATE firebase_users_cache SET email_verified = 1 WHERE email = ?');
    verifyFbStmt.bind([email]);
    verifyFbStmt.step();
    verifyFbStmt.free();
    console.log('✓ Updated firebase_users_cache table');

    // Save database
    const data = db.export();
    const newBuffer = Buffer.from(data);
    fs.writeFileSync(dbPath, newBuffer);

    console.log('\n✅ User successfully verified!');
    console.log('🎉 You can now log in with this account.');
    console.log('\n⚠️  Make sure to RESTART the app before logging in.');
    
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
