// Polling-Endpoint für Background-Job-Ergebnisse aus Blob-Store 'ai-jobs'

let blobsModule;
try { blobsModule = require('@netlify/blobs'); }
catch (e) { console.error('@netlify/blobs nicht verfügbar:', e.message); }

function getStoreSafe(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return blobsModule.getStore({ name, siteID, token });
  return blobsModule.getStore(name);
}

exports.handler = async (event) => {
  const jobId = event.queryStringParameters?.id;
  if (!jobId) return json({ error: 'id required' }, 400);
  if (!blobsModule) return json({ status:'unsupported', error: 'Blobs Package nicht installiert' }, 200);

  try {
    const store = getStoreSafe('ai-jobs');
    const job = await store.get(jobId, { type: 'json' });
    if (!job) return json({ status: 'pending' });
    return json(job);
  } catch (e) {
    // Wichtig: Status 200 zurückgeben damit Client nicht spammt; aber 'unsupported' signalisieren
    return json({ status: 'unsupported', error: e.message.slice(0, 200) });
  }
};

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}
