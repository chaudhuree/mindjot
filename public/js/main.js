// Main frontend logic for Realtime Notes
// Using Socket.IO, Fetch API, and Tailwind CDN utilities

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  groups: [],
  notes: [],
  filter: 'all', // 'all' | 'ungrouped' | 'deleted' | <groupId>
  search: '',
  selected: new Set(),
  firstLoadDone: false,
};

const els = {
  pageLoader: $('#page-loader'),
  notesContainer: $('#notes-container'),
  skeletonTpl: $('#skeleton-card'),
  selectAll: $('#select-all'),
  toolbar: $('#toolbar-actions'),
  search: $('#search'),
  groupList: $('#group-list'),
  filters: $('#filters'),
  addGroup: $('#add-group'),
  noteTitle: $('#note-title'),
  noteGroup: $('#note-group'),
  editor: $('#editor'),
  createNote: $('#create-note'),
  themeToggle: $('#theme-toggle'),
  themeToggleM: $('#theme-toggle-m'),
  mobileMenu: $('#mobile-menu'),
  sidebar: $('#sidebar'),
  editModal: $('#edit-modal'),
  editTitle: $('#edit-title'),
  editGroup: $('#edit-group'),
  editEditor: $('#edit-editor'),
  editSave: $('#edit-save'),
};

// Theme
function setTheme(mode) {
  try {
    localStorage.setItem('theme', mode);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = mode === 'dark' || (mode === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
  } catch {}
}

function toggleTheme() {
  const cur = localStorage.getItem('theme') || 'system';
  const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
  setTheme(next);
}

els.themeToggle?.addEventListener('click', toggleTheme);
els.themeToggleM?.addEventListener('click', toggleTheme);

els.mobileMenu?.addEventListener('click', () => {
  els.sidebar?.classList.toggle('hidden');
});

// Rich text controls
$$('[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.getAttribute('data-cmd');
    document.execCommand(cmd, false, null);
    els.editor.focus();
  });
});

$$('[data-editcmd]').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.getAttribute('data-editcmd');
    document.execCommand(cmd, false, null);
    els.editEditor.focus();
  });
});
// API helper
async function api(path, opts = {}) {
  const hasBody = opts.body !== undefined && opts.body !== null;
  const jsonHeaders = hasBody ? { 'Content-Type': 'application/json' } : {};
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...jsonHeaders },
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Socket
function connectSocket() {
  if (!window.io) {
    console.warn('socket.io client not yet loaded, retrying...');
    setTimeout(connectSocket, 500);
    return;
  }
  let socketConnected = false;
  const socket = window.io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
  });
  // expose globally for other handlers to emit
  window.__socket = socket;
  window.__emitNotesChanged = function(payload) {
    try {
      const p = payload || { type: 'client' };
      if (socket.connected) {
        console.log('emit now client:notes:changed', p);
        socket.emit('client:notes:changed', p);
      } else {
        console.log('queue emit until connect', p);
        socket.once('connect', () => {
          console.log('connected; flushing queued emit', p);
          socket.emit('client:notes:changed', p);
        });
      }
    } catch (e) { console.warn('emit error', e); }
  };
  socket.on('connect', () => {
    socketConnected = true;
    console.log('socket connected');
  });
  socket.on('disconnect', (r) => {
    socketConnected = false;
    console.log('socket disconnected:', r);
  });
  socket.on('connect_error', (e) => console.warn('socket connect_error:', e?.message || e));
  socket.on('reconnect', (n) => {
    console.log('socket reconnected', n);
    // On reconnection, reload to resync state
    loadGroups();
    loadNotes();
  });
  socket.on('notes:changed', (payload) => {
    console.log('notes:changed received', payload);
    // Simplify: reload current list
    loadNotes();
  });
  socket.on('groups:changed', () => {
    loadGroups();
  });

  // Polling fallback when socket is not connected
  setInterval(() => {
    if (!socketConnected) {
      loadNotes();
      // groups rarely change; refresh occasionally
      if (Math.random() < 0.25) loadGroups();
    }
  }, 8000);
}

connectSocket();

// Groups
async function loadGroups() {
  try {
    const { data } = await api('/api/groups');
    state.groups = data || [];
    renderGroups();
    fillGroupSelects();
  } catch (e) {
    console.error('groups load error', e);
  }
}

