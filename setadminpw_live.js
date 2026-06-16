const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const LIVE_URI = 'mongodb+srv://receiptsadmin:D0fx2dqthqQdrVdr@cluster0.57jnmhc.mongodb.net/receipts?appName=Cluster0';
const client = new MongoClient(LIVE_URI);
client.connect().then(async () => {
  const db = client.db('receipts');
  const col = db.collection('admin_passwords');
  await col.updateOne(
    { id: 'superadmin-1' },
    { $set: { id: 'superadmin-1', name: 'Asia Mims-Johnson', passwordHash: bcrypt.hashSync('26IOSAsia', 10) } },
    { upsert: true }
  );
  await col.updateOne(
    { id: 'superadmin-2' },
    { $set: { id: 'superadmin-2', name: 'Donovan Johnson', passwordHash: bcrypt.hashSync('26IOSDonovan', 10) } },
    { upsert: true }
  );
  console.log('Live passwords set for both super admins');
  await client.close();
});
