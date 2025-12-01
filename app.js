/* ------------------------------------------------------------------
   app.js - Supabase-backed Event Notifier
   Uses Supabase (SDK v2 if available, otherwise REST fallback).
   Replace your existing app.js with this file.
   ------------------------------------------------------------------ */

const SUPABASE_URL = "https://ridhgyfcgmsevazuzkkb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpZGhneWZjZ21zZXZhenV6a2tiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMTMwMjEsImV4cCI6MjA3OTY4OTAyMX0.ajifKz-8Xgnp_PtNEcTGZviLhczA8WAlyti-rStvq9E";

(() => {

   // near top of your app.js
const FORCE_REST = true;

function initSupabaseClient(){
  if(FORCE_REST) return null; // always use REST fallback
  // ...existing init logic...
}

  /* ----------------- Utilities & Toasts ----------------- */
  const STORAGE_PREFIX = 'enotifier_';
  const LS = {
    key(k){ return STORAGE_PREFIX + k; },
    get(k){ try { return JSON.parse(localStorage.getItem(this.key(k))); } catch(e){ return null; } },
    set(k,v){ localStorage.setItem(this.key(k), JSON.stringify(v)); },
    remove(k){ localStorage.removeItem(this.key(k)); }
  };

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

  /* ----------------- Supabase init + REST fallback ----------------- */
  let supabaseClient = null;
  function initSupabaseClient(){
    if(supabaseClient) return supabaseClient;
    try {
      const createClientFn = (window.supabaseJs && window.supabaseJs.createClient) || (window.supabase && window.supabase.createClient);
      if(createClientFn){
        supabaseClient = createClientFn(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, detectSessionInUrl: false }
        });
        return supabaseClient;
      }
    } catch(err){
      console.warn('Supabase SDK init error, falling back to REST:', err);
      supabaseClient = null;
    }
    return null;
  }

  // Generic REST helper for Supabase table endpoints
  async function restRequest(path, method='GET', body=null, params=''){
    const base = SUPABASE_URL.replace(/\/$/,'') + '/rest/v1/' + path;
    const q = params ? (params.startsWith('?') ? params : '?' + params) : '';
    const url = base + q;
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    };
    const opts = { method, headers, credentials: 'omit' };
    if(body !== null) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if(!res.ok){
      const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : JSON.stringify(data));
      const err = new Error(`Supabase REST error ${res.status}: ${msg}`);
      err.status = res.status; err.body = data;
      throw err;
    }
    return data;
  }

  // Map DB row to UI-friendly event
  function mapRowToUIEvent(r){
    return {
      id: String(r.id),
      ownerId: r.user_id,
      name: r.event_name || '',
      description: r.description || '',
      startDate: r.startdate ? (new Date(r.startdate)).toISOString().slice(0,10) : '',
      endDate: r.enddate ? (new Date(r.enddate)).toISOString().slice(0,10) : '',
      status: r.status || '',
      tags: r.tags ? (String(r.tags).split(',').map(s=>s.trim()).filter(Boolean)) : [],
      contactEmail: r.contact_email || '',
      renewalEnabled: !!r.renewal,
      createdAt: r.created_at,
      published: !!r.published,
      draft: !!r.draft,
      location: r.location || '',
      subscriberIds: r.subscriber_ids || []
    };
  }

  const SupabaseHelper = (function(){
    async function fetchEvents({ onlyUpcoming=false, limit=1000 } = {}){
      const client = initSupabaseClient();
      if(client){
        try {
          let q = client.from('Events').select('*').order('startdate', { ascending: true }).limit(limit);
          if(onlyUpcoming){
            const today = new Date().toISOString().slice(0,10);
            q = q.gte('startdate', today);
          }
          const { data, error } = await q;
          if(error) throw error;
          return (data||[]).map(mapRowToUIEvent);
        } catch(err){
          console.warn('Supabase SDK fetchEvents failed, falling back to REST:', err);
        }
      }
      // REST fallback
      let params = `select=*&order=startdate.asc&limit=${limit}`;
      if(onlyUpcoming){
        const today = new Date().toISOString().slice(0,10);
        params += `&startdate=gte.${today}`;
      }
      const data = await restRequest('Events', 'GET', null, params);
      return (Array.isArray(data) ? data : []).map(mapRowToUIEvent);
    }

    async function createEvent(payload){
      const client = initSupabaseClient();
      if(client){
        try {
          const { data, error } = await client.from('Events').insert([payload]).select().single();
          if(error) throw error;
          return mapRowToUIEvent(data);
        } catch(err){
          console.warn('Supabase SDK createEvent failed, falling back to REST:', err);
        }
      }
      // REST fallback - request representation
      const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/Events?select=*`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify([payload])
      });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : await res.text();
      if(!res.ok){
        const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : JSON.stringify(data));
        const err = new Error(`Supabase REST error ${res.status}: ${msg}`);
        err.status = res.status; err.body = data;
        throw err;
      }
      const row = Array.isArray(data) ? data[0] : data;
      return mapRowToUIEvent(row);
    }

    async function updateEvent(id, payload){
      const client = initSupabaseClient();
      if(client){
        try {
          const { data, error } = await client.from('Events').update(payload).eq('id', id).select().single();
          if(error) throw error;
          return mapRowToUIEvent(data);
        } catch(err){
          console.warn('Supabase SDK updateEvent failed, falling back to REST:', err);
        }
      }
      // REST fallback via PATCH + Prefer
      const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/Events?id=eq.${encodeURIComponent(id)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(payload)
      });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : await res.text();
      if(!res.ok){
        const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : JSON.stringify(data));
        const err = new Error(`Supabase REST update error ${res.status}: ${msg}`);
        err.status = res.status; err.body = data;
        throw err;
      }
      const row = Array.isArray(data) ? data[0] : data;
      return mapRowToUIEvent(row);
    }

    async function deleteEvent(id){
      const client = initSupabaseClient();
      if(client){
        try {
          const { error } = await client.from('Events').delete().eq('id', id);
          if(error) throw error;
          return true;
        } catch(err){
          console.warn('Supabase SDK deleteEvent failed, falling back to REST:', err);
        }
      }
      const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/Events?id=eq.${encodeURIComponent(id)}`;
      const res = await fetch(url, { method:'DELETE', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
      if(!res.ok){
        const txt = await res.text().catch(()=>null);
        throw new Error('Delete failed: ' + res.status + ' ' + txt);
      }
      return true;
    }

    // Subscriptions
    async function fetchSubscriptionsByEventName(eventName){
      const client = initSupabaseClient();
      if(client){
        try {
          const { data, error } = await client.from('subscriptions').select('*').eq('event_name', eventName);
          if(error) throw error;
          return (data||[]);
        } catch(err){
          console.warn('SDK fetchSubscriptionsByEventName failed, falling back to REST:', err);
        }
      }
      const params = `select=*&event_name=eq.${encodeURIComponent(eventName)}`;
      const data = await restRequest('subscriptions','GET', null, params);
      return Array.isArray(data) ? data : [];
    }

    async function subscribeByEventName({ event_name, subscriber_email, subscriber_NTID=null, auto_renewal=true }){
      const client = initSupabaseClient();
      const payload = { event_name, subscriber_email, subscriber_NTID, auto_renewal, created_at: new Date().toISOString() };
      if(client){
        try {
          const { data, error } = await client.from('subscriptions').insert([payload]).select().single();
          if(error) throw error;
          return data;
        } catch(err){
          console.warn('SDK subscribeByEventName failed, falling back to REST:', err);
        }
      }
      const data = await restRequest('subscriptions', 'POST', [payload], 'select=*');
      return Array.isArray(data) ? data[0] : data;
    }

    async function unsubscribeByEmail(event_name, subscriber_email){
      const client = initSupabaseClient();
      if(client){
        try {
          // delete where event_name and subscriber_email match
          const { data, error } = await client.from('subscriptions').delete().match({ event_name, subscriber_email }).select();
          if(error) throw error;
          return data;
        } catch(err){
          console.warn('SDK unsubscribeByEmail failed, falling back to REST:', err);
        }
      }
      // REST fallback: find ids then delete
      const subs = await fetchSubscriptionsByEventName(event_name);
      const toDelete = subs.filter(s => (s.subscriber_email && s.subscriber_email.toLowerCase() === String(subscriber_email||'').toLowerCase()));
      if(toDelete.length === 0) return [];
      const ids = toDelete.map(d => d.id);
      const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/subscriptions?id=in.(${ids.map(i=>encodeURIComponent(i)).join(',')})`;
      const res = await fetch(url, { method:'DELETE', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
      if(!res.ok){ const txt = await res.text().catch(()=>null); throw new Error('Unsubscribe failed: ' + res.status + ' ' + txt); }
      return toDelete;
    }

    async function fetchSubscriptionsForUserNTIDOrEmail(ntid, email){
      const client = initSupabaseClient();
      if(client){
        try {
          const { data, error } = await client.from('subscriptions').select('*').or(`subscriber_NTID.eq.${ntid},subscriber_email.eq.${email}`);
          if(error) throw error;
          return data || [];
        } catch(err){
          console.warn('SDK fetchSubscriptionsForUserNTIDOrEmail failed, falling back to REST:', err);
        }
      }
      const conditions = `or=(subscriber_NTID.eq.${encodeURIComponent(ntid)},subscriber_email.eq.${encodeURIComponent(email)})&select=*`;
      const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/subscriptions?${conditions}`;
      const res = await fetch(url, { method:'GET', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
      if(!res.ok){ const txt = await res.text().catch(()=>null); throw new Error('Failed to load subs: ' + res.status + ' ' + txt); }
      const data = await res.json();
      return data || [];
    }

    return {
      fetchEvents,
      createEvent,
      updateEvent,
      deleteEvent,
      fetchSubscriptionsByEventName,
      subscribeByEventName,
      unsubscribeByEmail,
      fetchSubscriptionsForUserNTIDOrEmail,
      _raw: () => supabaseClient
    };
  })();

  /* ------------------- App UI + logic (uses SupabaseHelper) ------------------- */

  let EVENTS_CACHE = [];
  let SUBS_CACHE = [];

  function getEvents(){ return EVENTS_CACHE; }
  function saveEvents(arr){ EVENTS_CACHE = Array.isArray(arr)?arr:[]; }

  async function refreshEvents(){
    try {
      const rows = await SupabaseHelper.fetchEvents({ onlyUpcoming:false, limit:1000 });
      EVENTS_CACHE = rows;
      return EVENTS_CACHE;
    } catch(e){
      console.error('refreshEvents error', e);
      EVENTS_CACHE = [];
      throw e;
    }
  }

  async function refreshSubsForUser(currentUserParam){
    if(!currentUserParam) { SUBS_CACHE = []; return []; }
    try {
      const ntid = currentUserParam.id || '';
      const email = currentUserParam.email || '';
      const rows = await SupabaseHelper.fetchSubscriptionsForUserNTIDOrEmail(ntid, email);
      SUBS_CACHE = rows;
      return SUBS_CACHE;
    } catch(e){
      console.error('refreshSubsForUser error', e);
      SUBS_CACHE = [];
      return [];
    }
  }

  // --- UI + session ---
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

  // Rendering functions (same markup you had)
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
    const container = qs('#owner-events'); if(!container) return;
    const all = getEvents();
    all.forEach(e => { e.status = computeStatus(e); });
    // persist small change locally in cache only (not to DB)
    saveEvents(all);

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

  // Delegation for owner events
  function initOwnerEventsDelegation(){
    const container = qs('#owner-events'); if(!container) return;
    if(container._eventsDelegationAttached) return;
    container._eventsDelegationAttached = true;

    container.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-action]'); if(!btn) return;
      const row = btn.closest('.events-row'); if(!row) return;
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
      await SupabaseHelper.deleteEvent(id);
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
      const dbPayload = { published: newPublished, draft: !newPublished, status: newPublished ? 'upcoming' : 'draft' };
      await SupabaseHelper.updateEvent(id, dbPayload);
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

  // Create form wiring
  function initCreateEventForm(){
    const form = qs('#create-event-form'); if(!form) return;
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
        // Map to DB columns
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
          created_at: new Date().toISOString()
        };

        if(editing){
          await SupabaseHelper.updateEvent(editing, dbPayload);
          sessionStorage.removeItem('editing_event');
          toast('Draft updated (saved to server)', 'success');
        } else {
          await SupabaseHelper.createEvent(dbPayload);
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
          created_at: new Date().toISOString()
        };

        if(editing){
          await SupabaseHelper.updateEvent(editing, dbPayload);
          sessionStorage.removeItem('editing_event');
          toast('Event updated & published', 'success');
        } else {
          await SupabaseHelper.createEvent(dbPayload);
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
      tags: (qs('#tags') ? qs('#tags').value : '').split(',').map(s => s.trim()).filter(Boolean),
      renewalEnabled: !!(qs('#renewal') && qs('#renewal').checked),
      visibility: (qs('[name="visibility"]:checked')||{}).value || 'private'
    };
  }

  // Browse / subscribe
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

    // ensure we have latest from DB
    try { await refreshEvents(); } catch(e){ console.warn('reloadBrowse: failed refreshEvents', e); }

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
    const grid = qs('#events-grid'); if(!grid) return;
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
      try {
        const existing = await SupabaseHelper.fetchSubscriptionsByEventName(ev.name);
        const already = existing.some(s => s.subscriber_email && s.subscriber_email.toLowerCase() === email.toLowerCase());
        if(already){
          await SupabaseHelper.unsubscribeByEmail(ev.name, email);
          toast('Unsubscribed', 'info');
        } else {
          await SupabaseHelper.subscribeByEventName({ event_name: ev.name, subscriber_email: email, subscriber_NTID: null });
          toast('Subscribed (by email)', 'success');
        }
      } catch(err){
        console.error(err);
        toast('Subscribe error: ' + (err.message||err), 'error');
      }
    } else {
      const ev = getEvents().find(e => String(e.id) === String(eventId));
      if(!ev) return toast('Event not found', 'error');
      try {
        const existing = await SupabaseHelper.fetchSubscriptionsByEventName(ev.name);
        const already = existing.some(s => s.subscriber_NTID === currentUser.id || (s.subscriber_email && s.subscriber_email.toLowerCase() === currentUser.email.toLowerCase()));
        if(already){
          await SupabaseHelper.unsubscribeByEmail(ev.name, currentUser.email);
          toast('Unsubscribed', 'info');
        } else {
          await SupabaseHelper.subscribeByEventName({ event_name: ev.name, subscriber_email: currentUser.email, subscriber_NTID: currentUser.id });
          toast('Subscribed', 'success');
        }
      } catch(err){
        console.error(err);
        toast('Subscribe failed: ' + (err.message||err), 'error');
      }
    }

    await refreshEvents();
    await refreshSubsForUser(currentUser);
    renderOwnerEventsTabs();
    loadMySubscriptions();
    reloadBrowse(true);
  }

  // My subscriptions load
  async function loadMySubscriptions(){
    const container = qs('#subscription-list'); if(!container) return;
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
          await SupabaseHelper.unsubscribeByEmail(eventName, currentUser.email || subscriber);
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

  // Navigation, tabs, login, wiring
  function wireNav(){
    qsa('.nav-links a').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); showSection(a.dataset.target); }));
    qsa('.create-btn').forEach(b => b.addEventListener('click', ()=> showSection('create-event')));
    const profile = qs('#profile-btn');
    if(profile) profile.addEventListener('click', ()=> { if(confirm('Logout?')) { logoutFlow(); } });
  }

  function showSection(id){
    qsa('section').forEach(s => s.classList.remove('active'));
    const sec = qs('#' + id); if(sec) sec.classList.add('active');
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
    if(lp) lp.style.display='none';
    if(mw) mw.style.display='block';
    document.body.classList.remove('login-active');
    qs('#user-greeting').textContent = user.ntid;
    qs('#contact-email').value = `${user.ntid}@Bosch.in`;
    showSection('dashboard');

    (async () => {
      try { await refreshEvents(); } catch(e){ console.warn('refreshEvents on login:', e); }
      try { await refreshSubsForUser(currentUser); } catch(e){ console.warn('refreshSubsForUser on login:', e); }
      renderDashboardCounts(); renderOwnerEventsTabs(); initCreateEventForm(); initOwnerEventsDelegation(); wireMyEventTabs(); loadMySubscriptions(); reloadBrowse(true);
    })();

    toast(`Welcome ${user.ntid}`, 'success', 1600);
  }

  function logoutFlow(){
    clearSession();
    const lp = document.getElementById('login-page'); const mw = document.getElementById('main-website');
    if(lp) lp.style.display='flex';
    if(mw) mw.style.display='none';
    document.body.classList.add('login-active');
  }

  // Browse handlers wiring
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
      (async () => {
        await toggleSubscribe(btn.dataset.id);
        // update button state visually
        const isSub = await isSubscribed(btn.dataset.id);
        btn.classList.toggle('subscribed', isSub);
        btn.textContent = isSub ? 'Subscribed' : 'Subscribe';
      })();
    });
  }
  function debounce(fn, t=200){ let to=null; return (...a)=>{ clearTimeout(to); to=setTimeout(()=>fn(...a), t); }; }

  async function boot(){
    // seed local users (not Supabase users) for NTID flows
    if(!LS.get('users')) LS.set('users', [{ id:'u_demo', ntid:'demo', displayName:'demo', email:'demo@Bosch.in' }]);
    loadSession();

    // Try initial fetch to warm caches if user logged in
    if(currentUser){
      try { await refreshEvents(); } catch(e){ console.warn('initial refreshEvents', e); }
      try { await refreshSubsForUser(currentUser); } catch(e){ console.warn('initial refreshSubsForUser', e); }

      const lp = document.getElementById('login-page'); const mw = document.getElementById('main-website');
      if(lp) lp.style.display='none';
      if(mw) mw.style.display='block';
      document.body.classList.remove('login-active');
      qs('#user-greeting').textContent = currentUser.ntid;
      qs('#contact-email').value = `${currentUser.ntid}@Bosch.in`;
      renderDashboardCounts(); renderOwnerEventsTabs(); initCreateEventForm(); initOwnerEventsDelegation(); wireMyEventTabs(); loadMySubscriptions(); reloadBrowse(true);
    } else {
      const lp = document.getElementById('login-page'); const mw = document.getElementById('main-website');
      if(lp) lp.style.display='flex';
      if(mw) mw.style.display='none';
      document.body.classList.add('login-active');
    }

    // login button wiring
    const loginBtn = qs('#login-btn');
    if(loginBtn) loginBtn.addEventListener('click', (e)=> { e.preventDefault(); const ntid = qs('#ntid').value.trim(); const remember = !!qs('#remember').checked; if(!ntid) return toast('Please enter NTID', 'error'); loginWithNTID(ntid, remember); });

    wireNav();
    initBrowseHandlers();
    initCreateEventForm();
    initOwnerEventsDelegation();
    wireMyEventTabs();
  }

  // view-all routing
  qsa('.panel-header .view-all').forEach(v => {
    v.addEventListener('click', e => {
      e.preventDefault();
      const type = v.dataset.open;
      if (type === 'renewals') {
        showSection('my-event');
      }
      if (type === 'recent-subs') {
        showSection('my-subscription');
      }
    });
  });

  // profile dropdown
  const pd = qs('#profile-dropdown');
  const pb = qs('#profile-btn');
  if(pb) {
    pb.addEventListener('click', (e)=>{ e.stopPropagation(); pd && pd.classList.toggle('hidden'); if(currentUser) qs('#pd-ntid').textContent = currentUser.ntid + "@Bosch.com"; });
  }
  document.addEventListener('click', ()=> pd && pd.classList.add('hidden') );

  const logoutBtn = qs('.logout-btn');
  if(logoutBtn) {
    logoutBtn.addEventListener('click', ()=>{ if(confirm("Are you sure you want to logout?")) logoutFlow(); });
  }

  document.addEventListener('DOMContentLoaded', () => { boot().catch(e => console.error('boot error', e)); });

  // expose debug helpers
  window.EN = { refreshEvents, refreshSubsForUser, getEvents, SupabaseHelper };

})(); // IIFE end

