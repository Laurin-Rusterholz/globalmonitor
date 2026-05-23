// Netlify-Blobs-basierter Notiz-Speicher pro Land
// Storage-Struktur: Store "country-notes", Keys "ISO/timestamp_id"

const { getStore } = require('@netlify/blobs');

function getNotesStore() {
  return getStore({ name: 'country-notes', consistency: 'strong' });
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
    const store = getNotesStore();
    const method = event.httpMethod;
    const qs = event.queryStringParameters || {};

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
