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
  // Mobile drawer elements
  mobileDrawer: $('#mobile-drawer'),
  drawerBackdrop: $('#drawer-backdrop'),
  drawerPanel: $('#drawer-panel'),
  closeDrawer: $('#close-drawer'),
  searchMobile: $('#search-mobile'),
  filtersMobile: $('#filters-mobile'),
  addGroupMobile: $('#add-group-mobile'),
  groupListMobile: $('#group-list-mobile'),
  // Group modal elements
  addGroupModal: $('#add-group-modal'),
  groupNameInput: $('#group-name-input'),
  createGroupBtn: $('#create-group-btn'),
  themeIcon: $('#theme-icon-path'),
  themeIconM: $('#theme-icon-path-m'),
  // Delete group modal elements
  deleteGroupModal: $('#delete-group-modal'),
  deleteGroupName: $('#delete-group-name'),
  confirmDeleteGroup: $('#confirm-delete-group'),
  cancelDeleteGroup: $('#cancel-delete-group'),
};

// Theme
function setTheme(mode) {
  try {
    localStorage.setItem('theme', mode);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = mode === 'dark' || (mode === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
    updateThemeIcons(isDark);
  } catch {}
}

function updateThemeIcons(isDark) {
  const moonPath = 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z';
  const sunPath = 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z';
  
  if (els.themeIcon) {
    els.themeIcon.setAttribute('d', isDark ? sunPath : moonPath);
  }
  if (els.themeIconM) {
    els.themeIconM.setAttribute('d', isDark ? sunPath : moonPath);
  }
}

function toggleTheme() {
  const cur = localStorage.getItem('theme') || 'system';
  const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
  setTheme(next);
}

els.themeToggle?.addEventListener('click', toggleTheme);
els.themeToggleM?.addEventListener('click', toggleTheme);

// Initialize theme icons
document.addEventListener('DOMContentLoaded', () => {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = localStorage.getItem('theme') || 'system';
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  updateThemeIcons(isDark);
});

// Mobile drawer functionality
let isDrawerOpen = false;

function openMobileDrawer() {
  els.mobileDrawer.style.display = 'block';
  setTimeout(() => {
    els.drawerBackdrop?.classList.add('open');
    els.drawerPanel?.classList.add('open');
    isDrawerOpen = true;
  }, 10);
}

function closeMobileDrawer() {
  els.drawerBackdrop?.classList.remove('open');
  els.drawerPanel?.classList.remove('open');
  setTimeout(() => {
    els.mobileDrawer.style.display = 'none';
    isDrawerOpen = false;
  }, 300);
}

function toggleMobileDrawer() {
  if (isDrawerOpen) {
    closeMobileDrawer();
  } else {
    openMobileDrawer();
  }
}

els.mobileMenu?.addEventListener('click', toggleMobileDrawer);
els.closeDrawer?.addEventListener('click', closeMobileDrawer);
els.drawerBackdrop?.addEventListener('click', closeMobileDrawer);

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
  const groupHTML = state.groups.map(g => 
    `<div class="group-item">
      <button data-group="${g._id}" class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2">
        <div class="h-3 w-3 rounded-full" style="background:${g.color}"></div>
        ${escapeHtml(g.name)}
      </button>
      <button class="group-delete-btn" data-group-id="${g._id}" title="Delete Group">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
        </svg>
      </button>
    </div>`
  ).join('');
  
  if (els.groupList) {
    els.groupList.innerHTML = groupHTML;
    addGroupDeleteListeners(els.groupList);
  }
  if (els.groupListMobile) {
    els.groupListMobile.innerHTML = groupHTML;
    addGroupDeleteListeners(els.groupListMobile);
  }
  fillGroupSelects();
}

function addGroupDeleteListeners(container) {
  container.querySelectorAll('.group-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const groupId = btn.getAttribute('data-group-id');
      const group = state.groups.find(g => g._id === groupId);
      if (!group) return;
      
      // Show custom delete confirmation modal
      showDeleteGroupModal(group);
    });
  });
}

