const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function viewDatabase() {
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

    // Get all tables
    const tables = db.exec(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `);

    if (tables.length > 0 && tables[0].values.length > 0) {
      console.log('📋 TABLES IN DATABASE:');
      tables[0].values.forEach(([tableName]) => {
        console.log(`   - ${tableName}`);
      });
      console.log('');
      console.log('='.repeat(80));

      // Show data from each table
      for (const [tableName] of tables[0].values) {
        if (tableName === 'sqlite_sequence') continue;

        console.log(`\n📊 TABLE: ${tableName.toUpperCase()}`);
        console.log('-'.repeat(80));

        const result = db.exec(`SELECT * FROM ${tableName}`);
        
        if (result.length > 0 && result[0].values.length > 0) {
          const columns = result[0].columns;
          const values = result[0].values;

          console.log(`   Columns: ${columns.join(', ')}`);
          console.log(`   Row count: ${values.length}`);
          console.log('');

          // Display first 5 rows
          const displayCount = Math.min(5, values.length);
          for (let i = 0; i < displayCount; i++) {
            console.log(`   Row ${i + 1}:`);
            columns.forEach((col, idx) => {
              let value = values[i][idx];
              // Format timestamps
              if (col.includes('_at') || col.includes('expires') || col.includes('login')) {
                if (value && typeof value === 'number') {
                  value = `${value} (${new Date(value * 1000).toLocaleString()})`;
                }
              }
              console.log(`      ${col}: ${value}`);
            });
            console.log('');
          }

          if (values.length > 5) {
            console.log(`   ... and ${values.length - 5} more row(s)\n`);
          }
        } else {
          console.log('   ⚠️  Table is empty\n');
        }
      }
    } else {
      console.log('⚠️  No tables found in database');
    }

    console.log('='.repeat(80));
    db.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

viewDatabase();