function renderGroups() {
  const wrap = els.groupList;
  wrap.innerHTML = '';
  state.groups.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2';
    const color = g.color || '#64748b';
    btn.dataset.group = g._id;
    btn.innerHTML = `<span class="h-2 w-2 rounded-full inline-block" style="background:${color}"></span><span>${escapeHtml(g.name)}</span>`;
    btn.addEventListener('click', () => setFilter(g._id));
    wrap.appendChild(btn);
  });
}

function fillGroupSelects() {
  const options = ['<option value="">No group</option>']
    .concat(state.groups.map(g => `<option value="${g._id}">${escapeHtml(g.name)}</option>`))
    .join('');
  if (els.noteGroup) els.noteGroup.innerHTML = options;
  if (els.editGroup) els.editGroup.innerHTML = options;
}

// Filters
els.filters?.addEventListener('click', (e) => {
  if (!(e.target instanceof HTMLElement)) return;
  const btn = e.target.closest('button[data-group]');
  if (!btn) return;
  const g = btn.getAttribute('data-group');
  if (!g) return;
  setFilter(g);
});

function setFilter(f) {
  state.filter = f;
  state.selected.clear();
  els.selectAll.checked = false;
  updateToolbar();
  loadNotes();
}

// Notes
async function loadNotes() {
  showSkeletons();
  try {
    const params = new URLSearchParams();
    if (state.filter === 'deleted') params.set('deleted', 'true');
    if (state.filter && !['all', 'deleted', 'ungrouped'].includes(state.filter)) params.set('groupId', state.filter);
    const { data } = await api(`/api/notes?${params.toString()}`);
    let notes = data || [];
    if (state.filter === 'ungrouped') notes = notes.filter(n => !n.groupId);
    if (state.search) notes = notes.filter(n =>
      (n.title || '').toLowerCase().includes(state.search) ||
      (stripHtml(n.content || '')).toLowerCase().includes(state.search)
    );
    state.notes = notes;
    renderNotes();
  } catch (e) {
    console.error('note load error', e);
  } finally {
    if (!state.firstLoadDone) {
      state.firstLoadDone = true;
      hidePageLoader();
    }
  }
}

function showSkeletons() {
  els.notesContainer.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    els.notesContainer.appendChild(els.skeletonTpl.content.cloneNode(true));
  }
}

function renderNotes() {
  const wrap = els.notesContainer;
  wrap.innerHTML = '';
  state.notes.forEach(n => wrap.appendChild(renderNoteCard(n)));
}

