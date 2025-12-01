/* REST-only Supabase client with improved error handling and actionable fixes.
   Drop-in replacement for your existing app.js (uses your SUPABASE_URL & SUPABASE_ANON_KEY).
*/

const SUPABASE_URL = "https://rpvtpbuljnceyfdabvhu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwdnRwYnVsam5jZXlmZGFidmh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1NjYzMzUsImV4cCI6MjA4MDE0MjMzNX0.__HetGjrnEPWMlNGGRMhxfRwWp1jmfXwI87Rpeww82E";

(() => {
  // Utilities & toast (same as before)
  const STORAGE_PREFIX = 'enotifier_';
  const LS = {
    key(k){ return STORAGE_PREFIX + k; },
    get(k){ try { return JSON.parse(localStorage.getItem(this.key(k))); } catch(e){ return null; } },
    set(k,v){ localStorage.setItem(this.key(k), JSON.stringify(v)); },
    remove(k){ localStorage.removeItem(this.key(k)); }
  };
  const qs = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const escapeHtml = s => String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function toast(msg, type='info', t=6000){
    let c = qs('#toasts'); if(!c){ c = document.createElement('div'); c.id='toasts'; document.body.appendChild(c); }
    const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
    Object.assign(el.style, {padding:'10px 14px', borderRadius:'8px', color:'#fff', marginTop:'8px', fontWeight:700, zIndex:9999});
    if(type==='success') el.style.background='linear-gradient(135deg,#2bb673,#1f8f5a)';
    if(type==='error') el.style.background='linear-gradient(135deg,#e05b5b,#b13232)';
    if(type==='info') el.style.background='linear-gradient(135deg,#4d4da9,#6a42f4)';
    c.appendChild(el); setTimeout(()=> el.remove(), t);
  }

  // REST helper with enhanced error parsing
  async function restRequest(path, method='GET', body=null, params='', extraHeaders={}){
    const base = SUPABASE_URL.replace(/\/$/,'') + '/rest/v1/' + path;
    const q = params ? (params.startsWith('?') ? params : '?' + params) : '';
    const url = base + q;
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    };
    const opts = { method, headers, credentials: 'omit' };
    if(body !== null) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if(!res.ok){
      // parse PostgREST-style error (400 message often includes missing column)
      let serverMsg = data && data.message ? data.message : (typeof data === 'string' ? data : JSON.stringify(data));
      const err = new Error(`Supabase REST error ${res.status}: ${serverMsg}`);
      err.status = res.status; err.body = data; err.url = url; throw err;
    }
    return data;
  }

  // Better wrapper for POST/PATCH (Prefer return=representation)
  async function restWrite(path, method, payload){
    const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${path}`;
    const params = '?select=*';
    const res = await fetch(url + params, {
      method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(Array.isArray(payload) ? payload : [payload])
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if(!res.ok){
      let msg = data && data.message ? data.message : (typeof data === 'string' ? data : JSON.stringify(data));
      const err = new Error(`Supabase REST error ${res.status}: ${msg}`);
      err.status = res.status; err.body = data; throw err;
    }
    return Array.isArray(data) ? data[0] : data;
  }

  // map DB row to UI object (expects columns created by SQL I supplied)
  function mapRowToUIEvent(r){
    return {
      id: String(r.id),
      ownerId: r.user_id,
      name: r.event_name || '',
      description: r.description || '',
      startDate: r.startdate ? (new Date(r.startdate)).toISOString().slice(0,10) : '',
      endDate: r.enddate ? (new Date(r.enddate)).toISOString().slice(0,10) : '',
      tags: r.tags ? String(r.tags).split(',').map(s=>s.trim()).filter(Boolean) : [],
      contactEmail: r.contact_email || '',
      renewalEnabled: !!r.renewal,
      status: r.status || '',
      published: !!r.published,
      draft: !!r.draft,
      location: r.location || '',
      subscriberIds: Array.isArray(r.subscriber_ids) ? r.subscriber_ids : [],
      createdAt: r.created_at
    };
  }

  // API surface (uses restRequest/restWrite)
  const Api = {
    async fetchEvents(){ const rows = await restRequest('Events', 'GET', null, 'select=*&order=startdate.asc'); return (rows||[]).map(mapRowToUIEvent); },
    async createEvent(payload){ const row = await restWrite('Events', 'POST', payload); return mapRowToUIEvent(row); },
    async updateEvent(id, payload){
      // PATCH endpoint with filter
      const url = `Events?id=eq.${encodeURIComponent(id)}`;
      // Use restWrite with full url
      const res = await fetch(`${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${url}?select=*`, {
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
        const msg = data && data.message ? data.message : (typeof data === 'string' ? data : JSON.stringify(data));
        throw new Error(`Supabase REST update error ${res.status}: ${msg}`);
      }
      const row = Array.isArray(data) ? data[0] : data;
      return mapRowToUIEvent(row);
    },
    async deleteEvent(id){
      const res = await fetch(`${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/Events?id=eq.${encodeURIComponent(id)}`, { method:'DELETE', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
      if(!res.ok){ const t = await res.text().catch(()=>null); throw new Error('Delete failed: ' + res.status + ' ' + t); }
      return true;
    },

    async fetchSubscriptionsByEventName(eventName){ return await restRequest('subscriptions','GET', null, `select=*&event_name=eq.${encodeURIComponent(eventName)}`); },
    async subscribeByEventName(payload){ return await restWrite('subscriptions','POST', payload); },
    async unsubscribeByEmail(event_name, subscriber_email){
      // find subs then delete by id
      const subs = await this.fetchSubscriptionsByEventName(event_name);
      const toDel = (subs||[]).filter(s => s.subscriber_email && s.subscriber_email.toLowerCase() === String(subscriber_email||'').toLowerCase());
      if(toDel.length === 0) return [];
      const ids = toDel.map(d => d.id);
      const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/subscriptions?id=in.(${ids.map(i=>encodeURIComponent(i)).join(',')})`;
      const res = await fetch(url, { method:'DELETE', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
      if(!res.ok){ const t = await res.text().catch(()=>null); throw new Error('Unsubscribe failed: ' + res.status + ' ' + t); }
      return toDel;
    },
    async fetchSubscriptionsForUserNTIDOrEmail(ntid, email){
      const orCond = `or=(subscriber_NTID.eq.${encodeURIComponent(ntid)},subscriber_email.eq.${encodeURIComponent(email)})&select=*`;
      const res = await fetch(`${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/subscriptions?${orCond}`, { method:'GET', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
      if(!res.ok){ const t = await res.text().catch(()=>null); throw new Error('Failed to load subs: ' + res.status + ' ' + t); }
      return await res.json();
    }
  };

  // Enhanced error handler to detect missing column and show SQL
  function handleSupabaseError(err){
    console.error('Supabase error:', err);
    toast('Server error: ' + (err.message || 'See console'), 'error', 8000);

    if(err && err.message && typeof err.message === 'string'){
      // common pattern: "Could not find the 'description' column of 'Events' in the schema cache"
      const m = err.message.match(/Could not find the '([^']+)' column of '([^']+)'/i);
      if(m){
        const col = m[1];
        const table = m[2];
        const suggestion = `ALTER TABLE public."${table}" ADD COLUMN IF NOT EXISTS ${col} text;`;
        // show a modal-like overlay with SQL (simple)
        showFixModal(col, table, suggestion);
      }
    }
  }

  function showFixModal(col, table, sql){
    // simple overlay
    let overlay = qs('#schema-fix-overlay');
    if(!overlay){
      overlay = document.createElement('div'); overlay.id = 'schema-fix-overlay';
      Object.assign(overlay.style, {position:'fixed', left:'12px', right:'12px', bottom:'12px', zIndex:99999, background:'#111', color:'#fff', padding:'16px', borderRadius:'8px', boxShadow:'0 8px 30px rgba(0,0,0,0.6)'});
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<strong>Database schema issue detected</strong>
      <div style="margin-top:8px">Missing column <code style="background:#222;padding:3px 6px;border-radius:4px">${escapeHtml(col)}</code> on table <code style="background:#222;padding:3px 6px;border-radius:4px">${escapeHtml(table)}</code>.</div>
      <div style="margin-top:8px">Run this SQL in Supabase → SQL editor to add the column:</div>
      <pre style="background:#0b1220;color:#bfe6b4;padding:8px;border-radius:6px;margin-top:8px;overflow:auto">${escapeHtml(sql)}</pre>
      <div style="margin-top:8px"><button id="schema-fix-close" style="padding:8px 12px;border-radius:6px;background:#2bb673;border:0;color:#fff;font-weight:700">Close</button></div>`;
    qs('#schema-fix-close').addEventListener('click', ()=> overlay.remove());
  }

  // -- App cache + UI skeleton (kept lean; same logic as earlier) --
  let EVENTS_CACHE = [], SUBS_CACHE = [];
  let currentUser = null;

  // Load session (local)
  function loadSession(){
    const s = LS.get('session');
    if(s){
      const users = LS.get('users') || [];
      const u = users.find(x => x.id === s.id);
      if(u) currentUser = { id:u.id, ntid:u.ntid, email:u.email, displayName:u.displayName };
      else currentUser = s;
    }
  }
  function setSession(u){ LS.set('session', u); currentUser = u; }
  function clearSession(){ LS.remove('session'); localStorage.removeItem(LS.key('remember_ntid')); currentUser = null; }

  async function refreshEvents(){
    try { EVENTS_CACHE = await Api.fetchEvents(); return EVENTS_CACHE; }
    catch(e){ handleSupabaseError(e); EVENTS_CACHE = []; throw e; }
  }
  async function refreshSubsForUser(u){
    if(!u){ SUBS_CACHE = []; return []; }
    try { SUBS_CACHE = await Api.fetchSubscriptionsForUserNTIDOrEmail(u.id, u.email); return SUBS_CACHE; }
    catch(e){ handleSupabaseError(e); SUBS_CACHE = []; return []; }
  }

  // Basic UI & wiring (only necessary bits for creation/publish)
  function initCreateEventForm(){
    const form = qs('#create-event-form'); if(!form) return;
    if(form._attached) return; form._attached = true;

    const saveDraftBtn = qs('#save-draft');
    saveDraftBtn && saveDraftBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      if(!currentUser){ toast('Login first', 'error'); return; }
      const payload = gatherFormData();
      const dbPayload = {
        user_id: currentUser.id,
        event_name: payload.name,
        description: payload.description || null,
        startdate: payload.startDate || null,
        enddate: payload.endDate || null,
        contact_email: payload.contactEmail,
        tags: payload.tags.join(','),
        renewal: !!payload.renewalEnabled,
        status: 'draft',
        published: false,
        draft: true,
        location: payload.location || null,
        created_at: new Date().toISOString()
      };
      try {
        await Api.createEvent(dbPayload);
        toast('Draft saved to Supabase', 'success');
        await refreshEvents();
      } catch(err){ handleSupabaseError(err); }
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if(!currentUser){ toast('Login first', 'error'); return; }
      const v = validateForm();
      if(!v.ok) { toast(v.msg,'error'); return; }
      const payload = gatherFormData();
      const dbPayload = {
        user_id: currentUser.id,
        event_name: payload.name,
        description: payload.description || null,
        startdate: payload.startDate || null,
        enddate: payload.endDate || null,
        contact_email: payload.contactEmail,
        tags: payload.tags.join(','),
        renewal: !!payload.renewalEnabled,
        status: 'upcoming',
        published: true,
        draft: false,
        location: payload.location || null,
        created_at: new Date().toISOString()
      };
      try {
        await Api.createEvent(dbPayload);
        toast('Event published to Supabase', 'success');
        await refreshEvents();
      } catch(err){ handleSupabaseError(err); }
    });
  }

  function validateForm(){
    const reqs = ['#event-name','#description','#start-date','#end-date','#location','#contact-email'];
    for(const sel of reqs){ const el = qs(sel); if(!el || String(el.value||'').trim()==='') return { ok:false, msg:`${sel} is required` }; }
    const email = qs('#contact-email').value.trim(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok:false, msg:'Enter a valid email' };
    const s=qs('#start-date').value, e=qs('#end-date').value; if(s && e && new Date(s) > new Date(e)) return { ok:false, msg:'Start date cannot be after end date' };
    return { ok:true };
  }

  function gatherFormData(){
    return {
      name: (qs('#event-name')||{}).value?.trim() || '',
      description: (qs('#description')||{}).value?.trim() || '',
      startDate: (qs('#start-date')||{}).value || '',
      endDate: (qs('#end-date')||{}).value || '',
      location: (qs('#location')||{}).value?.trim() || '',
      contactEmail: (qs('#contact-email')||{}).value?.trim() || '',
      tags: ((qs('#tags')||{}).value || '').split(',').map(s=>s.trim()).filter(Boolean),
      renewalEnabled: !!(qs('#renewal') && qs('#renewal').checked)
    };
  }

  // Login wiring (local NTID store)
  function loginWithNTID(ntid, remember=false){
    if(!ntid) { toast('Enter NTID','error'); return; }
    let users = LS.get('users') || [];
    let user = users.find(u => u.ntid.toLowerCase() === ntid.toLowerCase());
    if(!user){ user = { id: 'u_' + ntid.toLowerCase(), ntid, displayName: ntid, email: `${ntid}@Bosch.in` }; users.push(user); LS.set('users', users); }
    setSession({ id: user.id, ntid: user.ntid, email: user.email, displayName: user.displayName });
    if(remember) localStorage.setItem(LS.key('remember_ntid'), user.ntid);
    qs('#user-greeting') && (qs('#user-greeting').textContent = user.ntid);
    qs('#contact-email') && (qs('#contact-email').value = `${user.ntid}@Bosch.in`);
    toast('Logged in', 'success');
    (async()=>{ try{ await refreshEvents(); await refreshSubsForUser(currentUser); } catch(e){ /* handled */ } })();
  }

  // Boot
  document.addEventListener('DOMContentLoaded', () => {
    if(!LS.get('users')) LS.set('users', [{ id:'u_demo', ntid:'demo', displayName:'demo', email:'demo@Bosch.in' }]);
    loadSession();
    initCreateEventForm();
    // wire login button
    const loginBtn = qs('#login-btn'); if(loginBtn) loginBtn.addEventListener('click', (e)=>{ e.preventDefault(); const ntid = (qs('#ntid')||{}).value?.trim() || ''; const rem = !!(qs('#remember') && qs('#remember').checked); loginWithNTID(ntid, rem); });
  });

  // expose helpers for debugging
  window.EN = { Api, restRequest };
})(); // end IIFE
