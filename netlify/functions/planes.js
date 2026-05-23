exports.handler = async (event) => {
  const { lamin, lomin, lamax, lomax } = event.queryStringParameters || {};
  try {
    const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    const res = await fetch(url);
    const data = await res.json();
    return { statusCode:200, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) };
  } catch (e) {
    return { statusCode:200, headers:{'Content-Type':'application/json'}, body:JSON.stringify({ states:[], error:e.message }) };
  }
};
