/* app.js — Full integration with Power Automate (SharePoint)
   Replace FLOW_* placeholders below with your Power Automate HTTP URLs and API key.
*/

(() => {
  /* ================== CONFIG — REPLACE THESE ================== */
  const FLOW_API_KEY = 'BOSCH_Eventnotifier2025';
  const FLOW_CREATE_EVENT_URL = 'https://default0ae51e1907c84e4bbb6d648ee58410.f4.environment.api.powerplatform.com:443/powerautomat…';      // POST: create event (Flow A)
  const FLOW_GET_EVENTS_URL   = 'https://default0ae51e1907c84e4bbb6d648ee58410.f4.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/a50a4bdf221c4e4697e6e632cf33c117/triggers/manual/paths/invoke?api-version=1';      // GET or POST: returns all Events (Flow GET_EVENTS)
  const FLOW_SUBSCRIBE_URL    = 'https://default0ae51e1907c84e4bbb6d648ee58410.f4.environment.api.powerplatform.com:443/powerautomat…';       // POST: create subscription (Flow B)
  const FLOW_GET_SUBS_URL     = 'https://default0ae51e1907c84e4bbb6d648ee58410.f4.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/b0c9e8571e764beeb09ada0b57e53a05/triggers/manual/paths/invoke?api-version=1';        // GET/POST: fetch subscriptions for user (Flow GET_SUBS)
  const FLOW_UNSUBSCRIBE_URL  = 'PASTE_API_UNSUBSCRIBE_URL';     // POST: unsubscribe (Flow Unsubscribe)
  /* ========================================================== */

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

  /* ================== REST helpers for Power Automate ================== */
  async function paPost(url, body){
    if(!url) throw new Error('Missing Flow URL');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': FLOW_API_KEY
      },
      body: JSON.stringify(body || {})
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json().catch(()=>null) : await res.text().catch(()=>null);
    if(!res.ok){
      const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : JSON.stringify(data));
      const err = new Error(`Flow error ${res.status}: ${msg}`);
      err.status = res.status; err.body = data;
      throw err;
    }
    return data;
  }

  async function paGet(url){
    if(!url) throw new Error('Missing Flow URL');
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': FLOW_API_KEY
      }
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json().catch(()=>null) : await res.text().catch(()=>null);
    if(!res.ok){
      const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : JSON.stringify(data));
      const err = new Error(`Flow GET error ${res.status}: ${msg}`);
      err.status = res.status; err.body = data;
      throw err;
    }
    return data;
  }

  /* ================== Mapping between Flow responses and UI model ================== */
  function mapRowToUIEvent(r){
    // r is object from SharePoint/PowerAutomate flow
    if(!r) return null;
    // try to support both Title and event_name patterns
    const title = r.Title || r.event_name || r.Title0 || r.title;
    return {
      id: String(r.ID || r.id || title + '_' + (r.created_at||r.Created || Date.now())),
      ownerId: r.user_id || r.userId || (r.user_id || null),
      name: title || '',
      description: r.description || r.Description || '',
      startDate: r.startdate ? (new Date(r.startdate)).toISOString().slice(0,10) : (r.startDate || ''),
      endDate: r.enddate ? (new Date(r.enddate)).toISOString().slice(0,10) : (r.endDate || ''),
      status: r.status || '',
      tags: r.tags ? (Array.isArray(r.tags)? r.tags : String(r.tags).split(',').map(s=>s.trim()).filter(Boolean)) : [],
      contactEmail: r.contact_email || r.contactEmail || '',
      renewalEnabled: !!(r.renewal || r.Renewal),
      createdAt: r.created_at || r.Created || null,
      published: !!(r.published === true || r.published === 'true' || r.published === 1 || r.published === '1'),
      draft: !!(r.draft === true || r.draft === 'true' || r.draft === 1 || r.draft === '1'),
      location: r.location || '',
      subscriberIds: Array.isArray(r.subscriber_ids) ? r.subscriber_ids : []
    };
  }

  /* ================== In-memory caches (server-driven) ================== */
  let EVENTS_CACHE = []; // array of mapped UI events
  let SUBS_CACHE = [];   // raw subscription rows

  function getEvents(){ return EVENTS_CACHE; }
  function saveEvents(arr){ EVENTS_CACHE = Array.isArray(arr) ? arr : []; }
  function getSubs(){ return SUBS_CACHE; }
  function saveSubs(arr){ SUBS_CACHE = Array.isArray(arr) ? arr : []; }

  /* ================== Power Automate API wrappers ================== */

  // Create event (Flow A) - payload must match your Flow A schema
  async function apiCreateEvent(payload){
    // payload should contain: user_id, event_name (Title), description, startdate, enddate, contact_email, tags, renewal, published, draft, location, visibility, created_at, plus sent_reminder_* flags
    const res = await paPost(FLOW_CREATE_EVENT_URL, payload);
    // Flow returns created item representation; convert to UI event
    // Support returning { success:true, id:..., title:... } OR full item JSON
    if(Array.isArray(res) && res.length) return mapRowToUIEvent(res[0]);
    if(res && res.ID) return mapRowToUIEvent(res);
    return mapRowToUIEvent(res);
  }

  // Get events - expects flow to return array of rows
  async function apiGetEvents(){
    // Some flows are GET, some are POST. We try GET first, fallback to POST without body.
    if(!FLOW_GET_EVENTS_URL) throw new Error('FLOW_GET_EVENTS_URL not configured');
    try {
      const rows = await paGet(FLOW_GET_EVENTS_URL);
      if(!Array.isArray(rows)) return (Array.isArray(rows.value) ? rows.value.map(mapRowToUIEvent) : []);
      return rows.map(mapRowToUIEvent);
    } catch(err){
      // fallback: try POST without body (some flows require POST)
      const rows = await paPost(FLOW_GET_EVENTS_URL, {});
      if(Array.isArray(rows)) return rows.map(mapRowToUIEvent);
      if(Array.isArray(rows.value)) return rows.value.map(mapRowToUIEvent);
      return [];
    }
  }

  // Subscribe (Flow B) - returns created subscription
  async function apiSubscribe({ event_name, subscriber_email, subscriber_NTID=null, auto_renewal=true }){
    if(!FLOW_SUBSCRIBE_URL) throw new Error('FLOW_SUBSCRIBE_URL not configured');
    const payload = { event_name, subscriber_email, subscriber_NTID, auto_renewal };
    const res = await paPost(FLOW_SUBSCRIBE_URL, payload);
    return res;
  }

  // Get subscriptions for current user
  async function apiGetSubscriptionsForUser(ntid, email){
    if(!FLOW_GET_SUBS_URL) throw new Error('FLOW_GET_SUBS_URL not configured');
    // many GET flows accept query params or require POST body; we'll attempt POST body with ntid/email
    try {
      const rows = await paPost(FLOW_GET_SUBS_URL, { ntid, email });
      if(Array.isArray(rows)) return rows;
      if(Array.isArray(rows.value)) return rows.value;
      return [];
    } catch(err){
      // as fallback, try paGet
      try {
        const rows = await paGet(FLOW_GET_SUBS_URL);
        if(Array.isArray(rows)) return rows;
        if(Array.isArray(rows.value)) return rows.value;
      } catch(e){}
      return [];
    }
  }

  // Unsubscribe (Flow Unsubscribe) - receives { event_name, subscriber_email } and deletes items
  async function apiUnsubscribe(event_name, subscriber_email){
    if(!FLOW_UNSUBSCRIBE_URL) throw new Error('FLOW_UNSUBSCRIBE_URL not configured');
    const res = await paPost(FLOW_UNSUBSCRIBE_URL, { event_name, subscriber_email });
    return res;
  }

  /* ================== Refresh caches (called from UI) ================== */
  async function refreshEvents(){
    try {
      const rows = await apiGetEvents();
      EVENTS_CACHE = Array.isArray(rows) ? rows : [];
      // compute statuses
      EVENTS_CACHE.forEach(e => { e.status = computeStatus(e); });
      saveEvents(EVENTS_CACHE); // also save to LS for offline fallback (optional)
      return EVENTS_CACHE;
    } catch(err){
      console.error('refreshEvents error', err);
      // fallback: if we have LS cached events keep them
      try { EVENTS_CACHE = (LS.get('events') || []).map(mapRowToUIEvent); return EVENTS_CACHE; } catch(e){}
      EVENTS_CACHE = []; return EVENTS_CACHE;
    }
  }

  async function refreshSubsForUser(currentUserParam){
    if(!currentUserParam) { SUBS_CACHE = []; return []; }
    try {
      const ntid = currentUserParam.id || '';
      const email = currentUserParam.email || '';
      const rows = await apiGetSubscriptionsForUser(ntid, email);
      SUBS_CACHE = Array.isArray(rows) ? rows : [];
      saveSubs(SUBS_CACHE); // persist locally for UI fallback
      return SUBS_CACHE;
    } catch(err){
      console.error('refreshSubsForUser error', err);
      try { SUBS_CACHE = LS.get('subscriptions') || []; return SUBS_CACHE; } catch(e){}
      SUBS_CACHE = []; return SUBS_CACHE;
    }
  }

  /* ================== UI logic (preserves your original flow and selectors) ================== */

  // Dashboard counts & owner events rendering (uses caches)
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

  function renderOwnerEventsTabs(){
    const container = qs('#owner-events');
    if(!container) return;
    const all = getEvents();
    all.forEach(e => { e.status = computeStatus(e); });
    const events = currentUser ? all.filter(e => e.ownerId === currentUser.id) : [];
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
    // TODO: implement API delete flow when available. For now we remove from cache and request a re-fetch.
    EVENTS_CACHE = EVENTS_CACHE.filter(e => String(e.id) !== String(id));
    saveEvents(EVENTS_CACHE);
    toast('Event removed locally. (Implement server delete flow to remove from SharePoint)', 'info');
    renderOwnerEventsTabs();
    reloadBrowse(true);
    await refreshSubsForUser(currentUser);
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
    // This toggles locally and suggests sending an update to server when update flow exists
    const idx = EVENTS_CACHE.findIndex(e => String(e.id) === String(id) && e.ownerId === currentUser.id);
    if(idx === -1) { toast('Not found or unauthorized', 'error'); return; }
    EVENTS_CACHE[idx].published = !EVENTS_CACHE[idx].published;
    EVENTS_CACHE[idx].draft = !EVENTS_CACHE[idx].published;
    EVENTS_CACHE[idx].status = computeStatus(EVENTS_CACHE[idx]);
    if(EVENTS_CACHE[idx].published) EVENTS_CACHE[idx]._lastPublishedAt = new Date().toISOString();
    saveEvents(EVENTS_CACHE);
    toast(EVENTS_CACHE[idx].published ? 'Published' : 'Unpublished', 'success');
    renderOwnerEventsTabs();
    reloadBrowse(true);
    renderDashboardCounts();
    // TODO: if you create API_UpdateEvent, call it here to persist publish toggle to SharePoint
  }

  /* ================== Create form (calls apiCreateEvent) ================== */
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
      // Build DB payload for Flow A (match your Flow schema)
      const dbPayload = {
        user_id: currentUser.id,
        event_name: payload.name,
        description: payload.description || null,
        startdate: payload.startDate || null,
        enddate: payload.endDate || null,
        contact_email: payload.contactEmail,
        tags: payload.tags.join ? payload.tags.join(',') : payload.tags,
        renewal: !!payload.renewalEnabled,
        status: 'draft',
        published: false,
        draft: true,
        location: payload.location || null,
        visibility: payload.visibility || 'private',
        created_at: new Date().toISOString(),
        sent_reminder_7: false,
        sent_reminder_3: false,
        sent_reminder_1: false,
        sent_reminder_0: false,
        sent_notifications: false
      };

      try {
        await apiCreateEvent(dbPayload);
        toast('Draft saved to server', 'success');
        // refresh cache
        try { await refreshEvents(); } catch(e){ console.warn('refreshEvents after saveDraft:', e); }
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
      // Build DB payload for publish
      const dbPayload = {
        user_id: currentUser.id,
        event_name: payload.name,
        description: payload.description || null,
        startdate: payload.startDate || null,
        enddate: payload.endDate || null,
        contact_email: payload.contactEmail,
        tags: payload.tags.join ? payload.tags.join(',') : payload.tags,
        renewal: !!payload.renewalEnabled,
        status: 'upcoming',
        published: true,
        draft: false,
        location: payload.location || null,
        visibility: payload.visibility || 'private',
        created_at: new Date().toISOString(),
        sent_reminder_7: false,
        sent_reminder_3: false,
        sent_reminder_1: false,
        sent_reminder_0: false,
        sent_notifications: false
      };

      try {
        await apiCreateEvent(dbPayload);
        toast('Event published', 'success');
        try { await refreshEvents(); } catch(e){ console.warn('refreshEvents after publish:', e); }
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
      contactEmail: qs('#contact-email').value.trim() || `${currentUser?currentUser.ntid:'guest'}@Bosch.in`,
      tags: (qs('#tags') ? qs('#tags').value : '').split(',').map(s => s.trim()).filter(Boolean),
      renewalEnabled: !!(qs('#renewal') && qs('#renewal').checked),
      visibility: (qs('[name="visibility"]:checked')||{}).value || 'private'
    };
  }

  /* ================== Browse & subscribe logic ================== */
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

    // ensure fresh events
    try { await refreshEvents(); } catch(e){ /* ignore: will render cached */ }

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
      const subscribed = isSubscribed(ev.id);
      card.innerHTML = `
        <h3 class="event-title">${escapeHtml(ev.name)}</h3>
        <div class="event-date">${escapeHtml(ev.startDate || '-')}</div>
        <div class="event-desc">${escapeHtml(ev.description || '')}</div>
        <div class="event-meta">${(ev.tags||[]).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="event-actions">
          <button class="subscribe-btn ${subscribed ? 'subscribed' : ''}" data-id="${ev.id}">${subscribed ? 'Subscribed' : 'Subscribe'}</button>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function isSubscribed(eventId){
    if(!currentUser) return false;
    // check cached subs
    return (SUBS_CACHE || []).some(s => s.event_name && s.event_name === (getEvents().find(e => String(e.id) === String(eventId))||{}).name && (s.subscriber_NTID === currentUser.id || (s.subscriber_email && s.subscriber_email.toLowerCase() === currentUser.email.toLowerCase())));
  }

  async function toggleSubscribe(eventId){
    const ev = getEvents().find(e => String(e.id) === String(eventId));
    if(!ev) return toast('Event not found', 'error');
    // determine user/email
    let email = null; let ntid = null;
    if(currentUser){ email = currentUser.email; ntid = currentUser.id; }
    else {
      email = prompt('Enter your email to subscribe');
      if(!email) return toast('Email required', 'error');
    }

    // check existing subscription for this event
    await refreshSubsForUser(currentUser); // ensure up-to-date
    const existing = SUBS_CACHE.filter(s => s.event_name === ev.name);
    const already = existing.some(s => (s.subscriber_NTID && s.subscriber_NTID === ntid) || (s.subscriber_email && s.subscriber_email.toLowerCase() === email.toLowerCase()));
    try {
      if(already){
        // call unsubscribe flow
        await apiUnsubscribe(ev.name, email);
        toast('Unsubscribed', 'info');
      } else {
        await apiSubscribe({ event_name: ev.name, subscriber_email: email, subscriber_NTID: ntid, auto_renewal: false });
        toast('Subscribed — confirmation email will arrive shortly', 'success');
      }
      // refresh caches & UI
      await refreshSubsForUser(currentUser);
      await refreshEvents();
      renderOwnerEventsTabs();
      loadMySubscriptions();
      reloadBrowse(true);
    } catch(err){
      console.error(err);
      toast('Subscribe/Unsubscribe failed: ' + (err.message||err), 'error');
    }
  }

  /* ================== My subscriptions UI ================== */
  async function loadMySubscriptions(){
    const container = qs('#subscription-list');
    if(!container) return;
    if(!currentUser) { container.innerHTML = '<div class="empty-state">Login to see subscriptions</div>'; return; }
    try {
      await refreshSubsForUser(currentUser);
      const subs = SUBS_CACHE.filter(s => s.subscriber_NTID === currentUser.id || (s.subscriber_email && s.subscriber_email.toLowerCase() === currentUser.email.toLowerCase()));
      if(!subs || subs.length === 0){ container.innerHTML = '<div class="empty-state">No subscriptions yet.</div>'; return; }
      const rows = subs.map(s => {
        const ev = getEvents().find(e => e.name === s.event_name) || { name:'(deleted)', endDate:'-', status:'expired' };
        const statusClass = ev.status==='expired' ? 'status-expired' : (ev.status==='upcoming' ? 'status-warning' : 'status-active');
        return `<div class="subs-row" data-id="${s.id}" data-eventid="${ev.id}">
          <div class="col event-name">${escapeHtml(ev.name)}</div>
          <div class="col renewal">${escapeHtml(ev.endDate||'-')}</div>
          <div class="col status"><span class="status-badge ${statusClass}">${escapeHtml(ev.status||'Active')}</span></div>
          <div class="col autorenew">${s.auto_renewal? 'Yes':'No'}</div>
          <div class="col actions"><button class="btn btn-outline btn-sm unsub-btn" data-eventname="${escapeHtml(s.event_name)}" data-subscriber="${escapeHtml(s.subscriber_email||s.subscriber_NTID)}">Unsubscribe</button></div>
        </div>`;
      }).join('');
      container.innerHTML = rows;
      container.querySelectorAll('.unsub-btn').forEach(b => b.addEventListener('click', async ()=> {
        if(!confirm('Unsubscribe?')) return;
        const eventName = b.dataset.eventname;
        const subscriber = b.dataset.subscriber;
        try {
          await apiUnsubscribe(eventName, currentUser.email || subscriber);
          toast('Unsubscribed', 'info');
          await refreshSubsForUser(currentUser);
          await refreshEvents();
          renderOwnerEventsTabs(); renderDashboardCounts();
        } catch(err){
          console.error(err);
          toast('Unable to unsubscribe: ' + (err.message||err), 'error');
        }
      }));
    } catch(err){
      console.error(err);
      container.innerHTML = '<div class="empty-state">Unable to load subscriptions</div>';
    }
  }

  /* ================== Navigation, tabs, login (same UX) ================== */
  function wireNav(){
    qsa('.nav-links a').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); showSection(a.dataset.target); }));
    qsa('.create-btn').forEach(b => b.addEventListener('click', ()=> showSection('create-event')));
    const profile = qs('#profile-btn');
    if(profile) profile.addEventListener('click', ()=> { if(confirm('Logout?')) { logoutFlow(); } });
  }

  function showSection(id){
    qsa('section').forEach(s => s.classList.remove('active'));
    const sec = qs('#' + id);
    if(sec) sec.classList.add('active');
    qsa('.nav-links a').forEach(a => a.classList.toggle('active', a.dataset.target === id));
    setTimeout(()=> {
      if(id === 'dashboard'){
        window.scrollTo({ top: 0, behavior: 'instant' });
        const main = document.querySelector('main');
        if(main && typeof main.scrollTo === 'function') main.scrollTo({ top: 0 });
      } else {
        sec && sec.focus();
      }
    }, 60);
    if(id === 'my-event') {
      qsa('.my-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === 'tab-active');
        btn.setAttribute('aria-selected', btn.dataset.tab === 'tab-active' ? 'true' : 'false');
      });
      renderOwnerEventsTabs();
    }
  }

  function wireMyEventTabs(){
    qsa('.my-tab').forEach(btn => btn.addEventListener('click', () => {
      qsa('.my-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected','true');
      const which = btn.dataset.tab;
      const panelActive = qs('#panel-active'); const panelDrafts = qs('#panel-drafts'); const panelExpired = qs('#panel-expired');
      if(!panelActive || !panelDrafts || !panelExpired) return;
      panelActive.classList.toggle('active', which === 'tab-active');
      panelDrafts.classList.toggle('active', which === 'tab-drafts');
      panelExpired.classList.toggle('active', which === 'tab-expired');
    }));
  }

  // --- Login flow (keeps your local NTID logic) ---
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

  function loginWithNTID(ntid, remember=false){
    if(!ntid) { toast('Enter NTID', 'error'); return; }
    let users = LS.get('users') || [];
    let user = users.find(u => u.ntid.toLowerCase() === ntid.toLowerCase());
    if(!user){
      user = { id: 'u_' + ntid.toLowerCase(), ntid, displayName: ntid, email: `${ntid}@Bosch.in` };
      users.push(user); LS.set('users', users);
    }
    setSession({ id: user.id, ntid: user.ntid, email: user.email, displayName: user.displayName });
    if(remember) localStorage.setItem(LS.key('remember_ntid'), user.ntid);

    const lp = document.getElementById('login-page'); const mw = document.getElementById('main-website');
    if(lp) lp.style.display='none'; if(mw) mw.style.display='block'; document.body.classList.remove('login-active');
    qs('#user-greeting').textContent = user.ntid;
    qs('#contact-email').value = `${user.ntid}@Bosch.in`;
    showSection('dashboard');
    window.scrollTo({ top: 0, behavior: 'instant' });

    // initialize data from server
    (async () => {
      try { await refreshEvents(); } catch(e){ console.warn('refreshEvents login:', e); }
      try { await refreshSubsForUser(currentUser); } catch(e){ console.warn('refreshSubsForUser login:', e); }
      renderDashboardCounts(); renderOwnerEventsTabs(); initCreateEventForm(); initOwnerEventsDelegation(); wireMyEventTabs(); loadMySubscriptions(); reloadBrowse(true);
    })();

    toast(`Welcome ${user.ntid}`, 'success', 1600);
  }

  function logoutFlow(){
    clearSession();
    const lp = document.getElementById('login-page'); const mw = document.getElementById('main-website');
    if(lp) lp.style.display='flex'; if(mw) mw.style.display='none';
    document.body.classList.add('login-active');
  }

  /* ================== Boot / wiring ================== */
  function seedIfEmpty(){
    if(!LS.get('users')) LS.set('users', [{ id:'u_demo', ntid:'demo', displayName:'demo', email:'demo@Bosch.in' }]);
  }

  function initBrowseHandlers(){
    const s = qs('#searchInput'); if(s) s.addEventListener('input', debounce(()=> reloadBrowse(true), 300));
    const cat = qs('#categoryFilter'); if(cat) cat.addEventListener('change', ()=> reloadBrowse(true));
    const st = qs('#statusFilter'); if(st) st.addEventListener('change', ()=> reloadBrowse(true));
    const df = qs('#dateFrom'); if(df) df.addEventListener('change', ()=> reloadBrowse(true));
    const dt = qs('#dateTo'); if(dt) dt.addEventListener('change', ()=> reloadBrowse(true));
    const clear = qs('#clearFilters'); if(clear) clear.addEventListener('click', ()=> { if(qs('#searchInput')) qs('#searchInput').value=''; if(qs('#categoryFilter')) qs('#categoryFilter').value='all'; if(qs('#statusFilter')) qs('#statusFilter').value='all'; if(qs('#dateFrom')) qs('#dateFrom').value=''; if(qs('#dateTo')) qs('#dateTo').value=''; reloadBrowse(true); });
    const loadMore = qs('#loadMore'); if(loadMore) loadMore.addEventListener('click', ()=> { browsePage++; reloadBrowse(false); });
    const grid = qs('#events-grid'); if(grid) grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.subscribe-btn'); if(!btn) return;
      (async ()=> {
        await toggleSubscribe(btn.dataset.id);
        const sub = isSubscribed(btn.dataset.id);
        btn.classList.toggle('subscribed', sub);
        btn.textContent = sub ? 'Subscribed' : 'Subscribe';
      })();
    });
  }
  function debounce(fn, t=200){ let to=null; return (...a)=>{ clearTimeout(to); to=setTimeout(()=>fn(...a), t); }; }

  async function boot(){
    seedIfEmpty();
    loadSession();

    // if remembered NTID -> auto login
    const rem = localStorage.getItem(LS.key('remember_ntid'));
    if(rem && !currentUser) { loginWithNTID(rem, true); return; }

    if(currentUser){
      const lp = document.getElementById('login-page'); const mw = document.getElementById('main-website');
      if(lp) lp.style.display='none'; if(mw) mw.style.display='block'; document.body.classList.remove('login-active');
      qs('#user-greeting').textContent = currentUser.ntid;
      qs('#contact-email').value = `${currentUser.ntid}@Bosch.in`;
      try { await refreshEvents(); } catch(e){ console.warn('initial refreshEvents', e); }
      try { await refreshSubsForUser(currentUser); } catch(e){ console.warn('initial refreshSubsForUser', e); }
      renderDashboardCounts(); renderOwnerEventsTabs(); initCreateEventForm(); initOwnerEventsDelegation(); wireMyEventTabs(); loadMySubscriptions(); reloadBrowse(true);
    } else {
      const lp = document.getElementById('login-page'); const mw = document.getElementById('main-website');
      if(lp) lp.style.display='flex'; if(mw) mw.style.display='none'; document.body.classList.add('login-active');
    }

    // login button
    const loginBtn = qs('#login-btn');
    if(loginBtn) loginBtn.addEventListener('click', (e)=> { e.preventDefault(); const ntid = qs('#ntid').value.trim(); const remember = !!qs('#remember').checked; if(!ntid) return toast('Please enter NTID', 'error'); loginWithNTID(ntid, remember); });

    wireNav();
    initBrowseHandlers();
    initCreateEventForm();
    initOwnerEventsDelegation();
    wireMyEventTabs();
  }

  // route view-all header links
  qsa('.panel-header .view-all').forEach(v => {
    v.addEventListener('click', e => {
      e.preventDefault();
      const type = v.dataset.open;
      if (type === 'renewals') showSection('my-event');
      if (type === 'recent-subs') showSection('my-subscription');
    });
  });

  // profile dropdown
  const pd = qs('#profile-dropdown');
  const pb = qs('#profile-btn');
  if(pb) {
    pb.addEventListener('click', (e)=>{ e.stopPropagation(); pd && pd.classList.toggle('hidden'); if(currentUser) qs('#pd-ntid').textContent = currentUser.ntid + "@Bosch.com"; });
  }
  document.addEventListener('click', ()=> pd && pd.classList.add('hidden') );

  // logout
  const logoutBtn = qs('.logout-btn');
  if(logoutBtn) {
    logoutBtn.addEventListener('click', ()=>{ if(confirm("Are you sure you want to logout?")) logoutFlow(); });
  }

  document.addEventListener('DOMContentLoaded', () => { boot().catch(e => console.error('boot error', e)); });

  // debug helpers
  window.EN = {
    apiCreateEvent, apiGetEvents, apiSubscribe, apiGetSubscriptionsForUser, apiUnsubscribe,
    refreshEvents, refreshSubsForUser, getEvents, getSubs
  };

})(); // IIFE end


