// Frontend-Config: teilt mit, welche optionalen Datenquellen via ENV
// konfiguriert sind. Wird beim Start von app.js gefetcht.
// WICHTIG: gibt KEINE Secrets zurück - nur Booleans/öffentliche IDs.

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},
    body: JSON.stringify({
      // Sentinel-Hub: Instance-ID ist öffentlich (per Definition WMS-Endpoint)
      sentinelInstanceId: process.env.SENTINEL_INSTANCE_ID || null,
      // Default-Endpoint = CDSE (neue Copernicus Data Space Ecosystem)
      // Override per ENV möglich falls Legacy-Sentinel-Hub genutzt wird.
      sentinelEndpoint: process.env.SENTINEL_ENDPOINT
        || 'https://sh.dataspace.copernicus.eu/ogc/wms',
      // Falls Instance OAuth-protected ist, gibt token-Function token zurück
      sentinelNeedsOauth: !!process.env.CDSE_CLIENT_ID,
      hasFirmsKey: !!process.env.NASA_FIRMS_KEY,
      hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
    })
  };
};

