require('dotenv').config();
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db('receipts-dev');
  const hash = bcrypt.hashSync('IOS2025!', 10);
  await db.collection('reps').updateMany(
    { name: { $in: ['Angela Johnson', 'Randy Gohn'] } },
    { $set: { passwordHash: hash, mustChangePassword: true } }
  );
  console.log('Reset done');
  await client.close();
});