// Delete group modal functionality
let currentGroupToDelete = null;

function showDeleteGroupModal(group) {
  currentGroupToDelete = group;
  els.deleteGroupName.textContent = group.name;
  els.deleteGroupModal?.classList.remove('hidden');
}

function hideDeleteGroupModal() {
  els.deleteGroupModal?.classList.add('hidden');
  currentGroupToDelete = null;
}

// Delete group modal event listeners
els.cancelDeleteGroup?.addEventListener('click', hideDeleteGroupModal);
els.deleteGroupModal?.addEventListener('click', (e) => {
  if (e.target === els.deleteGroupModal) hideDeleteGroupModal();
});

els.confirmDeleteGroup?.addEventListener('click', async () => {
  if (!currentGroupToDelete) return;
  
  const groupId = currentGroupToDelete._id;
  els.confirmDeleteGroup.disabled = true;
  els.confirmDeleteGroup.textContent = 'Deleting...';
  
  try {
    // First, get all notes in this group
    const { data: groupNotes } = await api(`/api/notes?groupId=${groupId}`);
    
    // Delete all notes in the group first
    if (groupNotes && groupNotes.length > 0) {
      const noteIds = groupNotes.map(note => note._id);
      await api('/api/notes/batch', { 
        method: 'POST', 
        body: { action: 'permanent-delete', ids: noteIds } 
      });
    }
    
    // Then delete the group
    await api(`/api/groups/${groupId}`, { method: 'DELETE' });
    
    // Refresh the UI
    hideDeleteGroupModal();
    loadGroups();
    loadNotes();
    
    // Emit socket event for real-time updates
    const payload = { type: 'group-deleted', groupId };
    console.log('emitting client:groups:changed', payload);
    window.__emitNotesChanged?.(payload);
    
  } catch (err) {
    console.error('Delete group error:', err);
    alert('Delete group failed: ' + (err?.message || err));
  } finally {
    els.confirmDeleteGroup.disabled = false;
    els.confirmDeleteGroup.textContent = 'Delete Group';
  }
});

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
  
  // Update active state visually
  els.filters.querySelectorAll('button').forEach(b => b.classList.remove('bg-slate-100', 'dark:bg-slate-800'));
  btn.classList.add('bg-slate-100', 'dark:bg-slate-800');
  
  setFilter(g);
});

// Desktop group list
els.groupList?.addEventListener('click', (e) => {
  if (!(e.target instanceof HTMLElement)) return;
  const btn = e.target.closest('button[data-group]');
  if (!btn) return;
  const g = btn.getAttribute('data-group');
  if (!g) return;
  
  // Update active state visually
  els.groupList.querySelectorAll('button').forEach(b => b.classList.remove('bg-slate-100', 'dark:bg-slate-800'));
  btn.classList.add('bg-slate-100', 'dark:bg-slate-800');
  
  setFilter(g);
});

// Mobile filters
els.filtersMobile?.addEventListener('click', (e) => {
  if (!(e.target instanceof HTMLElement)) return;
  const btn = e.target.closest('button[data-group]');
  if (!btn) return;
  const g = btn.getAttribute('data-group');
  if (!g) return;
  
  // Update active state visually
  els.filtersMobile.querySelectorAll('button').forEach(b => b.classList.remove('bg-slate-100', 'dark:bg-slate-800'));
  btn.classList.add('bg-slate-100', 'dark:bg-slate-800');
  
  setFilter(g);
  closeMobileDrawer();
});

// Mobile group list
els.groupListMobile?.addEventListener('click', (e) => {
  if (!(e.target instanceof HTMLElement)) return;
  const btn = e.target.closest('button[data-group]');
  if (!btn) return;
  const g = btn.getAttribute('data-group');
  if (!g) return;
  
  // Update active state visually
  els.groupListMobile.querySelectorAll('button').forEach(b => b.classList.remove('bg-slate-100', 'dark:bg-slate-800'));
  btn.classList.add('bg-slate-100', 'dark:bg-slate-800');
  
  setFilter(g);
  closeMobileDrawer();
});

