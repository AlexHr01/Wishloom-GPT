(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { token: null, items: [], title: 'My wishlist', editing: null, selected: new Set(), selectedCompleted: false, flipped: new Set(), toastTimer: null, imageTimer: null, priceFilter: null };
  const ROOT_KEY = 'wishloom.home.v2';
  const PALETTES = [
    ['#66508d','#b88bd0'],['#373f7d','#8f9dd6'],['#874675','#dba4cc'],
    ['#3d4b84','#9588cb'],['#613e7b','#c08bc0'],['#343c73','#919dd0'],
    ['#604078','#b878a7'],['#493864','#a783c8']
  ];
  let api = '';
  const asText = v => String(v ?? '');
  const escapeHTML = v => asText(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isURL = value => { try { const p = new URL(value, location.href); return ['http:', 'https:'].includes(p.protocol) && !!p.hostname && !p.username && !p.password; } catch { return false; } };
  const priceFormat = n => n == null ? 'Price not set' : new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2}).format(n);
  const wishTier = price => {
    if (price == null || price === '') return { key:'none', label:'UNPRICED', preview:'NO PRICE SET' };
    const p = Number(price);
    if (p <= 20) return {key:'indigo',label:'TIER 01',preview:'TIER 1 · PERIWINKLE'};
    if (p <= 50) return {key:'yellow',label:'TIER 02',preview:'TIER 2 · YELLOW'};
    if (p <= 75) return {key:'orange',label:'TIER 03',preview:'TIER 3 · ORANGE'};
    return {key:'red',label:'TIER 04',preview:'TIER 4 · RED'};
  };
  const itemTier = item => wishTier(item.price);
  const palette = name => { const hash = [...name].reduce((acc,c)=>(acc*31+c.charCodeAt(0))|0,17);return PALETTES[Math.abs(hash)%PALETTES.length]; };
  const notify = (message, error = false) => {
    const el = $('toast');
    el.textContent = message; el.classList.toggle('error',error); el.classList.add('shown');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('shown'), 3300);
  };
  const fetchJSON = async (url, options) => {
    const response = await fetch(url, { cache:'no-store', ...options });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  };
  const jsonBody = (method, body) => ({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

  async function start() {
    const match = location.pathname.match(/^\/w\/([A-Za-z0-9_-]{40,60})$/);
    if (!match) {
      // A brand-new browser gets a fresh unlisted room automatically — no marketing landing page.
      let existing = '';
      try { existing = localStorage.getItem(ROOT_KEY) || ''; } catch {}
      if (/^\/w\/[A-Za-z0-9_-]{40,60}$/.test(existing)) {
        try { await fetchJSON('/api' + existing); location.replace(existing); return; } catch {}
      }
      try {
        const result = await fetchJSON('/api/wishlists', jsonBody('POST',{title:'My wishlist'}));
        try { localStorage.setItem(ROOT_KEY, result.url); } catch {}
        location.replace(result.url);
      } catch(err) {
        $('emptyTitle').textContent = 'Could not open your wishlist.';
        $('emptyDescription').textContent = err.message;
        notify(err.message,true);
      }
      return;
    }
    state.token = match[1]; api = '/api/w/' + state.token;
    try { if (!localStorage.getItem(ROOT_KEY)) localStorage.setItem(ROOT_KEY, location.pathname); } catch {}
    try { await load(); } catch(err) { $('emptyTitle').textContent = 'Unable to load this wishlist.'; $('emptyDescription').textContent = err.message;notify(err.message,true); }
  }
  async function load() {
    const data = await fetchJSON(api);
    state.items = data.items;
    state.title = data.title;
    $('listTitle').innerHTML = escapeHTML(state.title) + '<span class="title-period">.</span>';
    document.title = state.title + ' — Wishloom';
    render();
  }
  
const filterItems = (items) => {
  const mode = $('sortSelect').value;
  const tierFilter = state.priceFilter;
  return items.filter(item => {
    const tier = itemTier(item).key;
    if (tierFilter && tier !== tierFilter) return false;
    if (mode === 'high') return item.score >= 8;
    if (mode === 'medium') return item.score >= 4 && item.score <= 7;
    if (mode === 'low') return item.score <= 3;
    return true;
  }).sort((a,b) => {
    if (mode === 'new') return b.created_at.localeCompare(a.created_at);
    if (mode === 'old') return a.created_at.localeCompare(b.created_at);
    if (mode === 'price') return (a.price ?? Infinity) - (b.price ?? Infinity) || b.score - a.score;
    if (mode === 'alpha') return a.name.localeCompare(b.name);
    return b.score - a.score || b.created_at.localeCompare(a.created_at);
  });
};

  
function makeCard(item, completed = false) {
  const card = document.createElement('article');
  card.className = 'wish-card' + (state.flipped.has(item.id) ? ' is-flipped' : '') + (state.selected.has(item.id) ? ' is-selected' : '');
  card.dataset.id = item.id;
  card.setAttribute('role','group');
  const tier = itemTier(item);
  const [a,b] = palette(item.name);
  const photo = item.image_url && isURL(item.image_url) ? `<img src="${escapeHTML(item.image_url)}" alt="${escapeHTML(item.name)}" loading="lazy" referrerpolicy="no-referrer">` : '';
  const links = (item.links || []).filter(link => isURL(link.url));
  const linkHTML = links.length ? links.map(link => `<a class="product-link" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="${escapeHTML(link.url)}">↗ ${escapeHTML(link.label || new URL(link.url).hostname)}</a>`).join('') : '<p class="no-links">No shopping links added yet.</p>';
  const selected = state.selected.has(item.id);
  const giftIcon = `<svg class="gift-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="1.8"></rect><path d="M12 11v10"></path><path d="M3 7.8h18v3.2H3z"></path><path d="M12 7.8H8.2a2.2 2.2 0 1 1 0-4.4c2.8 0 3.8 4.4 3.8 4.4z"></path><path d="M12 7.8h3.8a2.2 2.2 0 1 0 0-4.4c-2.8 0-3.8 4.4-3.8 4.4z"></path></svg>`;
  card.innerHTML = `
    <div class="card-rotator">
      <div class="card-face card-front">
        <div class="card-visual ${photo ? '' : 'no-photo'}" style="--art-a:${a};--art-b:${b}">${photo}${giftIcon}<span class="art-symbol" aria-hidden="true">🎁</span></div><div class="card-vignette"></div>
        <div class="card-top"><span class="tier-badge tier-${tier.key}">${tier.key === 'none' ? 'No price' : (item.price != null ? priceFormat(item.price) : 'No price')}</span><span class="score-pill"><strong>${item.score}</strong></span></div>
        <div class="card-bottom"><div class="small-label">${completed?'WISH GRANTED ✦':'THE WISHLIST ✦'}</div><h3>${escapeHTML(item.name)}</h3><div class="card-hint">${item.description ? escapeHTML(item.description.slice(0, 72)) : 'No description'}</div></div>
        <div class="card-actions card-front-actions"><button type="button" class="card-mark" aria-label="${selected ? 'Unmark':'Mark'} ${escapeHTML(item.name)} for actions" aria-pressed="${selected}" title="Mark for actions">${selected?'✓':'○'}</button><button type="button" class="card-flip" aria-label="Flip ${escapeHTML(item.name)}">⟳ Flip</button></div>
      </div>
      <div class="card-face card-back">
        <div class="back-header"><span class="back-mini">${completed?'✦ DREAM COME TRUE':'✦ THE DETAILS'}</span><span class="score-pill small-score"><strong>${item.score}</strong></span></div>
        <h3 class="back-title">${escapeHTML(item.name)}</h3>
        <p class="back-description ${item.description?'':'quiet'}">${item.description ? escapeHTML(item.description) : 'No extra details yet. Add a color, size or model anytime.'}</p>
        <div class="back-stats"><span class="tier-badge tier-${tier.key}">${tier.key === 'none' ? 'No price' : tier.label}</span><span class="price-tag">${escapeHTML(priceFormat(item.price))}</span></div>
        <div class="link-label">WHERE TO FIND IT</div><div class="back-links">${linkHTML}</div>
        <div class="card-actions card-back-actions"><button type="button" class="card-mark" aria-label="${selected ? 'Unmark':'Mark'} ${escapeHTML(item.name)} for actions" aria-pressed="${selected}" title="Mark for actions">${selected?'✓':'○'}</button><button type="button" class="card-flip" aria-label="Flip back ${escapeHTML(item.name)}">⟳ Flip</button></div>
      </div>
    </div>
  `;
  card.querySelectorAll('.card-mark').forEach(btn => btn.addEventListener('click', event => { event.stopPropagation(); toggleMark(item); }));
  card.querySelectorAll('.card-flip').forEach(btn => btn.addEventListener('click', event => { event.stopPropagation(); flip(item.id, card); }));
  const img = card.querySelector('.card-visual img');
  if (img) img.addEventListener('error', () => { img.remove(); card.querySelector('.card-visual').classList.add('no-photo'); });
  card.addEventListener('pointermove', event => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = card.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    const tiltY = (px - 0.5) * 10;
    const tiltX = (0.5 - py) * 10;
    card.style.setProperty('--tilt-x', tiltX.toFixed(2) + 'deg');
    card.style.setProperty('--tilt-y', tiltY.toFixed(2) + 'deg');
    card.style.setProperty('--glow-x', (px * 100).toFixed(1) + '%');
    card.style.setProperty('--glow-y', (py * 100).toFixed(1) + '%');
  });
  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--tilt-x', '0deg');
    card.style.setProperty('--tilt-y', '0deg');
    card.style.setProperty('--glow-x', '50%');
    card.style.setProperty('--glow-y', '30%');
  });
  return card;
}

  function flip(id,card) {
    if (state.flipped.has(id)) state.flipped.delete(id); else state.flipped.add(id);
    card.classList.toggle('is-flipped',state.flipped.has(id));
    card.setAttribute('aria-expanded',String(state.flipped.has(id)));
  }
  function render() {
    const active = state.items.filter(i=>!i.completed);
    const completed = state.items.filter(i=>i.completed).sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||''));
    const visible = filterItems(active);
    $('activeCount').textContent = active.length;
    $('completeCount').textContent = completed.length;
    $('visibleCount').textContent = visible.length + (visible.length === 1?' item':' items');
    $('completedLabel').textContent = completed.length;
    $('activeGrid').replaceChildren(...visible.map(item=>makeCard(item)));
    $('completedGrid').replaceChildren(...completed.map(item=>makeCard(item,true)));
    $('emptyState').classList.toggle('hidden',visible.length > 0);
    $('emptyNew').classList.toggle('hidden',active.length > 0);
    if (active.length && !visible.length) {
      $('emptyTitle').textContent = 'No wishes in this filter.';
      $('emptyDescription').textContent = 'Pick a different filter to see your wishes.';
    } else if (!active.length && completed.length) {
      $('emptyTitle').textContent = 'Everything on your list is complete!';
      $('emptyDescription').textContent = 'Feel like dreaming about something new?';
    } else {
      $('emptyTitle').textContent = 'A blank canvas for big dreams.';
      $('emptyDescription').textContent = 'Your wishlist is waiting for its very first wish.';
    }
    $('completedEmpty').classList.toggle('hidden',completed.length > 0);
    document.querySelectorAll('.tier-filter-pill').forEach(btn => btn.classList.toggle('is-active', btn.dataset.price === state.priceFilter));
    $('clearFilters').classList.toggle('is-active', Boolean(state.priceFilter || $('sortSelect').value !== 'score'));
    const activeFilterCount = Number(Boolean(state.priceFilter)) + Number($('sortSelect').value !== 'score');
    $('filterActiveCount').hidden = !activeFilterCount;
    $('filterActiveCount').textContent = String(activeFilterCount);
    $('filterToggle').classList.toggle('has-active-filters', activeFilterCount > 0);
    updateSelectionTray();
  }
  function toggleMark(item) {
    if (state.selected.has(item.id)) state.selected.delete(item.id);
    else {
      if (state.selected.size && item.completed !== state.selectedCompleted) state.selected.clear();
      state.selectedCompleted = item.completed;
      state.selected.add(item.id);
    }
    render();
  }
  function clearSelection() { state.selected.clear(); render(); }
  function updateSelectionTray() {
    const count = state.selected.size;
    $('selectionTray').classList.toggle('hidden',!count);
    $('selectedCount').textContent = `${count} selected`;
    $('adjustSelected').disabled = count !== 1;
    $('statusSelected').textContent = state.selectedCompleted ? '↶ Add again' : '✓ Complete';
  }


  function setFilterPanel(open) {
    const panel = $('filterReveal');
    const toggle = $('filterToggle');
    panel.classList.toggle('is-open', open);
    panel.inert = !open;
    panel.setAttribute('aria-hidden', String(!open));
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-open', open);
    if (!open && panel.contains(document.activeElement)) toggle.focus();
  }
  function clearFilters() {
    state.priceFilter = null;
    $('sortSelect').value = 'score';
    render();
  }

  function addLink(label='',url='') {
    const rows = $('linkRows');
    if (rows.children.length >= 8) { notify('Maximum 8 links per wish.',true);return; }
    const row = document.createElement('div'); row.className='link-input-row';
    row.innerHTML = '<input type="text" class="link-name" maxlength="65" placeholder="e.g. Instagram" aria-label="Link label"><input type="url" class="link-url" placeholder="https://..." aria-label="Link URL"><button type="button" class="remove-link" aria-label="Remove link">×</button>';
    row.querySelector('.link-name').value = label; row.querySelector('.link-url').value=url;
    row.querySelector('.remove-link').addEventListener('click',()=>row.remove());
    rows.appendChild(row); row.querySelector('.link-name').focus();
  }
  function updateRating() { $('ratingValue').textContent = $('itemRating').value; }
  function updateTierPreview() {
    const price = $('itemPrice').value;
    const tier = wishTier(price === '' ? null : Number(price));
    $('tierPreview').className = `tier-preview tier-${tier.key}`;
    $('tierPreview').querySelector('span').textContent=tier.preview;
  }
  function openAdd() {
    state.editing = null; $('wishForm').reset();
    $('itemRating').value='8'; $('itemPrice').value='';$('linkRows').replaceChildren();
    $('dialogTitle').innerHTML = 'Something you\'re dreaming of<span>.</span>';
    $('saveBtn').innerHTML = 'Add to wishlist <span>↗</span>';
    $('wishDialog').querySelector('.advanced').open=false;
    updateRating();updateTierPreview();$('wishDialog').showModal();$('itemName').focus();
  }
  function openEdit(id) {
    const item = state.items.find(i=>i.id===id); if (!item)return;
    state.editing=id; $('wishForm').reset();
    $('itemName').value=item.name;
    $('itemDescription').value=item.description||'';
    $('itemRating').value=item.score;
    $('itemPrice').value=item.price ?? '';
    $('customImage').value=item.image_source==='manual' ? item.image_url : '';
    $('linkRows').replaceChildren();
    (item.links||[]).forEach(l=>addLink(l.label,l.url));
    $('dialogTitle').innerHTML = 'Fine-tune this wish<span>.</span>';
    $('saveBtn').innerHTML = 'Save changes <span>↗</span>';
    $('wishDialog').querySelector('.advanced').open=Boolean($('customImage').value);
    updateRating();updateTierPreview();$('wishDialog').showModal();$('itemName').focus();
  }
  async function saveWish(event) {
    event.preventDefault();
    const payload={
      name:$('itemName').value.trim(),
      score:Number($('itemRating').value),
      description:$('itemDescription').value.trim(),
      price:$('itemPrice').value===''?null:Number($('itemPrice').value),
      links:[...$('linkRows').children].map(row=>({label:row.querySelector('.link-name').value.trim(),url:row.querySelector('.link-url').value.trim()})).filter(l=>l.label||l.url),
      image_url:$('customImage').value.trim()
    };
    if (!payload.name){notify('Please name your wish.',true);$('itemName').focus();return;}
    if (payload.price !== null && (!Number.isFinite(payload.price) || payload.price < 0)){notify('Please enter a valid estimated price.',true);return;}
    if (payload.image_url && !isURL(payload.image_url)){notify('Please enter a valid image URL.',true);return;}
    if (payload.links.some(l=>!isURL(l.url))){notify('Please check the shopping links.',true);return;}
    $('saveBtn').disabled=true;
    try{
      if(state.editing){
        const item=await fetchJSON(api+'/items/'+state.editing,jsonBody('PUT',payload));
        state.items=state.items.map(i=>i.id===item.id?item:i);
        notify('Wish updated ✳');
      }else{
        const item=await fetchJSON(api+'/items',jsonBody('POST',payload));
        state.items.unshift(item);
        notify('A new wish has been added ✦');
      }
      $('wishDialog').close();clearSelection();startImagePolling();
    }catch(err){notify(err.message,true)}
    finally{$('saveBtn').disabled=false;}
  }
  async function updateCompletion() {
    const selected = [...state.selected]; if(!selected.length)return;
    $('statusSelected').disabled=true;
    try {
      const updates=[];
      for(const id of selected)updates.push(await fetchJSON(api+'/items/'+id,jsonBody('PATCH',{completed:!state.selectedCompleted})));
      const byID = new Map(updates.map(x=>[x.id,x]));
      state.items=state.items.map(x=>byID.get(x.id)||x);
      state.selected.clear();updates.forEach(x=>state.flipped.delete(x.id));render();
      notify(state.selectedCompleted?'Back on your wishlist ↶':'Wish completed — beautiful! ✦');
    }catch(err){notify(err.message,true);await load();}
    finally{$('statusSelected').disabled=false;}
  }
  async function deleteSelection() {
    const ids=[...state.selected]; if(!ids.length)return;
    const names=ids.map(id=>state.items.find(i=>i.id===id)?.name).filter(Boolean);
    if(!confirm(`Remove ${ids.length===1?'“'+names[0]+'”':ids.length+' wishes'} permanently?`))return;
    try{
      for(const id of ids) await fetchJSON(api+'/items/'+id,{method:'DELETE'});
      state.items=state.items.filter(x=>!state.selected.has(x.id));
      ids.forEach(id=>state.flipped.delete(id));state.selected.clear();render();notify('Wish removed.');
    }catch(err){notify(err.message,true);await load();}
  }
  async function share() {
    const text=location.origin+'/w/'+state.token;
    try{
      if(navigator.clipboard && isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity=0;document.body.append(area);area.select();
        if(!document.execCommand('copy'))throw Error('Copy unavailable');area.remove();
      }
      notify('Private link copied! Anyone with it can edit ✳');
    }catch{window.prompt('Copy your private wishlist link:',text);}
  }
  function startImagePolling() {
    clearInterval(state.imageTimer);let attempts=0;
    state.imageTimer=setInterval(async()=>{
      if(++attempts>20){clearInterval(state.imageTimer);return;}
      try{
        const data=await fetchJSON(api);
        const old=new Map(state.items.map(i=>[i.id,i.image_url]));
        const changed=data.items.some(i=>old.has(i.id)&&old.get(i.id)!==i.image_url);
        if(changed){state.items=data.items;render();}
        if(!data.items.some(i=>i.image_source==='pending')) clearInterval(state.imageTimer);
      }catch{clearInterval(state.imageTimer);}
    },6000);
  }
  async function rename(event){
    event.preventDefault();
    try{const result=await fetchJSON(api,jsonBody('PATCH',{title:$('renameInput').value.trim()}));state.title=result.title;
      $('listTitle').innerHTML=escapeHTML(state.title)+'<span class="title-period">.</span>';document.title=state.title+' — Wishloom';$('renameDialog').close();notify('Wishlist renamed.');
    }catch(err){notify(err.message,true)}
  }
  $('newBtn').addEventListener('click',openAdd);
  $('emptyNew').addEventListener('click',openAdd);
  $('shareTop').addEventListener('click',share);
  $('sortSelect').addEventListener('change',render);
  $('filterToggle').addEventListener('click', () => setFilterPanel(!$('filterReveal').classList.contains('is-open')));
  $('filterReveal').addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); setFilterPanel(false); }});
  document.querySelectorAll('.tier-filter-pill').forEach(btn => btn.addEventListener('click', () => { state.priceFilter = state.priceFilter === btn.dataset.price ? null : btn.dataset.price; render(); }));
  $('clearFilters').addEventListener('click', clearFilters);
  $('clearSelection').addEventListener('click',clearSelection);
  $('adjustSelected').addEventListener('click',()=>{const id=[...state.selected][0];if(id){clearSelection();openEdit(id);}});
  $('statusSelected').addEventListener('click',updateCompletion);
  $('deleteSelected').addEventListener('click',deleteSelection);
  $('addLinkBtn').addEventListener('click',()=>addLink());
  $('itemRating').addEventListener('input',updateRating);
  $('itemPrice').addEventListener('input',updateTierPreview);
  $('wishForm').addEventListener('submit',saveWish);
  $('closeDialog').addEventListener('click',()=>$('wishDialog').close());
  $('cancelDialog').addEventListener('click',()=>$('wishDialog').close());
  $('wishDialog').addEventListener('click',e=>{if(e.target===$('wishDialog'))$('wishDialog').close();});
  $('renameBtn').addEventListener('click',()=>{$('renameInput').value=state.title;$('renameDialog').showModal();$('renameInput').focus();});
  $('renameForm').addEventListener('submit',rename);
  $('closeRename').addEventListener('click',()=>$('renameDialog').close());
  $('cancelRename').addEventListener('click',()=>$('renameDialog').close());
  $('renameDialog').addEventListener('click',e=>{if(e.target===$('renameDialog'))$('renameDialog').close();});
  start();
})();
