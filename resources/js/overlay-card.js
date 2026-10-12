// The cards over EVO, drawn in overlay.html (the windows over the game,
// overlay.js). A plain script, not a module, so a page opened straight from the
// folder in a browser can use it too.
//   The result: a banner at the top centre, slid down from above: the medal on a
//   plate of its metal, then the event and the time.
//     { kicker (level · event), title (the medal), tier, time, sub }
//     tier: bronze | silver | gold | platinum, '' (no medal) or 'void' (a run or lap
//     that doesn't count; sub says why when it isn't plain)
//   The safety rating: a tile on the right, slid in from the edge: "SR" and three
//   chevrons, down (lost: 1 lit green, 2 amber, 3 red) or up (gained).
//     { sr: { dir: 'down' | 'up', level: 1 | 2 | 3 } }
(() => {
  const chevron = d => `<svg viewBox="0 0 100 58" aria-hidden="true"><path class="ov-chev" d="${d}"/><path class="ov-chev-shade" d="${d}"/></svg>`;
  const CHEVRON = { down: chevron('M0 0l50 28L100 0v30L50 58 0 30z'), up: chevron('M0 58l50-28 50 28V28L50 0 0 28z') };
  const el = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };

  function banner(s) {
    const card = el('div', `ov-card ${s.tier || 'none'}`);
    const plate = el('div', 'ov-plate'), info = el('div', 'ov-info');
    plate.append(el('span', 'ov-title', s.title));
    info.append(el('div', 'ov-kicker', s.kicker));
    if (s.time) info.append(el('div', 'ov-time', s.time));
    if (s.sub) info.append(el('div', 'ov-sub', s.sub));
    info.append(el('i', 'ov-timer'));
    card.append(plate, info);
    return card;
  }

  // The lit chevrons' light (overlay.css .ov-chev-shade), once in the page.
  const SHADE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><linearGradient id="ov-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></svg>';

  function tile({ dir = 'down', level = 1 }) {
    if (!document.getElementById('ov-shade')) document.body.insertAdjacentHTML('beforeend', SHADE);
    const card = el('div', `ov-sr ${dir} l${level}`);
    const chevrons = el('div', 'ov-chevrons');
    chevrons.innerHTML = [0, 1, 2].map(i => `<i class="${i < level ? 'on' : ''}" style="--i:${dir === 'up' ? 2 - i : i}">${CHEVRON[dir] || CHEVRON.down}</i>`).join('');
    card.append(el('div', 'ov-sr-label', 'SR'), chevrons);
    return card;
  }

  window.OverlayCard = {
    // Puts a new card in `root`, out of sight; returns it. seconds: how long it stays.
    render(root, s, seconds = 8) {
      const card = s.sr ? tile(s.sr) : banner(s);
      card.style.setProperty('--secs', `${seconds}s`);
      root.replaceChildren(card);
      return card;
    },

    // Slides it in.
    enter(card) {
      void card.offsetWidth; // its start, out of sight, laid out first: the slide runs from there
      card.classList.add('in', 'run'); // run: its timer and lights, kept while it slides out
    },

    // Slides it back out; resolves when it's gone.
    leave(card) {
      card.classList.remove('in');
      return new Promise(r => setTimeout(r, 520));
    },
  };
})();
