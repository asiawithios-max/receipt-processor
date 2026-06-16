require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db('receipts-dev');
  const hash = bcrypt.hashSync('IOS2025!', 10);
  const result = await db.collection('reps').updateOne(
    { name: 'Angela Johnson' },
    { $set: { passwordHash: hash, mustChangePassword: true } }
  );
  console.log('Reset:', result.modifiedCount, 'account(s)');
  await client.close();
});