// Mobile group list event listeners are handled above

function setFilter(f) {
  state.filter = f;
  state.selected.clear();
  els.selectAll.checked = false;
  
  // Update active states across both desktop and mobile
  updateActiveFilterStates(f);
  
  updateToolbar();
  loadNotes();
}

function updateActiveFilterStates(activeFilter) {
  // Clear all active states first
  els.filters?.querySelectorAll('button').forEach(b => b.classList.remove('bg-slate-100', 'dark:bg-slate-800'));
  els.filtersMobile?.querySelectorAll('button').forEach(b => b.classList.remove('bg-slate-100', 'dark:bg-slate-800'));
  els.groupList?.querySelectorAll('button').forEach(b => b.classList.remove('bg-slate-100', 'dark:bg-slate-800'));
  els.groupListMobile?.querySelectorAll('button').forEach(b => b.classList.remove('bg-slate-100', 'dark:bg-slate-800'));
  
  // Set active state for the current filter
  const activeButtons = document.querySelectorAll(`button[data-group="${activeFilter}"]`);
  activeButtons.forEach(btn => btn.classList.add('bg-slate-100', 'dark:bg-slate-800'));
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

  div.className = 'note-card rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4 shadow-sm';
  div.innerHTML = `
    <div class="flex items-start gap-3">
      <input type="checkbox" class="mt-1 h-4 w-4 note-select" data-id="${note._id}" ${state.selected.has(idOf(note)) ? 'checked' : ''} />
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-3">
          <h3 class="font-semibold ${isDone ? 'line-through opacity-70' : ''}">${escapeHtml(note.title || '')}</h3>
          <div class="flex items-center gap-1">
            ${groupName ? `<span class="chip" style="background:transparent;border:1px solid ${groupColor};color:${groupColor}">${escapeHtml(groupName)}</span>` : ''}
            ${isDone ? '<span class="chip">✓</span>' : ''}
          </div>
        </div>
        <div class="prose prose-sm dark:prose-invert max-w-none mt-2">${note.content || ''}</div>
        <div class="mt-3 flex items-center justify-between">
          <div class="flex items-center gap-1">
            ${isDeleted ? `
              <button class="btn-icon btn-restore" data-id="${note._id}" title="Restore">↩</button>
              <button class="btn-icon btn-delete-perm" data-id="${note._id}" title="Delete Forever">🗑</button>
            ` : `
              <button class="btn-icon btn-done" data-id="${note._id}" title="${isDone ? 'Mark Undone' : 'Mark Done'}">${isDone ? '↶' : '✓'}</button>
              <button class="btn-icon btn-edit" data-id="${note._id}" title="Edit">✏</button>
              <button class="btn-icon btn-delete" data-id="${note._id}" title="Delete">🗑</button>
            `}
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400">
            ${new Date(note.createdAt || note.updatedAt).toLocaleDateString()}
          </div>
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
    e.preventDefault();
    e.stopPropagation();
    // if (!confirm('Permanently delete this note? This cannot be undone.')) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const noteId = idOf(note);
      await api(`/api/notes/${noteId}/permanent`, { method: 'DELETE' });
      const payload4 = { type: 'permanently-deleted', id: noteId };
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
    const deleteBtn = button('Delete Forever', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // if (!confirm('Permanently delete selected notes? This cannot be undone.')) return;
      await batch('permanent-delete');
    });
    deleteBtn.disabled = !any;
    wrap.appendChild(deleteBtn);
    // Empty recycle bin
    const emptyBtn = button('Empty Recycle Bin', async (e) => {
      // console.log('Emptying recycle bin');
      e.preventDefault();
      e.stopPropagation();
      // if (!confirm('Empty recycle bin? This cannot be undone.')) return;
      const ids = state.notes.map(n => idOf(n));
      if (ids.length) {
        emptyBtn.disabled = true;
        try {
          await api('/api/notes/batch', { method: 'POST', body: { action: 'permanent-delete', ids } });
          const payload = { type: 'permanently-deleted-batch', ids };
          console.log('emitting client:notes:changed', payload);
          window.__emitNotesChanged?.(payload);
          loadNotes();
        } catch (err) {
          alert('Empty recycle bin failed: ' + (err?.message || err));
          console.error(err);
        } finally {
          emptyBtn.disabled = false;
        }
      } else {
        alert('Recycle bin is already empty.');
      }
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
  if (!ids.length) {
    alert('No notes selected.');
    return;
  }
  
  try {
    await api('/api/notes/batch', { method: 'POST', body: { action, ids } });
    const payload = { type: `${action}-batch`, ids };
    console.log('emitting client:notes:changed', payload);
    window.__emitNotesChanged?.(payload);
  } catch (err) {
    alert('Batch action failed: ' + (err?.message || err));
    console.error(err);
  } finally {
    state.selected.clear();
    els.selectAll.checked = false;
    updateToolbar();
    loadNotes();
  }
}

// Search
els.search?.addEventListener('input', (e) => {
  state.search = (e.target.value || '').trim().toLowerCase();
  renderNotes();
});

// Mobile search
els.searchMobile?.addEventListener('input', (e) => {
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

// Group modal functionality
function openGroupModal() {
  els.addGroupModal?.classList.remove('hidden');
  els.groupNameInput?.focus();
}

function closeGroupModal() {
  els.addGroupModal?.classList.add('hidden');
  els.groupNameInput.value = '';
  // Reset color selection to default (blue)
  const colorInputs = document.querySelectorAll('input[name="group-color"]');
  colorInputs.forEach(input => {
    input.checked = input.value === '#3b82f6';
    const colorDiv = input.nextElementSibling;
    if (input.checked) {
      colorDiv.classList.add('border-slate-300', 'dark:border-slate-600');
      colorDiv.classList.remove('border-transparent');
    } else {
      colorDiv.classList.remove('border-slate-300', 'dark:border-slate-600');
      colorDiv.classList.add('border-transparent');
    }
  });
}

// Add group button event listeners
els.addGroup?.addEventListener('click', openGroupModal);
els.addGroupMobile?.addEventListener('click', openGroupModal);

// Group modal event listeners
$$('[data-close="group-modal"]').forEach(el => el.addEventListener('click', closeGroupModal));
els.addGroupModal?.addEventListener('click', (e) => {
  if (e.target === els.addGroupModal) closeGroupModal();
});

// Color selection handling
document.addEventListener('change', (e) => {
  if (e.target.name === 'group-color') {
    const colorInputs = document.querySelectorAll('input[name="group-color"]');
    colorInputs.forEach(input => {
      const colorDiv = input.nextElementSibling;
      if (input.checked) {
        colorDiv.classList.add('border-slate-300', 'dark:border-slate-600');
        colorDiv.classList.remove('border-transparent');
      } else {
        colorDiv.classList.remove('border-slate-300', 'dark:border-slate-600');
        colorDiv.classList.add('border-transparent');
      }
    });
  }
});

// Create group functionality
els.createGroupBtn?.addEventListener('click', async () => {
  const name = els.groupNameInput?.value.trim();
  if (!name) {
    alert('Please enter a group name');
    return;
  }
  
  const selectedColor = document.querySelector('input[name="group-color"]:checked')?.value || '#3b82f6';
  
  try {
    await api('/api/groups', { method: 'POST', body: { name, color: selectedColor } });
    closeGroupModal();
    loadGroups();
  } catch (err) {
    alert('Create group failed: ' + (err?.message || err));
    console.error(err);
  }
});

// Enter key support for group name input
els.groupNameInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    els.createGroupBtn?.click();
  }
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
