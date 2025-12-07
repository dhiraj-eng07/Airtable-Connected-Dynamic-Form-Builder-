const { MongoClient } = require('mongodb');

// Your MongoDB Atlas connection string (with database name)
const uri = 'mongodb+srv://minecraftvillager610_db_user:99jcQvtOQWv6h3zB@cluster0.93kgjbp.mongodb.net/airtable_forms?retryWrites=true&w=majority&appName=Cluster0';

async function testConnection() {
  const client = new MongoClient(uri);
  
  console.log('Testing MongoDB Atlas connection...');
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas successfully!');
    
    // Test database operations
    const db = client.db('airtable_forms');
    
    // List collections
    const collections = await db.listCollections().toArray();
    console.log('\n📁 Collections in database:');
    
    if (collections.length === 0) {
      console.log('   No collections found. Creating test collection...');
      
      // Create a test collection
      await db.createCollection('test_connection');
      const testCollection = db.collection('test_connection');
      
      // Insert test document
      await testCollection.insertOne({
        message: 'Test connection successful',
        timestamp: new Date(),
        app: 'Airtable Form Builder'
      });
      
      console.log('✅ Test collection created and document inserted');
      
      // List collections again
      const updatedCollections = await db.listCollections().toArray();
      console.log('\n📁 Updated collections:');
      updatedCollections.forEach(col => {
        console.log(`   - ${col.name}`);
      });
      
      // Clean up
      await testCollection.drop();
      console.log('✅ Test collection cleaned up');
    } else {
      collections.forEach(col => {
        console.log(`   - ${col.name}`);
      });
    }
    
    // Test connection by running a simple command
    const pingResult = await db.command({ ping: 1 });
    console.log(`\n🏓 Database ping response: ${JSON.stringify(pingResult)}`);
    
    console.log('\n🎉 All tests passed! MongoDB Atlas is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Connection failed:', error.message);
    
    // Provide troubleshooting tips
    console.log('\n🔧 Troubleshooting tips:');
    console.log('1. Check network access in MongoDB Atlas:');
    console.log('   - Go to Network Access in MongoDB Atlas');
    console.log('   - Add IP address 0.0.0.0/0 (allow from anywhere)');
    console.log('   - Or add your current IP address');
    
    console.log('\n2. Verify database name exists:');
    console.log('   - Check if "airtable_forms" database exists');
    console.log('   - If not, create it in MongoDB Atlas');
    
    console.log('\n3. Check user permissions:');
    console.log('   - Go to Database Access in MongoDB Atlas');
    console.log('   - Verify user has read/write permissions');
    
    console.log('\n4. Connection string format:');
    console.log('   Make sure it includes:');
    console.log('   - Database name: /airtable_forms');
    console.log('   - retryWrites=true&w=majority parameters');
    
  } finally {
    await client.close();
    console.log('\n🔌 Connection closed');
  }
}

// Run the test
testConnection();