(() => {
  // --- Simple local storage wrapper (used as cache + fallback) ---
  const STORAGE_PREFIX = 'enotifier_';
  const LS = {
    key(k){ return STORAGE_PREFIX + k; },
    get(k){ try { return JSON.parse(localStorage.getItem(this.key(k))); } catch(e){ return null; } },
    set(k,v){ localStorage.setItem(this.key(k), JSON.stringify(v)); },
    remove(k){ localStorage.removeItem(this.key(k)); }
  };

  // --- Utilities ---
  /*const qs = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const uid = () => 'id_' + Date.now() + '_' + Math.floor(Math.random()*9999);
  const escapeHtml = s => String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function toast(msg, type='info', t=3500){
    const container = qs('#toasts') || (() => { const d=document.createElement('div'); d.id='toasts'; document.body.appendChild(d); return d; })();
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

  // --- Supabase helper (replace placeholders with your project values) ---
  const SupabaseHelper = (function(){
    // TODO: REPLACE these placeholders with your actual Supabase project values
    const SUPABASE_URL = "https://supabase.com/dashboard/project/ridhgyfcgmsevazuzkkb";   // << replace
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpZGhneWZjZ21zZXZhenV6a2tiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMTMwMjEsImV4cCI6MjA3OTY4OTAyMX0.ajifKz-8Xgnp_PtNEcTGZviLhczA8WAlyti-rStvq9E";                 // << replace

    let supabase = null;
    function init() {
      if(!supabase) supabase = supabaseJs.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return supabase;
    }

    function mapRowToUIEvent(r){
      return {
        id: String(r.id),
        ownerId: r.user_id,
        name: r.event_name || '',
        description: r.description || '',
        startDate: r.startdate || '',
        endDate: r.enddate || '',
        status: r.status || '',
        tags: r.tags ? (String(r.tags).split(',').map(s=>s.trim()).filter(Boolean)) : [],
        contactEmail: r.contact_email || '',
        renewalEnabled: !!r.renewal,
        createdAt: r.created_at
      };
    }

    // EVENTS
    async function fetchEvents({ onlyUpcoming=false, limit=1000 }={}) {
      init();
      let q = supabase.from('"Events"').select('*').order('startdate', { ascending: true }).limit(limit);
      if(onlyUpcoming){
        const today = new Date().toISOString().slice(0,10);
        q = q.gte('startdate', today);
      }
      const { data, error } = await q;
      if(error) throw error;
      return (data||[]).map(mapRowToUIEvent);
    }

    async function createEvent(payload){
      init();
      const row = {
        user_id: payload.ownerId || payload.user_id || payload.NTID || '',
        event_name: payload.name || payload.event_name || '',
        startdate: payload.startDate || null,
        enddate: payload.endDate || null,
        status: payload.status || 'upcoming',
        tags: Array.isArray(payload.tags) ? payload.tags.join(',') : (payload.tags||null),
        contact_email: payload.contactEmail || payload.contact_email || '',
        renewal: !!payload.renewalEnabled || !!payload.renewal,
        created_at: payload.createdAt || new Date().toISOString()
      };
      const { data, error } = await supabase.from('"Events"').insert([row]).select().single();
      if(error) throw error;
      return mapRowToUIEvent(data);
    }

    async function updateEvent(id, payload){
      init();
      const row = {};
      if(payload.name !== undefined) row.event_name = payload.name;
      if(payload.startDate !== undefined) row.startdate = payload.startDate;
      if(payload.endDate !== undefined) row.enddate = payload.endDate;
      if(payload.status !== undefined) row.status = payload.status;
      if(payload.tags !== undefined) row.tags = Array.isArray(payload.tags) ? payload.tags.join(',') : payload.tags;
      if(payload.contactEmail !== undefined) row.contact_email = payload.contactEmail;
      if(payload.renewalEnabled !== undefined) row.renewal = payload.renewalEnabled;
      const { data, error } = await supabase.from('"Events"').update(row).eq('id', id).select().single();
      if(error) throw error;
      return mapRowToUIEvent(data);
    }

    async function deleteEvent(id){
      init();
      const { error } = await supabase.from('"Events"').delete().eq('id', id);
      if(error) throw error;
      return true;
    }

    // SUBSCRIPTIONS (linked by event_name - current schema)
    async function fetchSubscriptionsByEventName(eventName){
      init();
      const { data, error } = await supabase.from('subscriptions').select('*').eq('event_name', eventName);
      if(error) throw error;
      return (data||[]).map(s => ({
        id: String(s.id),
        event_name: s.event_name,
        subscriber_email: s.susbscriber_email,
        subscriber_NTID: s.subscriber_NTID,
        auto_renewal: !!s.auto_renewal,
        created_at: s.created_at
      }));
    }

    async function subscribeByEventName({ event_name, subscriber_email, subscriber_NTID=null, auto_renewal=true }){
      init();
      // dedupe
      const { data: existing } = await supabase.from('subscriptions').select('id').eq('event_name', event_name).eq('susbscriber_email', subscriber_email).limit(1);
      if(existing && existing.length) return existing[0];
      const { data, error } = await supabase.from('subscriptions').insert([{
        event_name,
        susbscriber_email: subscriber_email,
        subscriber_NTID,
        auto_renewal,
        created_at: new Date().toISOString()
      }]).select().single();
      if(error) throw error;
      return data;
    }

    async function unsubscribeByEmail(event_name, subscriber_email){
      init();
      const { data, error } = await supabase.from('subscriptions').delete().match({ event_name, susbscriber_email: subscriber_email });
      if(error) throw error;
      return data;
    }

    return {
      init,
      fetchEvents,
      createEvent,
      updateEvent,
      deleteEvent,
      fetchSubscriptionsByEventName,
      subscribeByEventName,
      unsubscribeByEmail,
      _raw: () => supabase
    };
  })();*/

  // ---------------- Safe SupabaseHelper (uses real supabase when available, else falls back to localStorage) ----------------
const SupabaseHelper = (function(){
  // Try to get a global supabase client (if you included supabase JS and set correct URL/keys)
  let supabase = null;
  try {
    if(window.supabase) supabase = window.supabase;               // if someone set window.supabase
    if(window.supabaseJs && window.SUPABASE_URL && window.SUPABASE_ANON_KEY){
      // optional: user added supabaseJs and keys to global scope
      supabase = window.supabaseJs.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
  } catch(e){
    supabase = null;
  }

  // Helpers to map rows for UI (used by both real and fallback)
  function mapRowToUIEvent(r){
    if(!r) return null;
    return {
      id: String(r.id ?? r._id ?? r.id_string ?? uid()),
      ownerId: r.user_id || r.ownerId || r.owner || r.owner_id || r.ownerId || r.ownerId || (r.owner && String(r.owner)),
      name: r.event_name || r.name || r.title || '',
      description: r.description || r.desc || '',
      startDate: r.startdate || r.startDate || r.start || '',
      endDate: r.enddate || r.endDate || r.end || '',
      status: r.status || 'upcoming',
      tags: r.tags ? (String(r.tags).split(',').map(s=>s.trim()).filter(Boolean)) : (Array.isArray(r.tags) ? r.tags : []),
      contactEmail: r.contact_email || r.contactEmail || '',
      renewalEnabled: !!(r.renewal || r.renewalEnabled),
      createdAt: r.created_at || r.createdAt || new Date().toISOString(),
      published: r.published === undefined ? !!r.published : !!r.published,
      draft: !!r.draft,
      subscriberIds: r.subscriberIds || r.subscriberIds || []
    };
  }

  // ---------- FALLBACK (localStorage-backed) implementations ----------
  function fallbackFetchEvents({ onlyUpcoming=false, limit=1000 }={}) {
    const rows = LS.get('events') || [];
    // ensure format
    const mapped = (rows||[]).map(r => mapRowToUIEvent(r));
    if(onlyUpcoming){
      const today = new Date().toISOString().slice(0,10);
      return mapped.filter(e => !e.startDate || e.startDate >= today).slice(0, limit);
    }
    return mapped.slice(0, limit);
  }

  function fallbackCreateEvent(payload){
    const events = LS.get('events') || [];
    const newEv = {
      id: uid(),
      user_id: payload.ownerId || payload.owner || payload.user_id || (payload.NTID ? 'u_' + payload.NTID : 'u_local'),
      event_name: payload.name || payload.event_name || '',
      description: payload.description || '',
      startdate: payload.startDate || payload.startdate || null,
      enddate: payload.endDate || payload.enddate || null,
      status: payload.status || 'upcoming',
      tags: Array.isArray(payload.tags) ? payload.tags.join(',') : (payload.tags||null),
      contact_email: payload.contactEmail || payload.contact_email || '',
      renewal: !!payload.renewalEnabled || !!payload.renewal,
      published: payload.status === 'upcoming' || !!payload.published,
      draft: payload.status === 'draft' || !!payload.draft,
      created_at: payload.createdAt || new Date().toISOString()
    };
    events.push(newEv);
    LS.set('events', events);
    return mapRowToUIEvent(newEv);
  }

  function fallbackUpdateEvent(id, payload){
    const events = LS.get('events') || [];
    const idx = events.findIndex(e => String(e.id) === String(id));
    if(idx === -1) throw new Error('Event not found');
    const row = events[idx];
    if(payload.name !== undefined) row.event_name = payload.name;
    if(payload.startDate !== undefined) row.startdate = payload.startDate;
    if(payload.endDate !== undefined) row.enddate = payload.endDate;
    if(payload.status !== undefined) row.status = payload.status;
    if(payload.tags !== undefined) row.tags = Array.isArray(payload.tags) ? payload.tags.join(',') : payload.tags;
    if(payload.contactEmail !== undefined) row.contact_email = payload.contactEmail;
    if(payload.renewalEnabled !== undefined) row.renewal = !!payload.renewalEnabled;
    if(payload.published !== undefined) row.published = !!payload.published;
    if(payload.draft !== undefined) row.draft = !!payload.draft;
    events[idx] = row;
    LS.set('events', events);
    return mapRowToUIEvent(row);
  }

  function fallbackDeleteEvent(id){
    let events = LS.get('events') || [];
    const before = events.length;
    events = events.filter(e => String(e.id) !== String(id));
    LS.set('events', events);
    return before !== events.length;
  }

  // SUBSCRIPTIONS fallback (stored in LS under key 'subscriptions')
  function fallbackFetchSubscriptionsByEventName(eventName){
    const subs = LS.get('subscriptions') || [];
    return (subs || []).filter(s => String(s.event_name) === String(eventName)).map(s=>({
      id: String(s.id || s._id || uid()),
      event_name: s.event_name,
      subscriber_email: s.subscriber_email || s.susbscriber_email || s.subscriber_email || '',
      subscriber_NTID: s.subscriber_NTID || s.subscriber_ntid || s.subscriber || null,
      auto_renewal: !!s.auto_renewal,
      created_at: s.created_at || s.createdAt
    }));
  }

  function fallbackSubscribeByEventName({ event_name, subscriber_email, subscriber_NTID=null, auto_renewal=true }){
    let subs = LS.get('subscriptions') || [];
    const exists = subs.find(s => (String(s.event_name) === String(event_name)) && ((s.subscriber_email && s.subscriber_email.toLowerCase()===String(subscriber_email||'').toLowerCase()) || (s.subscriber_NTID && String(s.subscriber_NTID) === String(subscriber_NTID))));
    if(exists) return exists;
    const row = {
      id: uid(),
      event_name,
      subscriber_email,
      subscriber_NTID,
      auto_renewal: !!auto_renewal,
      created_at: new Date().toISOString()
    };
    subs.push(row);
    LS.set('subscriptions', subs);
    return row;
  }

  function fallbackUnsubscribeByEmail(event_name, subscriber_email){
    let subs = LS.get('subscriptions') || [];
    const before = subs.length;
    subs = subs.filter(s => !(String(s.event_name) === String(event_name) && s.subscriber_email && s.subscriber_email.toLowerCase() === String(subscriber_email||'').toLowerCase()));
    LS.set('subscriptions', subs);
    return subs;
  }

  // A minimal _raw shim so existing code that calls SupabaseHelper._raw() won't break.
  // It returns an object with a from() that has a select() returning a Promise-like result with `.data`.
  function fallbackRaw(){
    return {
      from(tbl){
        // return a promise-like object with .select() that returns { data: ... }
        const resPromise = Promise.resolve({ data: LS.get(tbl) || [] });
        // also allow .or(...) chaining by providing an async or() method
        resPromise.or = async function(){ return { data: LS.get(tbl) || [] }; };
        return {
          select: function(){ return resPromise; },
          or: async function(){ return { data: LS.get(tbl) || [] }; }
        };
      }
    };
  }

  // ---------- If real supabase is available and configured, use the real implementation ----------
  if(supabase && typeof supabase.from === 'function'){
    return {
      init(){ return supabase; },
      async fetchEvents(opts){ 
        const { onlyUpcoming=false, limit=1000 } = opts||{};
        let q = supabase.from('Events').select('*').order('startdate', { ascending:true }).limit(limit);
        if(onlyUpcoming){
          const today = new Date().toISOString().slice(0,10);
          q = q.gte('startdate', today);
        }
        const { data, error } = await q;
        if(error) throw error;
        return (data||[]).map(mapRowToUIEvent);
      },
      async createEvent(payload){
        const row = {
          user_id: payload.ownerId || payload.user_id || payload.NTID || '',
          event_name: payload.name || payload.event_name || '',
          description: payload.description || '',
          startdate: payload.startDate || null,
          enddate: payload.endDate || null,
          status: payload.status || 'upcoming',
          tags: Array.isArray(payload.tags) ? payload.tags.join(',') : (payload.tags||null),
          contact_email: payload.contactEmail || payload.contact_email || '',
          renewal: !!payload.renewalEnabled || !!payload.renewal,
          published: payload.status === 'upcoming' || !!payload.published,
          draft: payload.status === 'draft' || !!payload.draft,
          created_at: payload.createdAt || new Date().toISOString()
        };
        const { data, error } = await supabase.from('Events').insert([row]).select().single();
        if(error) throw error;
        return mapRowToUIEvent(data);
      },
      async updateEvent(id, payload){
        const row = {};
        if(payload.name !== undefined) row.event_name = payload.name;
        if(payload.startDate !== undefined) row.startdate = payload.startDate;
        if(payload.endDate !== undefined) row.enddate = payload.endDate;
        if(payload.status !== undefined) row.status = payload.status;
        if(payload.tags !== undefined) row.tags = Array.isArray(payload.tags) ? payload.tags.join(',') : payload.tags;
        if(payload.contactEmail !== undefined) row.contact_email = payload.contactEmail;
        if(payload.renewalEnabled !== undefined) row.renewal = payload.renewalEnabled;
        if(payload.published !== undefined) row.published = payload.published;
        if(payload.draft !== undefined) row.draft = payload.draft;
        const { data, error } = await supabase.from('Events').update(row).eq('id', id).select().single();
        if(error) throw error;
        return mapRowToUIEvent(data);
      },
      async deleteEvent(id){
        const { error } = await supabase.from('Events').delete().eq('id', id);
        if(error) throw error;
        return true;
      },

      // subscriptions using table 'subscriptions'
      async fetchSubscriptionsByEventName(eventName){
        const { data, error } = await supabase.from('subscriptions').select('*').eq('event_name', eventName);
        if(error) throw error;
        return (data||[]).map(s => ({
          id: String(s.id),
          event_name: s.event_name,
          subscriber_email: s.subscriber_email || s.susbscriber_email || '',
          subscriber_NTID: s.subscriber_NTID || s.subscriber_ntid || null,
          auto_renewal: !!s.auto_renewal,
          created_at: s.created_at
        }));
      },
      async subscribeByEventName({ event_name, subscriber_email, subscriber_NTID=null, auto_renewal=true }){
        // dedupe
        const { data: existing } = await supabase.from('subscriptions').select('id').eq('event_name', event_name).eq('subscriber_email', subscriber_email).limit(1);
        if(existing && existing.length) return existing[0];
        const { data, error } = await supabase.from('subscriptions').insert([{
          event_name,
          subscriber_email,
          subscriber_NTID,
          auto_renewal,
          created_at: new Date().toISOString()
        }]).select().single();
        if(error) throw error;
        return data;
      },
      async unsubscribeByEmail(event_name, subscriber_email){
        const { data, error } = await supabase.from('subscriptions').delete().match({ event_name, subscriber_email });
        if(error) throw error;
        return data;
      },

      // expose raw client
      _raw: () => supabase
    };
  }

  // ---------- FALLBACK (no supabase available) ----------
  return {
    init(){ return null; },
    fetchEvents: async (opts) => fallbackFetchEvents(opts),
    createEvent: async (payload) => fallbackCreateEvent(payload),
    updateEvent: async (id,payload) => fallbackUpdateEvent(id,payload),
    deleteEvent: async (id) => fallbackDeleteEvent(id),
    fetchSubscriptionsByEventName: async (name) => fallbackFetchSubscriptionsByEventName(name),
    subscribeByEventName: async (p) => fallbackSubscribeByEventName(p),
    unsubscribeByEmail: async (event_name, subscriber_email) => fallbackUnsubscribeByEmail(event_name, subscriber_email),
    _raw: () => fallbackRaw()
  };
})();


  // --- Seed / storage helpers ---
  function seedIfEmpty(){
    if(!LS.get('users')) LS.set('users', [{ id:'u_demo', ntid:'demo', displayName:'demo', email:'demo@Bosch.in' }]);
    if(!LS.get('events')) LS.set('events', []);
    if(!LS.get('subscriptions')) LS.set('subscriptions', []);
  }
  function getEvents(){ return LS.get('events') || []; }
  function saveEvents(arr){ LS.set('events', arr); }
  function getSubs(){ return LS.get('subscriptions') || []; }
  function saveSubs(arr){ LS.set('subscriptions', arr); }

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
    const subs = getSubs().filter(s => s.userId === (currentUser && currentUser.id));
    const renewals = events.filter(e => e.renewalEnabled && e.published && e.endDate).filter(e => {
      const end = new Date(e.endDate + 'T00:00:00'); const now = new Date();
      const diffDays = Math.ceil((end - now)/(1000*60*60*24)); return diffDays <= 7 && diffDays >= 0;
    });

    if(qs('#stat-total-events')) qs('#stat-total-events').textContent = events.length;
    if(qs('#stat-active-subs')) qs('#stat-active-subs').textContent = subs.length;
    if(qs('#stat-renewals')) qs('#stat-renewals').textContent = renewals.length;
    if(qs('#hero-active-events')) qs('#hero-active-events').textContent = published.length;
    if(qs('#hero-subscribed-events')) qs('#hero-subscribed-events').textContent = subs.length;

    // Upcoming renewals list
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

    // Recent subscriptions list
    const rs = qs('#recent-subs');
    if(rs){
      rs.innerHTML = '';
      const recentSubs = getSubs().filter(s => s.userId === (currentUser && currentUser.id)).slice(-4).reverse();
      if(!recentSubs.length) rs.innerHTML = '<div class="empty-state">No recent subscriptions</div>';
      else recentSubs.forEach(s => {
        const ev = getEvents().find(e => e.id === s.eventId);
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
    // sync status and save
    const all = getEvents();
    all.forEach(e => { e.status = computeStatus(e); });
    saveEvents(all);

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

  // delegation for owner events (single attach)
  function initOwnerEventsDelegation(){
    const container = qs('#owner-events');
    if(!container) return;
    // ensure we attach only once by using a data attribute guard
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
      await SupabaseHelper.deleteEvent(id);
      // re-fetch and cache events
      const events = await SupabaseHelper.fetchEvents({ onlyUpcoming:false });
      LS.set('events', events);
      // refresh UI
      renderOwnerEventsTabs();
      reloadBrowse(true);
      renderDashboardCounts();
      loadMySubscriptions();
      toast('Event deleted', 'success');
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

  function handleTogglePublish(id){
    const events = getEvents();
    const idx = events.findIndex(e => String(e.id) === String(id) && e.ownerId === currentUser.id);
    if(idx === -1) { toast('Not found or unauthorized', 'error'); return; }
    events[idx].published = !events[idx].published;
    events[idx].draft = !events[idx].published;
    events[idx].status = computeStatus(events[idx]);
    if(events[idx].published) events[idx]._lastPublishedAt = new Date().toISOString();
    saveEvents(events);
    toast(events[idx].published ? 'Published' : 'Unpublished', 'success');
    renderOwnerEventsTabs();
    reloadBrowse(true);
    renderDashboardCounts();
  }

  // --- Create form (guarded attach to avoid duplicates) ---
  function initCreateEventForm(){
    const form = qs('#create-event-form');
    if(!form) return;
    if(form._createAttached) return; // guard
    form._createAttached = true;

    const saveDraftBtn = qs('#save-draft');

    // validation helper (returns first invalid field or null)
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
      // simple email pattern
      const email = qs('#contact-email').value.trim();
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if(!emailRe.test(email)) return { ok:false, field: qs('#contact-email'), msg:'Enter a valid contact email' };
      // dates sanity: start <= end
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
          await SupabaseHelper.updateEvent(editing, {
            name: payload.name,
            description: payload.description,
            startDate: payload.startDate,
            endDate: payload.endDate,
            contactEmail: payload.contactEmail,
            tags: payload.tags,
            renewalEnabled: payload.renewalEnabled,
            status: computeStatus(payload)
          });
          sessionStorage.removeItem('editing_event');
          toast('Draft updated (saved to server)', 'success');
        } else {
          await SupabaseHelper.createEvent({
            ownerId: currentUser.id,
            name: payload.name,
            description: payload.description,
            startDate: payload.startDate,
            endDate: payload.endDate,
            contactEmail: payload.contactEmail,
            tags: payload.tags,
            renewalEnabled: payload.renewalEnabled,
            status: 'draft'
          });
          toast('Draft saved (server)', 'success');
        }
        // refresh cached list and UI
        const events = await SupabaseHelper.fetchEvents({ onlyUpcoming:false });
        LS.set('events', events);
        renderOwnerEventsTabs();
        renderDashboardCounts();
        reloadBrowse(true);
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
          await SupabaseHelper.updateEvent(editing, {
            name: payload.name,
            description: payload.description,
            startDate: payload.startDate,
            endDate: payload.endDate,
            contactEmail: payload.contactEmail,
            tags: payload.tags,
            renewalEnabled: payload.renewalEnabled,
            status: 'upcoming'
          });
          sessionStorage.removeItem('editing_event');
          toast('Event updated & published', 'success');
        } else {
          await SupabaseHelper.createEvent({
            ownerId: currentUser.id,
            name: payload.name,
            description: payload.description,
            startDate: payload.startDate,
            endDate: payload.endDate,
            contactEmail: payload.contactEmail,
            tags: payload.tags,
            renewalEnabled: payload.renewalEnabled,
            status: 'upcoming'
          });
          toast('Event published', 'success');
        }
        // refresh cached events and UI
        const events = await SupabaseHelper.fetchEvents({ onlyUpcoming:false });
        LS.set('events', events);
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

  // --- Browse / subscribe (same as before) ---
  let browsePage = 1;
  const pageSize = 6;
  const loadMoreSize = 5;
  function reloadBrowse(reset=true){
    if(reset) { browsePage = 1; qs('#events-grid').innerHTML = ''; }
    const q = qs('#searchInput').value.trim().toLowerCase();
    const category = qs('#categoryFilter').value;
    const status = qs('#statusFilter').value;
    const dateFrom = qs('#dateFrom').value;
    const dateTo = qs('#dateTo').value;

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
          <button class="subscribe-btn" data-id="${ev.id}">${/* placeholder text; actual text updated after click */ 'Subscribe'}</button>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  async function isSubscribed(eventId){
    // map eventId -> eventName using cached events
    const events = LS.get('events') || [];
    const ev = events.find(e => String(e.id) === String(eventId));
    if(!ev) return false;
    const subs = await SupabaseHelper.fetchSubscriptionsByEventName(ev.name);
    return subs.some(s => (currentUser && (s.subscriber_NTID === currentUser.id || s.subscriber_email === currentUser.email)));
  }

  async function toggleSubscribe(eventId){
    if(!currentUser){
      const email = prompt('Enter your email to subscribe');
      if(!email) return toast('Email required', 'error');
      const events = LS.get('events') || [];
      const ev = events.find(e => String(e.id) === String(eventId));
      if(!ev) return toast('Event not found', 'error');
      const existing = await SupabaseHelper.fetchSubscriptionsByEventName(ev.name);
      const already = existing.some(s => s.subscriber_email && s.subscriber_email.toLowerCase() === email.toLowerCase());
      if(already){
        await SupabaseHelper.unsubscribeByEmail(ev.name, email);
        toast('Unsubscribed', 'info');
      } else {
        await SupabaseHelper.subscribeByEventName({ event_name: ev.name, subscriber_email: email, subscriber_NTID: null });
        toast('Subscribed (by email)', 'success');
      }
    } else {
      const events = LS.get('events') || [];
      const ev = events.find(e => String(e.id) === String(eventId));
      if(!ev) return toast('Event not found', 'error');
      const existing = await SupabaseHelper.fetchSubscriptionsByEventName(ev.name);
      const already = existing.some(s => s.subscriber_NTID === currentUser.id || (s.subscriber_email && s.subscriber_email.toLowerCase() === currentUser.email.toLowerCase()));
      if(already){
        await SupabaseHelper.unsubscribeByEmail(ev.name, currentUser.email);
        toast('Unsubscribed', 'info');
      } else {
        await SupabaseHelper.subscribeByEventName({ event_name: ev.name, subscriber_email: currentUser.email, subscriber_NTID: currentUser.id });
        toast('Subscribed', 'success');
      }
    }

    // refresh local cache and UI
    const events = await SupabaseHelper.fetchEvents({ onlyUpcoming:false });
    LS.set('events', events);
    renderOwnerEventsTabs();
    loadMySubscriptions();
    reloadBrowse(true);
  }

  async function loadMySubscriptions(){
    const container = qs('#subscription-list'); if(!container) return;
    if(!currentUser) { container.innerHTML = '<div class="empty-state">Login to see subscriptions</div>'; return; }
    try {
      // fetch subs where subscriber_NTID == currentUser.id OR susbscriber_email == currentUser.email
      const sup = SupabaseHelper._raw();
      const cond = `subscriber_NTID.eq.${currentUser.id},susbscriber_email.eq.${currentUser.email}`;
      const { data: subsData, error } = await sup.from('subscriptions').select('*').or(cond);
      if(error) throw error;
      if(!subsData || subsData.length === 0){ container.innerHTML = '<div class="empty-state">No subscriptions yet.</div>'; return; }
      const rows = await Promise.all(subsData.map(async s => {
        // find event (by event_name)
        const events = LS.get('events') || [];
        const ev = events.find(e => e.name === s.event_name) || { name:'(deleted)', endDate:'-', status:'expired' };
        const statusClass = ev.status==='expired' ? 'status-expired' : (ev.status==='upcoming' ? 'status-warning' : 'status-active');
        return `<div class="subs-row" data-id="${s.id}" data-eventid="${ev.id}">
          <div class="col event-name">${escapeHtml(ev.name)}</div>
          <div class="col renewal">${escapeHtml(ev.endDate||'-')}</div>
          <div class="col status"><span class="status-badge ${statusClass}">${escapeHtml(ev.status||'Active')}</span></div>
          <div class="col autorenew">${s.auto_renewal? 'Yes':'No'}</div>
          <div class="col actions"><button class="btn btn-outline btn-sm unsub-btn" data-eventname="${escapeHtml(s.event_name)}" data-subscriber="${escapeHtml(s.susbscriber_email||s.subscriber_NTID)}">Unsubscribe</button></div>
        </div>`;
      }));
      container.innerHTML = rows.join('');
      container.querySelectorAll('.unsub-btn').forEach(b => b.addEventListener('click', async ()=> {
        if(!confirm('Unsubscribe?')) return;
        const eventName = b.dataset.eventname;
        const subscriber = b.dataset.subscriber;
        // prefer currentUser.email
        await SupabaseHelper.unsubscribeByEmail(eventName, currentUser.email || subscriber);
        toast('Unsubscribed', 'info');
        loadMySubscriptions();
        const events = await SupabaseHelper.fetchEvents({ onlyUpcoming:false });
        LS.set('events', events);
        renderOwnerEventsTabs(); renderDashboardCounts();
      }));
    } catch(err){
      console.error(err);
      container.innerHTML = '<div class="empty-state">Unable to load subscriptions</div>';
    }
  }

  // --- Navigation and helpers ---
  function wireNav(){
    qsa('.nav-links a').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); showSection(a.dataset.target); }));
    qsa('.create-btn').forEach(b => b.addEventListener('click', ()=> showSection('create-event')));
    const profile = qs('#profile-btn');
    if(profile) profile.addEventListener('click', ()=> { if(confirm('Logout?')) { logoutFlow(); } });
  }

  // showSection ensures dashboard scrolls to top
  function showSection(id){
    qsa('section').forEach(s => s.classList.remove('active'));
    const sec = qs('#' + id);
    if(sec) sec.classList.add('active');
    qsa('.nav-links a').forEach(a => a.classList.toggle('active', a.dataset.target === id));
    setTimeout(()=> {
      if(id === 'dashboard'){
        // scroll dashboard to top (both window and main container)
        window.scrollTo({ top: 0, behavior: 'instant' });
        const main = document.querySelector('main');
        if(main && typeof main.scrollTo === 'function') main.scrollTo({ top: 0 });
      } else {
        sec && sec.focus();
      }
    }, 60);
    if(id === 'my-event') {
      // ensure My Events tabs render and default to Active
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

  // --- Login flow ---
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

    document.getElementById('login-page').style.display = 'none';
    document.getElementById('main-website').style.display = 'block';
    document.body.classList.remove('login-active');
    qs('#user-greeting').textContent = user.ntid;
    qs('#contact-email').value = `${user.ntid}@Bosch.in`;
     //redirect to dashboard by default 
    showSection('dashboard');
    window.scrollTo({ top: 0, behavior: 'instant' });

    // init UI
    renderDashboardCounts(); renderOwnerEventsTabs(); initCreateEventForm(); initOwnerEventsDelegation(); wireMyEventTabs(); loadMySubscriptions(); reloadBrowse(true);
    toast(`Welcome ${user.ntid}`, 'success', 1600);
  }

  function logoutFlow(){
    clearSession();
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('main-website').style.display = 'none';
    document.body.classList.add('login-active');
  }

  // --- Boot/Wiring ---
  function initBrowseHandlers(){
    const s = qs('#searchInput'); if(s) s.addEventListener('input', debounce(()=> reloadBrowse(true), 300));
    const cat = qs('#categoryFilter'); if(cat) cat.addEventListener('change', ()=> reloadBrowse(true));
    const st = qs('#statusFilter'); if(st) st.addEventListener('change', ()=> reloadBrowse(true));
    const df = qs('#dateFrom'); if(df) df.addEventListener('change', ()=> reloadBrowse(true));
    const dt = qs('#dateTo'); if(dt) dt.addEventListener('change', ()=> reloadBrowse(true));
    const clear = qs('#clearFilters'); if(clear) clear.addEventListener('click', ()=> { qs('#searchInput').value=''; qs('#categoryFilter').value='all'; qs('#statusFilter').value='all'; qs('#dateFrom').value=''; qs('#dateTo').value=''; reloadBrowse(true); });
    const loadMore = qs('#loadMore'); if(loadMore) loadMore.addEventListener('click', ()=> { browsePage++; reloadBrowse(false); });
    const grid = qs('#events-grid'); if(grid) grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.subscribe-btn'); if(!btn) return;
      (async () => {
        await toggleSubscribe(btn.dataset.id);
        btn.classList.toggle('subscribed', btn.classList.contains('subscribed') ? false : true);
        btn.textContent = btn.classList.contains('subscribed') ? 'Subscribed' : 'Subscribe';
      })();
    });
  }
  function debounce(fn, t=200){ let to=null; return (...a)=>{ clearTimeout(to); to=setTimeout(()=>fn(...a), t); }; }

  async function boot(){
    seedIfEmpty();
    SupabaseHelper.init(); // initialize client
    loadSession(); // keep existing session behavior (NTID-based)

    // if remembered NTID -> auto login
    const rem = localStorage.getItem(LS.key('remember_ntid'));
    if(rem && !currentUser) loginWithNTID(rem, true);
    else if(currentUser){
      // logged in -> fetch events from Supabase then render
      try {
        const events = await SupabaseHelper.fetchEvents({ onlyUpcoming:false });
        LS.set('events', events); // cache
      } catch(err){
        console.error('Failed to load events from Supabase', err);
      }

      try {
        const sup = SupabaseHelper._raw();
        // fetch subscriptions for this user (by NTID or email). .or syntax: 'subscriber_NTID.eq.X,susbscriber_email.eq.Y'
        const { data: subsData } = await sup.from('subscriptions').select('*').or(`subscriber_NTID.eq.${currentUser.id},susbscriber_email.eq.${currentUser.email}`);
        LS.set('subscriptions', subsData || []);
      } catch(e){
        console.warn('Failed to load subscriptions at boot', e);
      }

      // then show UI
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('main-website').style.display = 'block';
      document.body.classList.remove('login-active');
      qs('#user-greeting').textContent = currentUser.ntid;
      qs('#contact-email').value = `${currentUser.ntid}@Bosch.in`;

      renderDashboardCounts(); renderOwnerEventsTabs(); initCreateEventForm(); initOwnerEventsDelegation(); wireMyEventTabs(); loadMySubscriptions(); reloadBrowse(true);
    } else {
      // show login view by default
      document.getElementById('login-page').style.display = 'flex';
      document.getElementById('main-website').style.display = 'none';
      document.body.classList.add('login-active');
    }

    // attach login button
    const loginBtn = qs('#login-btn');
    if(loginBtn) loginBtn.addEventListener('click', (e)=> { e.preventDefault(); const ntid = qs('#ntid').value.trim(); const remember = !!qs('#remember').checked; if(!ntid) return toast('Please enter NTID', 'error'); loginWithNTID(ntid, remember); });

    wireNav();
    initBrowseHandlers();
    initCreateEventForm();
    initOwnerEventsDelegation();
    wireMyEventTabs();
  }

  // Correct view-all routing
  qsa('.panel-header .view-all').forEach(v => {
    v.addEventListener('click', e => {
      e.preventDefault();
      const type = v.dataset.open;

      if (type === 'renewals') {
        showSection('my-event');   // Upcoming Renewals → My Event
      }

      if (type === 'recent-subs') {
        showSection('my-subscription');  // Recent Subscriptions → My Subscription
      }
    });
  });

  // Profile dropdown toggle
  const pd = qs('#profile-dropdown');
  const pb = qs('#profile-btn');
  if(pb) {
    pb.addEventListener('click', (e)=>{
      e.stopPropagation();
      pd && pd.classList.toggle('hidden');
      if(currentUser) qs('#pd-ntid').textContent = currentUser.ntid + "@Bosch.com";
    });
  }

  // Hide when clicking outside
  document.addEventListener('click', ()=> pd && pd.classList.add('hidden') );

  // Logout
  const logoutBtn = qs('.logout-btn');
  if(logoutBtn) {
    logoutBtn.addEventListener('click', ()=>{
      if(confirm("Are you sure you want to logout?")){
        logoutFlow();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => { boot().catch(e => console.error('boot error', e)); });

  // Expose for debug
  window.EN = { getEvents, saveEvents, getSubs, saveSubs, uid };

})();


