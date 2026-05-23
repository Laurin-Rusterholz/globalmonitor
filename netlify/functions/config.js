// Frontend-Config: teilt mit, welche optionalen Datenquellen via ENV
// konfiguriert sind. Wird beim Start von app.js gefetcht.

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},
    body: JSON.stringify({
      sentinelInstanceId: process.env.SENTINEL_INSTANCE_ID || null,
      sentinelEndpoint: process.env.SENTINEL_ENDPOINT || 'https://services.sentinel-hub.com/ogc/wms',
      hasFirmsKey: !!process.env.NASA_FIRMS_KEY,
      hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
    })
  };
};
