require('dotenv').config();
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db('receipts-dev');
  const rep = await db.collection('reps').findOne({ name: 'Angela Johnson' });
  console.log('Found:', rep ? 'yes' : 'no');
  if (rep) {
    console.log('Has hash:', !!rep.passwordHash);
    console.log('mustChange:', rep.mustChangePassword);
    console.log('active:', rep.active);
  }
  await client.close();
});