function renderNoteCard(note) {
  const div = document.createElement('div');
  const isDeleted = !!note.isDeleted;
  const isDone = !!note.isDone;
  const group = state.groups.find(g => g._id === (note.groupId && note.groupId.$oid ? note.groupId.$oid : note.groupId));
  const groupName = group ? group.name : '';
  const groupColor = group ? group.color : '#64748b';

  div.className = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4 shadow-sm';
  div.innerHTML = `
    <div class="flex items-start gap-3">
      <input type="checkbox" class="mt-1 h-4 w-4 note-select" data-id="${note._id}" ${state.selected.has(idOf(note)) ? 'checked' : ''} />
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-3">
          <h3 class="font-semibold ${isDone ? 'line-through opacity-70' : ''}">${escapeHtml(note.title || '')}</h3>
          <div class="flex items-center gap-1">
            ${groupName ? `<span class="chip" style="background:transparent;border:1px solid ${groupColor};color:${groupColor}">${escapeHtml(groupName)}</span>` : ''}
            ${isDone ? '<span class="chip">Done</span>' : ''}
          </div>
        </div>
        <div class="prose prose-sm dark:prose-invert max-w-none mt-2">${note.content || ''}</div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          ${isDeleted ? `
            <button class="btn btn-soft btn-restore" data-id="${note._id}">Restore</button>
            <button class="btn btn-soft btn-delete-perm" data-id="${note._id}">Delete Forever</button>
          ` : `
            <button class="btn btn-soft btn-done" data-id="${note._id}">${isDone ? 'Mark Undone' : 'Mark Done'}</button>
            <button class="btn btn-soft btn-edit" data-id="${note._id}">Edit</button>
            <button class="btn btn-soft btn-delete" data-id="${note._id}">Delete</button>
          `}
        </div>
      </div>
    </div>
  `;

  // events
  const cb = $('.note-select', div);
  cb.addEventListener('change', () => {
    const id = idOf(note);
    if (cb.checked) state.selected.add(id); else state.selected.delete(id);
    els.selectAll.checked = state.selected.size && state.selected.size === state.notes.length;
    updateToolbar();
  });

  $('.btn-done', div)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api(`/api/notes/${idOf(note)}`, { method: 'PATCH', body: { isDone: !isDone } });
      const payload1 = { type: 'updated', id: idOf(note) };
      console.log('emitting client:notes:changed', payload1);
      window.__emitNotesChanged?.(payload1);
      loadNotes();
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes('note not found')) {
        // Treat as already updated (stale UI)
        loadNotes();
      } else {
        alert('Mark done failed: ' + msg);
        console.error(err);
      }
    } finally {
      btn.disabled = false;
    }
  });
  $('.btn-edit', div)?.addEventListener('click', () => openEditModal(note));
  $('.btn-delete', div)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    console.log("Deleting note", note);
    try {
      await api(`/api/notes/${idOf(note)}`, { method: 'DELETE' });
      const payload2 = { type: 'soft-deleted', id: idOf(note) };
      console.log('emitting client:notes:changed', payload2);
      window.__emitNotesChanged?.(payload2);
      loadNotes();
    } catch (err) {
      const msg = String(err?.message || err);
      // If backend says note not found, treat as already deleted
      if (msg.includes('note not found')) {
        loadNotes();
      } else {
        alert('Delete failed: ' + msg);
        console.error(err);
      }
    } finally {
      btn.disabled = false;
    }
  });
  $('.btn-restore', div)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api(`/api/notes/${idOf(note)}/restore`, { method: 'POST' });
      const payload3 = { type: 'restored', id: idOf(note) };
      console.log('emitting client:notes:changed', payload3);
      window.__emitNotesChanged?.(payload3);
      loadNotes();
    } catch (err) {
      const msg = String(err?.message || err);
      // If backend says note not found, treat as already restored
      if (msg.includes('note not found')) {
        loadNotes();
      } else {
        alert('Restore failed: ' + msg);
        console.error(err);
      }
    } finally {
      btn.disabled = false;
    }
  });
  $('.btn-delete-perm', div)?.addEventListener('click', async (e) => {
    if (!confirm('Permanently delete this note? This cannot be undone.')) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api(`/api/notes/${idOf(note)}/permanent`, { method: 'DELETE' });
      const payload4 = { type: 'permanently-deleted', id: idOf(note) };
      console.log('emitting client:notes:changed', payload4);
      window.__emitNotesChanged?.(payload4);
      loadNotes();
    } catch (err) {
      const msg = String(err?.message || err);
      // If backend says note not found, treat as already deleted
      if (msg.includes('note not found')) {
        loadNotes();
      } else {
        alert('Permanent delete failed: ' + msg);
        console.error(err);
      }
    } finally {
      btn.disabled = false;
    }
  });

  return div;
}

// Toolbar
els.selectAll?.addEventListener('change', () => {
  if (els.selectAll.checked) state.notes.forEach(n => state.selected.add(idOf(n)));
  else state.selected.clear();
  $$('input.note-select').forEach(cb => (cb.checked = els.selectAll.checked));
  updateToolbar();
});

