// Recherche-Projekte: persistente Projektablage in Netlify Blobs
// Storage: Store "research-projects", Keys "projectId"
// Pro Projekt: Name, These, Länder, Events, Notizen, Status, Daten

const { getStore } = require('@netlify/blobs');

function projStore() {
  return getStore({ name: 'research-projects', consistency: 'strong' });
}
function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  try {
    const store = projStore();
    const method = event.httpMethod;
    const qs = event.queryStringParameters || {};

    if (method === 'GET') {
      if (qs.id) {
        const p = await store.get(qs.id, { type: 'json' });
        if (!p) return json({ error: 'not found' }, 404);
        return json(p);
      }
      // List
      const { blobs } = await store.list();
      const projects = await Promise.all(
        blobs.map(async (b) => {
          const p = await store.get(b.key, { type: 'json' });
          return p ? { id: b.key, ...p } : null;
        })
      );
      return json({
        projects: projects
          .filter(Boolean)
          .sort((a, b) => new Date(b.updated) - new Date(a.updated)),
      });
    }

    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (!body.name) return json({ error: 'name required' }, 400);
      const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const project = {
        id,
        name: String(body.name).slice(0, 200),
        thesis: String(body.thesis || '').slice(0, 2000),
        countries: Array.isArray(body.countries) ? body.countries.map(c => String(c).toUpperCase()).slice(0, 50) : [],
        events: Array.isArray(body.events) ? body.events.slice(0, 50) : [],
        countryNotes: body.countryNotes || {}, // {iso: [{title, content, created}]}
        actors: body.actors || [],
        chatHistory: body.chatHistory || [],
        relatedCountries: body.relatedCountries || [], // AI-generierte Liste
        view: body.view || null, // saved map view {center, zoom}
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      await store.setJSON(id, project);
      return json(project);
    }

    if (method === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      if (!body.id) return json({ error: 'id required' }, 400);
      const existing = await store.get(body.id, { type: 'json' });
      if (!existing) return json({ error: 'not found' }, 404);
      const updated = {
        ...existing,
        ...body,
        id: existing.id, // never change
        created: existing.created,
        updated: new Date().toISOString(),
      };
      await store.setJSON(body.id, updated);
      return json(updated);
    }

    if (method === 'DELETE') {
      if (!qs.id) return json({ error: 'id required' }, 400);
      await store.delete(qs.id);
      return json({ deleted: qs.id });
    }

    if (method === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: '',
      };
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    console.error('projects fn:', e);
    return json({ error: e.message }, 500);
  }
};
