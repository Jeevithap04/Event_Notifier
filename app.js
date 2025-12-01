/* Clean localStorage-backed app.js for Event Notifier
   - Drop-in replacement for the HTML you uploaded.
   - Handles Login (NTID), Create (Draft & Publish), My Events, Browse, Subscribe.
*/

(() => {
  const STORAGE_PREFIX = 'enotifier_';
  const LS = {
    key(k){ return STORAGE_PREFIX + k; },
    get(k){ try { return JSON.parse(localStorage.getItem(this.key(k))); } catch(e){ return null; } },
    set(k,v){ localStorage.setItem(this.key(k), JSON.stringify(v)); },
    remove(k){ localStorage.removeItem(this.key(k)); }
  };

  // utilities
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

  // --- Data layer (localStorage)
  function seedIfEmpty(){
    if(!LS.get('users')) LS.set('users', [{ id:'u_demo', ntid:'demo', displayName:'demo', email:'demo@Bosch.in' }]);
    if(!LS.get('events')) LS.set('events', []);
    if(!LS.get('subs')) LS.set('subs', []);
  }

  function getEvents(){ return LS.get('events') || []; }
  function saveEvents(arr){ LS.set('events', Array.isArray(arr)?arr:[]); }
  function getSubs(){ return LS.get('subs') || []; }
  function saveSubs(arr){ LS.set('subs', Array.isArray(arr)?arr:[]); }

  // --- Session
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

  // --- Helpers
  function todayISO(){ return (new Date()).toISOString().slice(0,10); }
  function computeStatus(ev){
    const now = new Date();
    const start = ev.startDate ? new Date(ev.startDate + 'T00:00:00') : null;
    const end = ev.endDate ? new Date(ev.endDate + 'T00:00:00') : null;
    // normalize today's midnight to compare dates only
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if(end && end < todayMid) return 'expired';
    if(start && start <= now && (!end || end >= now)) return 'ongoing';
    return 'upcoming';
  }

  // --- Rendering / UI ---
  function renderDashboardCounts(){
    const events = getEvents();
    const myEvents = currentUser ? events.filter(e => e.ownerId === currentUser.id) : [];
    const published = myEvents.filter(e => e.published && !e.draft);
    const subs = getSubs().filter(s => (currentUser && (s.userId === currentUser.id || s.email && s.email.toLowerCase() === currentUser.email.toLowerCase())));
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

  // Event delegation for owner events
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

  function handleDeleteEvent(id){
    if(!confirm('Delete this event?')) return;
    let events = getEvents().filter(e => e.id !== id);
    saveEvents(events);
    let subs = getSubs().filter(s => s.eventId !== id);
    saveSubs(subs);
    toast('Event deleted', 'success');
    renderOwnerEventsTabs();
    reloadBrowse(true);
    renderDashboardCounts();
    loadMySubscriptions();
  }

  function handleEditEvent(id){
    const ev = getEvents().find(x => x.id === id && x.ownerId === currentUser.id);
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
    const idx = events.findIndex(e => e.id === id && e.ownerId === currentUser.id);
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

  // --- Create form handling ---
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

    saveDraftBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if(!currentUser){ toast('Please login to save drafts','error'); return; }
      const payload = gatherFormData();
      const editing = sessionStorage.getItem('editing_event');
      const events = getEvents();
      if(editing){
        const idx = events.findIndex(x => x.id === editing && x.ownerId === currentUser.id);
        if(idx !== -1){
          events[idx] = Object.assign({}, events[idx], payload, { draft:true, published:false, status: computeStatus(payload) });
          saveEvents(events);
          sessionStorage.removeItem('editing_event');
          toast('Draft updated', 'success');
          renderOwnerEventsTabs();
          renderDashboardCounts();
          reloadBrowse(true);
          showSection('my-event');
          form.reset();
          qs('#contact-email').value = `${currentUser.ntid}@Bosch.in`;
          return;
        }
      }
      // new draft
      const id = uid();
      events.push(Object.assign({
        id, ownerId: currentUser.id, draft:true, published:false, subscriberIds:[], createdAt: new Date().toISOString()
      }, payload, { status: computeStatus(payload) }));
      saveEvents(events);
      toast('Draft saved', 'success');
      renderOwnerEventsTabs();
      renderDashboardCounts();
      showSection('my-event');
      form.reset();
      qs('#contact-email').value = `${currentUser.ntid}@Bosch.in`;
    });

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = validateFormFields();
      if(!v.ok){ toast(v.msg, 'error'); if(v.field) v.field.focus(); return; }
      if(!currentUser){ toast('Please login to publish', 'error'); return; }

      const payload = gatherFormData();
      const events = getEvents();
      const editing = sessionStorage.getItem('editing_event');
      if(editing){
        const idx = events.findIndex(x => x.id === editing && x.ownerId === currentUser.id);
        if(idx !== -1){
          events[idx] = Object.assign({}, events[idx], payload, { published:true, draft:false, status: computeStatus(payload), _lastPublishedAt: new Date().toISOString() });
          saveEvents(events);
          sessionStorage.removeItem('editing_event');
          toast('Event updated & published', 'success');
          form.reset();
          qs('#contact-email').value = `${currentUser.ntid}@Bosch.in`;
          renderOwnerEventsTabs();
          renderDashboardCounts();
          reloadBrowse(true);
          return;
        } else {
          toast('Update failed', 'error');
          return;
        }
      } else {
        const id = uid();
        events.push(Object.assign({
          id, ownerId: currentUser.id, published:true, draft:false, subscriberIds:[], createdAt: new Date().toISOString(), _lastPublishedAt: new Date().toISOString()
        }, payload, { status: computeStatus(payload) }));
        saveEvents(events);
        toast('Event published', 'success');
        form.reset();
        qs('#contact-email').value = `${currentUser.ntid}@Bosch.in`;
        renderOwnerEventsTabs();
        renderDashboardCounts();
        reloadBrowse(true);
        return;
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

  // --- Browse & subscribe ---
  let browsePage = 1;
  const pageSize = 6;
  const loadMoreSize = 5;

  function reloadBrowse(reset=true){
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
          <button class="subscribe-btn" data-id="${ev.id}">${isSubscribed(ev.id)?'Subscribed':'Subscribe'}</button>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function isSubscribed(eventId){
    if(!currentUser) return false;
    return getSubs().some(s => s.eventId === eventId && s.userId === currentUser.id);
  }

  function toggleSubscribe(eventId){
    if(!currentUser){
      const email = prompt('Enter your email to subscribe');
      if(!email) return toast('Email required', 'error');
      const ev = getEvents().find(e => e.id === eventId);
      if(!ev) return toast('Event not found', 'error');
      const existing = getSubs().filter(s => s.eventId === eventId && s.email && s.email.toLowerCase() === email.toLowerCase());
      if(existing.length){
        // unsubscribe
        let subs = getSubs().filter(s => !(s.eventId === eventId && s.email && s.email.toLowerCase() === email.toLowerCase()));
        saveSubs(subs);
        toast('Unsubscribed', 'info');
      } else {
        const subs = getSubs();
        subs.push({ id: uid(), userId: null, eventId, email, autoRenew:true, createdAt: new Date().toISOString() });
        saveSubs(subs);
        toast('Subscribed (by email)', 'success');
      }
    } else {
      const subs = getSubs();
      const idx = subs.findIndex(s => s.eventId === eventId && s.userId === currentUser.id);
      if(idx !== -1){
        subs.splice(idx,1);
        saveSubs(subs);
        // remove subscriberId from event
        const events = getEvents(); const ev = events.find(e => e.id === eventId);
        if(ev) ev.subscriberIds = (ev.subscriberIds||[]).filter(id => id !== currentUser.id);
        saveEvents(events);
        toast('Unsubscribed', 'info');
      } else {
        subs.push({ id: uid(), userId: currentUser.id, eventId, email: currentUser.email, autoRenew:true, createdAt: new Date().toISOString() });
        saveSubs(subs);
        const events = getEvents(); const ev = events.find(e => e.id === eventId);
        if(ev) ev.subscriberIds = ev.subscriberIds || [], ev.subscriberIds.push(currentUser.id);
        saveEvents(events);
        toast('Subscribed', 'success');
      }
    }
    renderOwnerEventsTabs();
    loadMySubscriptions();
    reloadBrowse(true);
  }

  function loadMySubscriptions(){
    const container = qs('#subscription-list');
    if(!container) return;
    if(!currentUser){ container.innerHTML = '<div class="empty-state">Login to see subscriptions</div>'; return; }
    const subs = getSubs().filter(s => s.userId === currentUser.id || (s.email && s.email.toLowerCase() === currentUser.email.toLowerCase()));
    if(subs.length === 0){ container.innerHTML = '<div class="empty-state">No subscriptions yet.</div>'; return; }
    const rows = subs.map(s => {
      const ev = getEvents().find(e => e.id === s.eventId) || { name:'(deleted)', endDate:'-', status:'expired' };
      const statusClass = ev.status==='expired' ? 'status-expired' : (ev.status==='upcoming' ? 'status-warning' : 'status-active');
      return `<div class="subs-row" data-id="${s.id}" data-eventid="${ev.id}">
        <div class="col event-name">${escapeHtml(ev.name)}</div>
        <div class="col renewal">${escapeHtml(ev.endDate||'-')}</div>
        <div class="col status"><span class="status-badge ${statusClass}">${escapeHtml(ev.status||'Active')}</span></div>
        <div class="col autorenew">${s.autoRenew? 'Yes':'No'}</div>
        <div class="col actions"><button class="btn btn-outline btn-sm unsub-btn" data-eventid="${ev.id}">Unsubscribe</button></div>
      </div>`;
    }).join('');
    container.innerHTML = rows;
    container.querySelectorAll('.unsub-btn').forEach(b => {
      b.addEventListener('click', () => {
        if(!confirm('Unsubscribe?')) return;
        const evId = b.dataset.eventid;
        let subs = getSubs().filter(s => !(s.eventId === evId && (s.userId === currentUser.id || (s.email && s.email.toLowerCase() === currentUser.email.toLowerCase()))));
        saveSubs(subs);
        const evs = getEvents();
        const ev = evs.find(x => x.id === evId);
        if(ev) ev.subscriberIds = (ev.subscriberIds||[]).filter(id => id !== currentUser.id);
        saveEvents(evs);
        toast('Unsubscribed', 'info');
        loadMySubscriptions(); renderOwnerEventsTabs(); renderDashboardCounts();
      });
    });
  }

  // --- Navigation, tabs, wiring ---
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

    const lp = document.getElementById('login-page'); const mw = document.getElementById('main-website');
    if(lp) lp.style.display='none';
    if(mw) mw.style.display='block';
    document.body.classList.remove('login-active');
    qs('#user-greeting').textContent = user.ntid;
    qs('#contact-email').value = `${user.ntid}@Bosch.in`;
    showSection('dashboard');

    // initialize UI lists
    renderDashboardCounts(); renderOwnerEventsTabs(); initCreateEventForm(); initOwnerEventsDelegation(); wireMyEventTabs(); loadMySubscriptions(); reloadBrowse(true);

    toast(`Welcome ${user.ntid}`, 'success', 1600);
  }

  function logoutFlow(){
    clearSession();
    const lp = document.getElementById('login-page'); const mw = document.getElementById('main-website');
    if(lp) lp.style.display='flex';
    if(mw) mw.style.display='none';
    document.body.classList.add('login-active');
  }

  // --- Boot and event wiring ---
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
      toggleSubscribe(btn.dataset.id);
      // flip text/update immediately
      setTimeout(()=> {
        const isSub = isSubscribed(btn.dataset.id);
        btn.classList.toggle('subscribed', isSub);
        btn.textContent = isSub ? 'Subscribed' : 'Subscribe';
      }, 60);
    });
  }
  function debounce(fn, t=200){ let to=null; return (...a)=>{ clearTimeout(to); to=setTimeout(()=>fn(...a), t); }; }

  function boot(){
    seedIfEmpty();
    loadSession();

    // if remembered NTID -> auto login
    const rem = localStorage.getItem(LS.key('remember_ntid'));
    if(rem && !currentUser) { loginWithNTID(rem, true); return; }

    if(currentUser){
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('main-website').style.display = 'block';
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

    // login button
    const loginBtn = qs('#login-btn');
    if(loginBtn) loginBtn.addEventListener('click', (e)=> { e.preventDefault(); const ntid = qs('#ntid').value.trim(); const remember = !!qs('#remember').checked; if(!ntid) return toast('Please enter NTID', 'error'); loginWithNTID(ntid, remember); });

    wireNav();
    initBrowseHandlers();
    initCreateEventForm();
    initOwnerEventsDelegation();
    wireMyEventTabs();
  }

  // view-all links routing
  qsa('.panel-header .view-all').forEach(v => {
    v.addEventListener('click', e => {
      e.preventDefault();
      const type = v.dataset.open;
      if (type === 'renewals') showSection('my-event');
      if (type === 'recent-subs') showSection('my-subscription');
    });
  });

  // profile dropdown wiring (if present)
  const pd = qs('#profile-dropdown');
  const pb = qs('#profile-btn');
  if(pb) {
    pb.addEventListener('click', (e)=>{ e.stopPropagation(); pd && pd.classList.toggle('hidden'); if(currentUser) qs('#pd-ntid').textContent = currentUser.ntid + "@Bosch.com"; });
  }
  document.addEventListener('click', ()=> pd && pd.classList.add('hidden') );

  // logout button
  const logoutBtn = qs('.logout-btn');
  if(logoutBtn) {
    logoutBtn.addEventListener('click', ()=>{ if(confirm("Are you sure you want to logout?")) logoutFlow(); });
  }

  document.addEventListener('DOMContentLoaded', boot);

  // expose some helpers for debugging
  window.EN = { LS, getEvents, saveEvents, getSubs, saveSubs, uid };

})();
