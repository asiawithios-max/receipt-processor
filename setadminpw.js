require('dotenv').config();
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db('receipts-dev');
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
  console.log('Passwords set for both super admins');
  await client.close();
});
