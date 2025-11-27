/* ------------------------------------------------------------------
   app.js - Supabase REST version (Option A)
   Replaces localStorage events/subscriptions with Supabase REST calls.
   Keep session/users in localStorage (NTID).
   ------------------------------------------------------------------ */

/* ========== Supabase REST config - REPLACE these ========== */
const SUPABASE_URL = "REPLACE_WITH_YOUR_PROJECT_URL";      // e.g. https://ridhgyfcgmsevazuzkkb.supabase.co
const SUPABASE_ANON_KEY = "REPLACE_WITH_YOUR_ANON_KEY";    // your anon public key

(() => {
  const STORAGE_PREFIX = 'enotifier_';
  const LS = {
    key(k){ return STORAGE_PREFIX + k; },
    get(k){ try { return JSON.parse(localStorage.getItem(this.key(k))); } catch(e){ return null; } },
    set(k,v){ localStorage.setItem(this.key(k), JSON.stringify(v)); },
    remove(k){ localStorage.removeItem(this.key(k)); }
  };

  // --- Utilities ---
  const qs = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const uid = () => 'id_' + Date.now() + '_' + Math.floor(Math.random()*9999);
  const escapeHtml = s => String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function toast(msg, type='info', t=3500){
    let container = qs('#toasts');
    if(!container){ container = document.createElement('div'); container.id = 'toasts'; document.body.appendChild(container); }
    const box = document.createElement('div');
    box.className = 'toast ' + type;
    box.textContent = msg;
    Object.assign(box.style, {padding:'10px 14px', borderRadius:'8px', color:'#fff', marginTop:'8px', fontWeight:700, zIndex:9999});
    if(type==='success') box.style.background = 'linear-gradient(135deg,#2bb673,#1f8f5a)';
    if(type==='error') box.style.background = 'linear-gradient(135deg,#e05b5b,#b13232)';
    if(type==='info') box.style.background = 'linear-gradient(135deg,#4d4da9,#6a42f4)';
    container.appendChild(box);
    setTimeout(()=> box.remove(), t);
  }

  /* ---------------- Supabase REST helper (REPLACED / FIXED) ---------------- */
  const SupabaseRest = (function(){
    if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
      console.warn('Supabase REST placeholders not replaced yet.');
    }

    function baseHeaders(additional = {}) {
      return Object.assign({
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }, additional);
    }

    async function request(path, method='GET', body=null, params='', extraHeaders = {}) {
      const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${path}${params ? ('?' + params) : ''}`;
      const opts = { method, headers: baseHeaders(extraHeaders) };
      if(body !== null) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      const ct = res.headers.get('content-type') || '';
      let data = null;
      if(ct.includes('application/json')) data = await res.json();
      else data = await res.text();
      if(!res.ok){
        const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : JSON.stringify(data));
        const err = new Error(`Supabase REST error ${res.status}: ${msg}`);
        err.status = res.status; err.body = data;
        throw err;
      }
      return data;
    }

    // EVENTS
    async function fetchEvents({ onlyUpcoming=false, limit=1000 } = {}) {
      let params = `select=*&order=startdate.asc&limit=${limit}`;
      if(onlyUpcoming){
        const today = new Date().toISOString().slice(0,10);
        params += `&startdate=gte.${today}`;
      }
      return await request('Events', 'GET', null, params);
    }

    async function createEvent(payload){
      const data = await request('Events', 'POST', [payload], '', { Prefer: 'return=representation' });
      return Array.isArray(data) ? data[0] : data;
    }

    async function updateEvent(id, payload){
      const params = `id=eq.${encodeURIComponent(id)}`;
      const data = await request('Events', 'PATCH', payload, params, { Prefer: 'return=representation' });
      return Array.isArray(data) ? data[0] : data;
    }

    async function deleteEvent(id){
      const params = `id=eq.${encodeURIComponent(id)}`;
      await request('Events', 'DELETE', null, params);
      return true;
    }

    // SUBSCRIPTIONS
    async function fetchSubscriptionsByEventName(eventName){
      const q = `select=*&event_name=eq.${encodeURIComponent(eventName)}`;
      return await request('subscriptions', 'GET', null, q);
    }

    async function subscribeByEventName({ event_name, subscriber_email, subscriber_NTID=null, auto_renewal=true }){
      const payload = {
        event_name,
        subscriber_email,
        subscriber_NTID,
        auto_renewal,
        created_at: new Date().toISOString()
      };
      const data = await request('subscriptions', 'POST', [payload], '', { Prefer: 'return=representation' });
      return Array.isArray(data) ? data[0] : data;
    }

    async function unsubscribeByEmail(event_name, subscriber_email){
      const subs = await fetchSubscriptionsByEventName(event_name);
      const toDelete = subs.filter(s => (s.subscriber_email && s.subscriber_email.toLowerCase() === String(subscriber_email||'').toLowerCase()));
      if(toDelete.length === 0) return [];
      const ids = toDelete.map(d => encodeURIComponent(d.id)).join(',');
      const params = `id=in.(${ids})`;
      await request('subscriptions', 'DELETE', null, params);
      return toDelete;
    }

    return {
      fetchEvents,
      createEvent,
      updateEvent,
      deleteEvent,
      fetchSubscriptionsByEventName,
      subscribeByEventName,
      unsubscribeByEmail
    };
  })();

  /* ============= In-memory caches (pure Supabase flow) ============= */
  let EVENTS_CACHE = [];
  let SUBS_CACHE = [];

  function getEvents(){ return EVENTS_CACHE; }
  function saveEvents(arr){ EVENTS_CACHE = Array.isArray(arr)?arr:[]; }
  async function refreshEvents(){
    try {
      const rows = await SupabaseRest.fetchEvents({ onlyUpcoming:false, limit:1000 });
      saveEvents(rows.map(r => ({
        id: String(r.id),
        ownerId: r.user_id,
        name: r.event_name || '',
        description: r.description || '',
        startDate: r.startdate ? (new Date(r.startdate)).toISOString().slice(0,10) : '',
        endDate: r.enddate ? (new Date(r.enddate)).toISOString().slice(0,10) : '',
        status: r.status || '',
        tags: r.tags ? String(r.tags).split(',').map(s=>s.trim()).filter(Boolean) : [],
        contactEmail: r.contact_email || '',
        renewalEnabled: !!r.renewal,
        createdAt: r.created_at || null,
        published: !!r.published,
        draft: !!r.draft,
        subscriberIds: r.subscriberIds || []
      })));
    } catch(e){
      console.error('refreshEvents error', e);
      EVENTS_CACHE = [];
    }
  }

  async function refreshSubsForUser(currentUserParam){
    if(!currentUserParam) { SUBS_CACHE = []; return []; }
    try {
      const email = currentUserParam.email || '';
      const ntid = currentUserParam.id || '';
      const conditions = `or=(subscriber_NTID.eq.${encodeURIComponent(ntid)},subscriber_email.eq.${encodeURIComponent(email)})&select=*`;
      const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/subscriptions?${conditions}`;
      const res = await fetch(url, { method:'GET', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
      if(!res.ok){
        const txt = await res.text().catch(()=>null);
        throw new Error('Failed to load subs: ' + res.status + ' ' + txt);
      }
      const data = await res.json();
      SUBS_CACHE = data;
      return SUBS_CACHE;
    } catch(e){
      console.error('refreshSubsForUser error', e);
      SUBS_CACHE = [];
      return [];
    }
  }

  // --- Session & auth (NTID only) ---
  let currentUser = null;
  function setSession(u){ LS.set('session', u); currentUser = u; }
  function clearSession(){ LS.remove('session'); localStorage.removeItem(LS.key('remember_ntid')); currentUser = null; }
  function loadSession(){
    const s = LS.get('session');
    if(s){
      const users = LS.get('users') || [];
      const u = users.find(x => x.id === s.id);
      if(u) currentUser = { id:u.id, ntid:u.ntid, email:u.email, displayName:u.displayName };
      else currentUser = s;
    }
  }

  // --- Date & status utilities ---
  function todayISO(){ return (new Date()).toISOString().slice(0,10); }
  function computeStatus(ev){
    const now = new Date();
    const start = ev.startDate ? new Date(ev.startDate + 'T00:00:00') : null;
    const end = ev.endDate ? new Date(ev.endDate + 'T00:00:00') : null;
    if(end && end < new Date(now.getFullYear(), now.getMonth(), now.getDate())) return 'expired';
    if(start && end && start <= now && now <= new Date(end.getFullYear(), end.getMonth(), end.getDate()+1)) return 'ongoing';
    if(start && start <= now && (!end || end >= now)) return 'ongoing';
    return 'upcoming';
  }

  // --- Dashboard render (counts, lists) ---
  function renderDashboardCounts(){
    const events = getEvents();
    const myEvents = currentUser ? events.filter(e => e.ownerId === currentUser.id) : [];
    const published = myEvents.filter(e => e.published && !e.draft);
    const subs = (SUBS_CACHE || []).filter(s => s.subscriber_NTID === (currentUser && currentUser.id) || (currentUser && s.subscriber_email && s.subscriber_email.toLowerCase() === currentUser.email.toLowerCase()));
    const renewals = events.filter(e => e.renewalEnabled && e.published && e.endDate).filter(e => {
      const end = new Date(e.endDate + 'T00:00:00'); const now = new Date();
      const diffDays = Math.ceil((end - now)/(1000*60*60*24)); return diffDays <= 7 && diffDays >= 0;
    });

    if(qs('#stat-total-events')) qs('#stat-total-events').textContent = events.length;
    if(qs('#stat-active-subs')) qs('#stat-active-subs').textContent = subs.length;
    if(qs('#stat-renewals')) qs('#stat-renewals').textContent = renewals.length;
    if(qs('#hero-active-events')) qs('#hero-active-events').textContent = published.length;
    if(qs('#hero-subscribed-events')) qs('#hero-subscribed-events').textContent = subs.length;

    const ur = qs('#upcoming-renewals');
    if(ur){
      ur.innerHTML = '';
      const ulist = events.filter(e => e.renewalEnabled && e.published && e.endDate).filter(e => {
        const end = new Date(e.endDate + 'T00:00:00'); const now = new Date();
        const diffDays = Math.ceil((end - now)/(1000*60*60*24)); return diffDays <= 7 && diffDays >= 0;
      }).slice(0,4);
      if(!ulist.length) ur.innerHTML = '<div class="empty-state">No renewals soon</div>';
      else ulist.forEach(e => {
        const end = new Date(e.endDate + 'T00:00:00'); const diffDays = Math.ceil((end - new Date())/(1000*60*60*24));
        const div = document.createElement('div');
        div.className = 'list-item accent-left soon';
        div.innerHTML = `<div class="list-left"><div class="item-title">${escapeHtml(e.name)}</div><div class="item-sub">Expires in ${diffDays} day(s)</div></div><div class="list-right"><div class="badge badge-soon">Renewal</div></div>`;
        ur.appendChild(div);
      });
    }

    const rs = qs('#recent-subs');
    if(rs){
      rs.innerHTML = '';
      const recentSubs = (SUBS_CACHE || []).filter(s => s.subscriber_NTID === (currentUser && currentUser.id) || (currentUser && s.subscriber_email && s.subscriber_email.toLowerCase() === currentUser.email.toLowerCase())).slice(-4).reverse();
      if(!recentSubs.length) rs.innerHTML = '<div class="empty-state">No recent subscriptions</div>';
      else recentSubs.forEach(s => {
        const ev = getEvents().find(e => e.name === s.event_name);
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `<div class="list-left"><div class="item-title">${escapeHtml(ev?ev.name:'(deleted)')}</div><div class="item-sub">${escapeHtml(ev?ev.startDate:'')}</div></div><div class="list-right"><div class="badge badge-active">${escapeHtml(ev?ev.status||'Active':'Unknown')}</div></div>`;
        rs.appendChild(div);
      });
    }
  }

  // --- My Events rendering with Active / Drafts / Expired ---
  function renderOwnerEventsTabs(){
    const container = qs('#owner-events');
    if(!container) return;
    const all = getEvents();
    all.forEach(e => { e.status = computeStatus(e); });

    const events = all.filter(e => e.ownerId === currentUser.id);
    const active = events.filter(e => !e.draft && e.published && e.status !== 'expired');
    const drafts = events.filter(e => e.draft || (!e.published && !e.draft));
    const expired = events.filter(e => e.status === 'expired');

    const html = `
      <div class="tab-panel active" id="panel-active">
        ${active.length ? active.map(ev => ownerEventRowHtml(ev)).join('') : '<div class="empty-state">No active events</div>'}
      </div>
      <div class="tab-panel" id="panel-drafts">
        ${drafts.length ? drafts.map(ev => ownerEventRowHtml(ev)).join('') : '<div class="empty-state">No drafts</div>'}
      </div>
      <div class="tab-panel" id="panel-expired">
        ${expired.length ? expired.map(ev => ownerEventRowHtml(ev)).join('') : '<div class="empty-state">No expired events</div>'}
      </div>
    `;
    container.innerHTML = html;
    renderDashboardCounts();
  }

  function ownerEventRowHtml(ev){
    const subs = (ev.subscriberIds||[]).length;
    const statusClass = ev.status === 'expired' ? 'status-expired' : (ev.status === 'ongoing' ? 'status-warning' : 'status-active');
    const publishLabel = ev.published ? 'Unpublish' : 'Publish';
    return `
      <div class="events-row" data-id="${ev.id}">
        <div class="col name">${escapeHtml(ev.name)}</div>
        <div class="col start">${escapeHtml(ev.startDate || '-')}</div>
        <div class="col end">${escapeHtml(ev.endDate || '-')}</div>
        <div class="col status"><span class="status-badge ${statusClass}">${escapeHtml(ev.status||'Active')}</span></div>
        <div class="col subs">${subs}</div>
        <div class="col actions">
          <button class="btn btn-outline btn-sm" data-action="edit">Edit</button>
          <button class="btn btn-primary btn-sm" data-action="publish">${publishLabel}</button>
          <button class="btn btn-danger btn-sm" data-action="delete">Delete</button>
        </div>
      </div>
    `;
  }

  function initOwnerEventsDelegation(){
    const container = qs('#owner-events');
    if(!container) return;
    if(container._eventsDelegationAttached) return;
    container._eventsDelegationAttached = true;

    container.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if(!btn) return;
      const row = btn.closest('.events-row');
      if(!row) return;
      const id = row.dataset.id;
      const action = btn.dataset.action;
      if(action === 'delete') handleDeleteEvent(id);
      else if(action === 'edit') handleEditEvent(id);
      else if(action === 'publish') handleTogglePublish(id);
    });
  }

  async function handleDeleteEvent(id){
    if(!confirm('Delete this event?')) return;
    try {
      await SupabaseRest.deleteEvent(id);
      await refreshEvents();
      toast('Event deleted', 'success');
      renderOwnerEventsTabs();
      reloadBrowse(true);
      renderDashboardCounts();
      await refreshSubsForUser(currentUser);
    } catch(err){
      console.error(err);
      toast('Delete failed: ' + (err.message||err), 'error');
    }
  }

  function handleEditEvent(id){
    const ev = getEvents().find(x => String(x.id) === String(id) && x.ownerId === currentUser.id);
    if(!ev) { toast('Event not found or unauthorized', 'error'); return; }
    showSection('create-event');
    qs('#event-name').value = ev.name || '';
    qs('#description').value = ev.description || '';
    qs('#start-date').value = ev.startDate || '';
    qs('#end-date').value = ev.endDate || '';
    qs('#location').value = ev.location || '';
    qs('#contact-email').value = ev.contactEmail || `${currentUser.ntid}@Bosch.in`;
    qs('#tags').value = (ev.tags || []).join(',');
    qs('#renewal').checked = !!ev.renewalEnabled;
    const vis = ev.visibility || 'private';
    const r = qs(`[name="visibility"][value="${vis}"]`);
    if(r) r.checked = true;
    sessionStorage.setItem('editing_event', id);
    toast('Editing event — update & publish when ready', 'info', 2500);
  }

  async function handleTogglePublish(id){
    const events = getEvents();
    const idx = events.findIndex(e => String(e.id) === String(id) && e.ownerId === currentUser.id);
    if(idx === -1) { toast('Not found or unauthorized', 'error'); return; }
    const newPublished = !events[idx].published;
    try {
      await SupabaseRest.updateEvent(id, { published: newPublished, draft: !newPublished, status: newPublished ? 'upcoming' : 'draft' });
      await refreshEvents();
      toast(newPublished ? 'Published' : 'Unpublished', 'success');
      renderOwnerEventsTabs();
      reloadBrowse(true);
      renderDashboardCounts();
    } catch(err){
      console.error(err);
      toast('Publish toggle failed: ' + (err.message||err), 'error');
    }
  }

  function initCreateEventForm(){
    const form = qs('#create-event-form');
    if(!form) return;
    if(form._createAttached) return;
    form._createAttached = true;

    const saveDraftBtn = qs('#save-draft');

    function validateFormFields(){
      const reqs = [
        { sel: '#event-name', msg: 'Event name' },
        { sel: '#description', msg: 'Description' },
        { sel: '#start-date', msg: 'Start date' },
        { sel: '#end-date', msg: 'End date' },
        { sel: '#location', msg: 'Location' },
        { sel: '#contact-email', msg: 'Contact email' }
      ];
      for(const r of reqs){
        const el = qs(r.sel);
        if(!el) return { ok:false, field:null, msg:`Missing field ${r.sel}` };
        if(String(el.value || '').trim() === '') return { ok:false, field:el, msg:`${r.msg} is required` };
      }
      const email = qs('#contact-email').value.trim();
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if(!emailRe.test(email)) return { ok:false, field: qs('#contact-email'), msg:'Enter a valid contact email' };
      const s = qs('#start-date').value; const e = qs('#end-date').value;
      if(s && e && new Date(s) > new Date(e)) return { ok:false, field: qs('#start-date'), msg:'Start date cannot be after end date' };
      return { ok:true, field:null };
    }

    saveDraftBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      if(!currentUser){ toast('Please login to save drafts','error'); return; }
      const payload = gatherFormData();
      const editing = sessionStorage.getItem('editing_event');
      try {
        if(editing){
          await SupabaseRest.updateEvent(editing, {
            event_name: payload.name,
            description: payload.description,
            startdate: payload.startDate || null,
            enddate: payload.endDate || null,
            contact_email: payload.contactEmail,
            tags: payload.tags.join ? payload.tags.join(',') : payload.tags,
            renewal: !!payload.renewalEnabled,
            status: 'draft',
            published: false,
            draft: true
          });
          sessionStorage.removeItem('editing_event');
          toast('Draft updated (saved to server)', 'success');
        } else {
          await SupabaseRest.createEvent({
            user_id: currentUser.id,
            event_name: payload.name,
            description: payload.description,
            startdate: payload.startDate || null,
            enddate: payload.endDate || null,
            contact_email: payload.contactEmail,
            tags: payload.tags.join ? payload.tags.join(',') : payload.tags,
            renewal: !!payload.renewalEnabled,
            status: 'draft',
            published: false,
            draft: true,
            created_at: new Date().toISOString()
          });
          toast('Draft saved (server)', 'success');
        }
        await refreshEvents();
        renderOwnerEventsTabs();
        renderDashboardCounts();
        reloadBrowse(true);
        await refreshSubsForUser(currentUser);
        showSection('my-event');
        form.reset();
        qs('#contact-email').value = `${currentUser.ntid}@Bosch.in`;
      } catch(err){
        console.error(err);
        toast('Save draft failed: ' + (err.message||err), 'error');
      }
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = validateFormFields();
      if(!v.ok){ toast(v.msg, 'error'); if(v.field) v.field.focus(); return; }
      if(!currentUser){ toast('Please login to publish', 'error'); return; }

      const payload = gatherFormData();
      const editing = sessionStorage.getItem('editing_event');
      try {
        if(editing){
          await SupabaseRest.updateEvent(editing, {
            event_name: payload.name,
            description: payload.description,
            startdate: payload.startDate || null,
            enddate: payload.endDate || null,
            contact_email: payload.contactEmail,
            tags: payload.tags.join ? payload.tags.join(',') : payload.tags,
            renewal: !!payload.renewalEnabled,
            status: 'upcoming',
            published: true,
            draft: false
          });
          sessionStorage.removeItem('editing_event');
          toast('Event updated & published', 'success');
        } else {
          await SupabaseRest.createEvent({
            user_id: currentUser.id,
            event_name: payload.name,
            description: payload.description,
            startdate: payload.startDate || null,
            enddate: payload.endDate || null,
            contact_email: payload.contactEmail,
            tags: payload.tags.join ? payload.tags.join(',') : payload.tags,
            renewal: !!payload.renewalEnabled,
            status: 'upcoming',
            published: true,
            draft: false,
            created_at: new Date().toISOString()
          });
          toast('Event published', 'success');
        }
        await refreshEvents();
        renderOwnerEventsTabs();
        renderDashboardCounts();
        reloadBrowse(true);
        form.reset();
        qs('#contact-email').value = `${currentUser.ntid}@Bosch.in`;
      } catch(err){
        console.error(err);
        toast('Publish failed: ' + (err.message||err), 'error');
      }
    });
  }

  function gatherFormData(){
    return {
      name: qs('#event-name').value.trim(),
      description: qs('#description').value.trim(),
      startDate: qs('#start-date').value || '',
      endDate: qs('#end-date').value || '',
      location: qs('#location').value.trim(),
      contactEmail: qs('#contact-email').value.trim() || `${currentUser.ntid}@Bosch.in`,
      tags: (qs('#tags').value || '').split(',').map(s => s.trim()).filter(Boolean),
      renewalEnabled: !!qs('#renewal').checked,
      visibility: (qs('[name="visibility"]:checked')||{}).value || 'private'
    };
  }

  // --- Browse / subscribe ---
  let browsePage = 1;
  const pageSize = 6;
  const loadMoreSize = 5;
  async function reloadBrowse(reset=true){
    if(reset) { browsePage = 1; const g = qs('#events-grid'); if(g) g.innerHTML=''; }
    const q = qs('#searchInput') ? qs('#searchInput').value.trim().toLowerCase() : '';
    const category = qs('#categoryFilter') ? qs('#categoryFilter').value : 'all';
    const status = qs('#statusFilter') ? qs('#statusFilter').value : 'all';
    const dateFrom = qs('#dateFrom') ? qs('#dateFrom').value : '';
    const dateTo = qs('#dateTo') ? qs('#dateTo').value : '';

    let items = getEvents().filter(e => e.published && !e.draft);
    if(q) items = items.filter(e => (e.name + ' ' + e.description + ' ' + (e.tags||[]).join(' ')).toLowerCase().includes(q));
    if(category !== 'all') items = items.filter(e => (e.tags||[]).includes(category));
    if(status !== 'all') items = items.filter(e => e.status === status);
    if(dateFrom) items = items.filter(e => e.startDate >= dateFrom);
    if(dateTo) items = items.filter(e => e.endDate <= dateTo);

    const start = (browsePage-1)*pageSize;
    let limit = (browsePage === 1) ? pageSize : loadMoreSize;
    const pageItems = items.slice(start, start + limit);
    renderBrowse(pageItems, reset);
  }

  function renderBrowse(items, reset=true){
    const grid = qs('#events-grid');
    if(!grid) return;
    if(reset) grid.innerHTML = '';
    if(!items || items.length===0){
      if(reset) grid.innerHTML = '<div class="empty-state">No events found. Try changing filters.</div>';
      return;
    }
    items.forEach(ev => {
      const card = document.createElement('article');
      card.className = 'event-card';
      card.innerHTML = `
        <h3 class="event-title">${escapeHtml(ev.name)}</h3>
        <div class="event-date">${escapeHtml(ev.startDate || '-')}</div>
        <div class="event-desc">${escapeHtml(ev.description || '')}</div>
        <div class="event-meta">${(ev.tags||[]).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="event-actions">
          <button class="subscribe-btn" data-id="${ev.id}">${'Subscribe'}</button>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  async function isSubscribed(eventId){
    const ev = getEvents().find(e => String(e.id) === String(eventId));
    if(!ev) return false;
    const subs = SUBS_CACHE.filter(s => s.event_name === ev.name);
    if(subs.length === 0 && currentUser){
      await refreshSubsForUser(currentUser);
    }
    return (SUBS_CACHE || []).some(s => s.event_name === ev.name && (s.subscriber_NTID === currentUser.id || (s.subscriber_email && s.subscriber_email.toLowerCase() === currentUser.email.toLowerCase())));
  }

  async function toggleSubscribe(eventId){
    if(!currentUser){
      const email = prompt('Enter your email to subscribe');
      if(!email) return toast('Email required', 'error');
      const ev = getEvents().find(e => e.id === eventId);
      if(!ev) return toast('Event not found', 'error');
      const existing = await SupabaseRest.fetchSubscriptionsByEventName(ev.name);
      const already = existing.some(s => s.subscriber_email && s.subscriber_email.toLowerCase() === email.toLowerCase());
      if(already){
        await SupabaseRest.unsubscribeByEmail(ev.name, email);
        toast('Unsubscribed', 'info');
      } else {
        await SupabaseRest.subscribeByEventName({ event_name: ev.name, subscriber_email: email, subscriber_NTID: null });
        toast

