// Polling-Endpoint für Background-Job-Ergebnisse aus Blob-Store 'ai-jobs'

let blobsModule;
try { blobsModule = require('@netlify/blobs'); }
catch (e) { console.error('@netlify/blobs nicht verfügbar:', e.message); }

exports.handler = async (event) => {
  const jobId = event.queryStringParameters?.id;
  if (!jobId) return json({ error: 'id required' }, 400);
  if (!blobsModule) return json({ error: 'Blobs nicht verfügbar' }, 500);

  try {
    const store = blobsModule.getStore({ name: 'ai-jobs', consistency: 'strong' });
    const job = await store.get(jobId, { type: 'json' });
    if (!job) return json({ status: 'pending', message: 'Job läuft oder noch nicht angekommen' });
    return json(job);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}
