require('dotenv').config();
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db('receipts-dev');
  const col = db.collection('submissions');
  const result = await col.updateMany(
    { signatureStatus: { $in: [null, '', 'unsigned', undefined] } },
    { $set: { signatureStatus: 'unsent' } }
  );
  console.log('Fixed:', result.modifiedCount, 'submissions');
  await client.close();
});
