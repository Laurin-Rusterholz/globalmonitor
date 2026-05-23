// Netlify-Blobs-basierter Notiz-Speicher pro Land
// Storage-Struktur: Store "country-notes", Keys "ISO/timestamp_id"

let blobsModule, blobsImportError;
try { blobsModule = require('@netlify/blobs'); }
catch (e) {
  blobsImportError = e.message;
  console.error('@netlify/blobs nicht verfügbar:', e.message);
}

function getNotesStore() {
  if (!blobsModule) throw new Error('Netlify Blobs Package nicht installiert: ' + (blobsImportError||'?'));
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  try {
    if (siteID && token) {
      return blobsModule.getStore({ name: 'country-notes', consistency: 'strong', siteID, token });
    }
    return blobsModule.getStore({ name: 'country-notes', consistency: 'strong' });
  } catch (e) {
    if (siteID && token) {
      return blobsModule.getStore({ name: 'country-notes', consistency: 'strong', siteID, token });
    }
    throw e;
  }
}

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  const method = event.httpMethod;
  const qs = event.queryStringParameters || {};
  let store;
  try { store = getNotesStore(); }
  catch (storeErr) {
    console.warn('Notes store init fail:', storeErr.message);
    // GET → leere Liste, damit Client localStorage-Fallback nutzt
    if (method === 'GET') return json({ notes: [], blobsUnavailable: true, hint: storeErr.message });
    return json({ error: storeErr.message, blobsUnavailable: true }, 500);
  }
  try {

    if (method === 'GET') {
      const iso = (qs.iso || '').toUpperCase();
      if (qs.id) {
        const note = await store.get(qs.id, { type: 'json' });
        if (!note) return json({ error: 'not found' }, 404);
        return json(note);
      }
      // List für Land
      const prefix = iso ? `${iso}/` : '';
      let blobs = [];
      try {
        const result = await store.list({ prefix });
        blobs = result?.blobs || [];
      } catch (e) {
        console.warn('notes list fail:', e.message);
        return json({ notes: [] });
      }
      const notes = await Promise.all(
        blobs.map(async (b) => {
          try {
            const n = await store.get(b.key, { type: 'json' });
            return n ? { id: b.key, ...n } : null;
          } catch { return null; }
        })
      );
      return json({
        notes: notes
          .filter(Boolean)
          .sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0)),
      });
    }

    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const iso = (body.iso || '').toUpperCase();
      if (!iso || !body.title) return json({ error: 'iso + title required' }, 400);
      const id = `${iso}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const note = {
        iso,
        title: String(body.title).slice(0, 200),
        content: String(body.content || ''),
        type: body.type || 'manual',
        tags: body.tags || [],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      if (typeof body.la === 'number') note.la = body.la;
      if (typeof body.lo === 'number') note.lo = body.lo;
      await store.setJSON(id, note);
      return json({ id, ...note });
    }

    if (method === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      if (!body.id) return json({ error: 'id required' }, 400);
      const existing = await store.get(body.id, { type: 'json' });
      if (!existing) return json({ error: 'not found' }, 404);
      const updated = {
        ...existing,
        title: body.title !== undefined ? String(body.title).slice(0, 200) : existing.title,
        content: body.content !== undefined ? String(body.content) : existing.content,
        tags: body.tags !== undefined ? body.tags : existing.tags,
        updated: new Date().toISOString(),
      };
      await store.setJSON(body.id, updated);
      return json({ id: body.id, ...updated });
    }

    if (method === 'DELETE') {
      const id = qs.id;
      if (!id) return json({ error: 'id required' }, 400);
      await store.delete(id);
      return json({ deleted: id });
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
    console.error('Notes-Function:', e);
    return json({ error: e.message }, 500);
  }
};
