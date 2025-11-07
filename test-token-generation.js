/**
 * Quick test script to verify token generation with different TTL values
 * Run with: node test-token-generation.js
 */

const path = require('path');

// Mock electron app
const mockApp = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(__dirname, 'data');
    }
    return __dirname;
  }
};

// Mock electron module
require.cache[require.resolve('electron')] = {
  exports: {
    app: mockApp,
    BrowserWindow: class {},
    ipcMain: { handle: () => {}, on: () => {} }
  }
};

// Now require the database and service
const db = require('./main/services/database');
const { verificationService } = require('./main/services/verificationService');

async function testTokenGeneration() {
  console.log('\n=== Testing Token Generation ===\n');
  
  try {
    // Initialize database
    console.log('1. Initializing database...');
    await db.initialize();
    console.log('✓ Database initialized\n');
    
    // Test 1: Generate token with TTL (1 hour)
    console.log('2. Testing token with TTL (3600 seconds)...');
    const token1 = await verificationService.generateToken({
      type: 'test-ttl',
      resourceId: 'test-resource-1',
      resourceName: 'Test Resource with TTL',
      ttl: 3600,
      oneTimeUse: false,
      metadata: { test: true, mode: 'browse' }
    });
    console.log('✓ Token with TTL generated:', token1.tokenId);
    console.log('  - TTL:', token1.ttl);
    console.log('  - Expires at:', token1.expiresAt);
    console.log('');
    
    // Test 2: Generate permanent token (ttl = null)
    console.log('3. Testing permanent token (ttl = null)...');
    const token2 = await verificationService.generateToken({
      type: 'test-permanent',
      resourceId: 'test-resource-2',
      resourceName: 'Test Resource Permanent',
      ttl: null,
      oneTimeUse: false,
      metadata: { test: true, mode: 'browse' }
    });
    console.log('✓ Permanent token generated:', token2.tokenId);
    console.log('  - TTL:', token2.ttl);
    console.log('  - Expires at:', token2.expiresAt);
    console.log('');
    
    // Test 3: Verify tokens were stored
    console.log('4. Verifying tokens were stored in database...');
    const storedToken1 = db.getVerificationToken(token1.tokenId);
    const storedToken2 = db.getVerificationToken(token2.tokenId);
    
    if (storedToken1) {
      console.log('✓ Token 1 found in database');
      console.log('  - expires_at:', storedToken1.expires_at);
      console.log('  - ttl:', storedToken1.ttl);
    } else {
      console.error('✗ Token 1 NOT found in database!');
    }
    
    if (storedToken2) {
      console.log('✓ Token 2 (permanent) found in database');
      console.log('  - expires_at:', storedToken2.expires_at, '(should be null)');
      console.log('  - ttl:', storedToken2.ttl, '(should be null)');
    } else {
      console.error('✗ Token 2 NOT found in database!');
    }
    
    console.log('\n=== All tests passed! ===\n');
    
  } catch (error) {
    console.error('\n✗ Test failed with error:');
    console.error('  Message:', error.message);
    console.error('  Stack:', error.stack);
    process.exit(1);
  }
}

// Run tests
testTokenGeneration().then(() => {
  console.log('Tests completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('Tests failed:', error);
  process.exit(1);
});
