require('dotenv').config(); // env
const path = require('path');
const Fastify = require('fastify');
const fastifyView = require('@fastify/view');
const fastifyStatic = require('@fastify/static');
const fastifyMongo = require('@fastify/mongodb');
const { Server: SocketIOServer } = require('socket.io');

const build = async () => {
  const app = Fastify({ logger: true });

  // MongoDB
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/notes_app';
  await app.register(fastifyMongo, {
    forceClose: true,
    url: mongoUrl,
  });

  // Views
  await app.register(fastifyView, {
    engine: { ejs: require('ejs') },
    root: path.join(__dirname, 'views'),
    viewExt: 'ejs',
  });

  // Static
  await app.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/public/',
  });

  // JSON bodies are supported natively by Fastify

  // Socket.IO will be attached after server starts

  // Collections helper
  const getCollections = () => {
    const db = app.mongo.db;
    const notes = db.collection('notes');
    const groups = db.collection('groups');
    return { db, notes, groups };
  };

  // Serialize helpers
  const toId = (v) => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v.toHexString === 'function') return v.toHexString();
    if (v.$oid) return v.$oid;
    return String(v);
  };
  const serializeNote = (n) => ({ ...n, _id: toId(n._id), groupId: toId(n.groupId) });
  const serializeGroup = (g) => ({ ...g, _id: toId(g._id) });

  // Socket events will be configured after listen

  // Ensure indexes
  try {
    const { notes, groups } = getCollections();
    await Promise.all([
      notes.createIndex({ updatedAt: -1 }),
      notes.createIndex({ isDeleted: 1 }),
      notes.createIndex({ groupId: 1 }),
      groups.createIndex({ name: 1 }),
    ]);
  } catch (e) {
    app.log.warn({ err: e }, 'index creation failed');
  }

  // Home
  app.get('/', async (req, reply) => {
    return reply.view('index', {
      title: 'Realtime Notes',
      meta: {
        darkMode: true,
      },
    });
  });

  // API: Groups
  app.get('/api/groups', async (req, reply) => {
    const { groups } = getCollections();
    const list = await groups
      .find({}, { projection: { name: 1, color: 1 } })
      .sort({ name: 1 })
      .toArray();
    const data = list.map(serializeGroup);
    return { ok: true, data };
  });

  app.post('/api/groups', async (req, reply) => {
    const { groups } = getCollections();
    const { name, color } = req.body || {};
    if (!name) return reply.code(400).send({ ok: false, message: 'name is required' });
    const now = new Date();
    const doc = { name, color: color || '#64748b', createdAt: now, updatedAt: now };
    const res = await groups.insertOne(doc);
    const saved = { _id: res.insertedId, ...doc };
    const sg = serializeGroup(saved);
    app.io.emit('groups:changed', { type: 'created', group: sg });
    return { ok: true, data: sg };
  });

  app.patch('/api/groups/:id', async (req, reply) => {
    const { groups } = getCollections();
    const { id } = req.params;
    const { ObjectId } = app.mongo;
    let update = {};
    const { name, color } = req.body || {};
    if (name !== undefined) update.name = name;
    if (color !== undefined) update.color = color;
    if (!Object.keys(update).length) return reply.code(400).send({ ok: false, message: 'no fields' });
    update.updatedAt = new Date();
    const res = await groups.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: update }, { returnDocument: 'after' });
    if (!res.value) return reply.code(404).send({ ok: false, message: 'group not found' });
    const sg = serializeGroup(res.value);
    app.io.emit('groups:changed', { type: 'updated', group: sg });
    return { ok: true, data: sg };
  });

  app.delete('/api/groups/:id', async (req, reply) => {
    const { groups, notes } = getCollections();
    const { id } = req.params;
    const { ObjectId } = app.mongo;
    const gid = new ObjectId(id);
    const countNotes = await notes.countDocuments({ groupId: gid, isDeleted: { $ne: true } });
    if (countNotes > 0) return reply.code(400).send({ ok: false, message: 'Group has notes. Move or delete notes first.' });
    const res = await groups.findOneAndDelete({ _id: gid });
    if (!res.value) return reply.code(404).send({ ok: false, message: 'group not found' });
    app.io.emit('groups:changed', { type: 'deleted', id });
    return { ok: true };
  });

  // API: Notes
  app.get('/api/notes', async (req, reply) => {
    const { notes } = getCollections();
    const { groupId, deleted } = req.query || {};
    const { ObjectId } = app.mongo;
    const filter = {};
    if (deleted === 'true') filter.isDeleted = true; else filter.isDeleted = { $ne: true };
    if (groupId && groupId !== 'all') {
      try { filter.groupId = new ObjectId(groupId); } catch {}
    }
    const list = await notes
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();
    const data = list.map(serializeNote);
    return { ok: true, data };
  });

  app.post('/api/notes', async (req, reply) => {
    const { notes } = getCollections();
    const { ObjectId } = app.mongo;
    const { title, content, groupId } = req.body || {};
    if (!title) return reply.code(400).send({ ok: false, message: 'title is required' });
    const now = new Date();
    const doc = {
      title,
      content: content || '',
      groupId: groupId ? (() => { try { return new ObjectId(groupId); } catch { return null; } })() : null,
      isDone: false,
      isDeleted: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const res = await notes.insertOne(doc);
    const saved = { _id: res.insertedId, ...doc };
    const sn = serializeNote(saved);
    app.io.emit('notes:changed', { type: 'created', note: sn });
    return { ok: true, data: sn };
  });

  app.patch('/api/notes/:id', async (req, reply) => {
    const { notes } = getCollections();
    const { id } = req.params;
    const { ObjectId } = app.mongo;
    const { title, content, isDone, groupId } = req.body || {};
    const update = {};
    if (title !== undefined) update.title = title;
    if (content !== undefined) update.content = content;
    if (isDone !== undefined) update.isDone = !!isDone;
    if (groupId !== undefined) {
      update.groupId = groupId ? (() => { try { return new ObjectId(groupId); } catch { return null; } })() : null;
    }
    if (!Object.keys(update).length) return reply.code(400).send({ ok: false, message: 'no fields' });
    update.updatedAt = new Date();
    const res = await notes.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: update }, { returnDocument: 'after' });
    if (!res.value) return reply.code(404).send({ ok: false, message: 'note not found' });
    const sn = serializeNote(res.value);
    app.io.emit('notes:changed', { type: 'updated', note: sn });
    return { ok: true, data: sn };
  });

  // Soft delete
  app.delete('/api/notes/:id', async (req, reply) => {
    const { notes } = getCollections();
    const { id } = req.params;
    const { ObjectId } = app.mongo;
    const now = new Date();
    const res = await notes.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { isDeleted: true, deletedAt: now, updatedAt: now } },
      { returnDocument: 'after' }
    );
    if (!res.value) return reply.code(404).send({ ok: false, message: 'note not found' });
    app.io.emit('notes:changed', { type: 'soft-deleted', id });
    return { ok: true };
  });

  // Restore
  app.post('/api/notes/:id/restore', async (req, reply) => {
    const { notes } = getCollections();
    const { id } = req.params;
    const { ObjectId } = app.mongo;
    const res = await notes.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { isDeleted: false, deletedAt: null, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!res.value) return reply.code(404).send({ ok: false, message: 'note not found' });
    const sn = serializeNote(res.value);
    app.io.emit('notes:changed', { type: 'restored', note: sn });
    return { ok: true };
  });

  // Permanent delete
  app.delete('/api/notes/:id/permanent', async (req, reply) => {
    const { notes } = getCollections();
    const { id } = req.params;
    const { ObjectId } = app.mongo;
    const res = await notes.findOneAndDelete({ _id: new ObjectId(id) });
    if (!res.value) return reply.code(404).send({ ok: false, message: 'note not found' });
    app.io.emit('notes:changed', { type: 'permanently-deleted', id });
    return { ok: true };
  });

  // Batch ops
  app.post('/api/notes/batch', async (req, reply) => {
    const { notes } = getCollections();
    const { ObjectId } = app.mongo;
    const { action, ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ ok: false, message: 'ids required' });
    const _ids = ids.map((i) => {
      try { return new ObjectId(i); } catch { return null; }
    }).filter(Boolean);

    let res;
    const now = new Date();
    switch (action) {
      case 'soft-delete':
        res = await notes.updateMany({ _id: { $in: _ids } }, { $set: { isDeleted: true, deletedAt: now, updatedAt: now } });
        app.io.emit('notes:changed', { type: 'soft-deleted-batch', ids });
        break;
      case 'restore':
        res = await notes.updateMany({ _id: { $in: _ids } }, { $set: { isDeleted: false, deletedAt: null, updatedAt: now } });
        app.io.emit('notes:changed', { type: 'restored-batch', ids });
        break;
      case 'permanent-delete':
        res = await notes.deleteMany({ _id: { $in: _ids } });
        app.io.emit('notes:changed', { type: 'permanently-deleted-batch', ids });
        break;
      case 'mark-done':
        res = await notes.updateMany({ _id: { $in: _ids } }, { $set: { isDone: true, updatedAt: now } });
        app.io.emit('notes:changed', { type: 'updated-batch', ids, patch: { isDone: true } });
        break;
      case 'mark-undone':
        res = await notes.updateMany({ _id: { $in: _ids } }, { $set: { isDone: false, updatedAt: now } });
        app.io.emit('notes:changed', { type: 'updated-batch', ids, patch: { isDone: false } });
        break;
      default:
        return reply.code(400).send({ ok: false, message: 'unknown action' });
    }
    return { ok: true };
  });

  const port = process.env.PORT || 3000;
  await app.listen({ port, host: '0.0.0.0' });

  // Attach Socket.IO directly to Fastify's underlying server
  const io = new SocketIOServer(app.server, {
    cors: { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  });
  app.io = io;
  io.on('connection', (socket) => {
    app.log.info('Socket connected: ' + socket.id);
  });

  return app;
};

build().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