function updateToolbar() {
  const wrap = els.toolbar;
  wrap.innerHTML = '';
  const any = state.selected.size > 0;

  if (state.filter === 'deleted') {
    // Restore
    const restoreBtn = button('Restore Selected', async () => batch('restore'));
    restoreBtn.disabled = !any;
    wrap.appendChild(restoreBtn);
    // Permanent delete
    const deleteBtn = button('Delete Forever', async () => {
      if (!confirm('Permanently delete selected notes?')) return;
      await batch('permanent-delete');
    });
    deleteBtn.disabled = !any;
    wrap.appendChild(deleteBtn);
    // Empty recycle bin
    const emptyBtn = button('Empty Recycle Bin', async () => {
      if (!confirm('Empty recycle bin? This cannot be undone.')) return;
      const ids = state.notes.map(n => idOf(n));
      if (ids.length) await api('/api/notes/batch', { method: 'POST', body: { action: 'permanent-delete', ids } });
    });
    wrap.appendChild(emptyBtn);
  } else {
    // Mark done/undone
    const doneBtn = button('Mark Done', async () => batch('mark-done'));
    doneBtn.disabled = !any;
    wrap.appendChild(doneBtn);

    const undoneBtn = button('Mark Undone', async () => batch('mark-undone'));
    undoneBtn.disabled = !any;
    wrap.appendChild(undoneBtn);

    // Soft delete
    const delBtn = button('Delete Selected', async () => batch('soft-delete'));
    delBtn.disabled = !any;
    wrap.appendChild(delBtn);
  }
}

function button(label, onClick) {
  const b = document.createElement('button');
  b.className = 'btn btn-soft';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function batch(action) {
  const ids = Array.from(state.selected);
  if (!ids.length) return;
  try {
    await api('/api/notes/batch', { method: 'POST', body: { action, ids } });
  } catch (err) {
    alert('Batch action failed: ' + (err?.message || err));
    console.error(err);
  } finally {
    state.selected.clear();
    els.selectAll.checked = false;
    loadNotes();
  }
}

// Search
els.search?.addEventListener('input', (e) => {
  state.search = (e.target.value || '').trim().toLowerCase();
  renderNotes();
});

// Create note
els.createNote?.addEventListener('click', async () => {
  const title = els.noteTitle.value.trim();
  const content = els.editor.innerHTML.trim();
  const groupId = els.noteGroup.value || undefined;
  if (!title) return;
  try {
    await api('/api/notes', { method: 'POST', body: { title, content, groupId } });
    els.noteTitle.value = '';
    els.editor.innerHTML = '';
    const payload5 = { type: 'created' };
    console.log('emitting client:notes:changed', payload5);
    window.__emitNotesChanged?.(payload5);
    loadNotes();
  } catch (err) {
    alert('Create note failed: ' + (err?.message || err));
    console.error(err);
  }
});

// Add group
els.addGroup?.addEventListener('click', async () => {
  const name = prompt('Group name');
  if (!name) return;
  const color = prompt('Optional color hex (e.g., #10b981)', '#64748b') || '#64748b';
  await api('/api/groups', { method: 'POST', body: { name, color } });
});

// Edit modal
function openEditModal(note) {
  els.editModal.classList.remove('hidden');
  els.editTitle.value = note.title || '';
  els.editEditor.innerHTML = note.content || '';
  const gid = (note.groupId && note.groupId.$oid) ? note.groupId.$oid : note.groupId || '';
  els.editGroup.value = gid || '';
  els.editSave.onclick = async () => {
    const title = els.editTitle.value.trim();
    const content = els.editEditor.innerHTML.trim();
    const groupId = els.editGroup.value || null;
    try {
      await api(`/api/notes/${idOf(note)}`, { method: 'PATCH', body: { title, content, groupId } });
      closeEditModal();
      const payload6 = { type: 'updated', id: idOf(note) };
      console.log('emitting client:notes:changed', payload6);
      window.__emitNotesChanged?.(payload6);
      loadNotes();
    } catch (err) {
      alert('Save failed: ' + (err?.message || err));
      console.error(err);
    }
  };
}

function closeEditModal() { els.editModal.classList.add('hidden'); }
$$('[data-close="modal"]').forEach(el => el.addEventListener('click', closeEditModal));
els.editModal?.addEventListener('click', (e) => {
  if ((e.target instanceof HTMLElement) && e.target.dataset.close === 'modal') closeEditModal();
});

// Utils
function idOf(note) {
  // Mongo may serialize ObjectId differently; normalize
  return note._id?.$oid || note._id;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function hidePageLoader() {
  if (!els.pageLoader) return;
  els.pageLoader.classList.add('opacity-0');
  setTimeout(() => els.pageLoader.remove(), 250);
}

// Init
(async function init() {
  // prepare
  updateToolbar();
  await Promise.all([loadGroups(), loadNotes()]);
})();
