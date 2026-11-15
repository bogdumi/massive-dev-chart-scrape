/*
 * Massive Dev Chart -> CSV, run inside your own browser.
 *
 * Use it as a bookmarklet (see browser/index.html) or paste it into the
 * developer console while https://www.digitaltruth.com/devchart.php is open.
 * It reads the film list, loads each film's results page one at a time,
 * and downloads a CSV with the same columns as index.php.
 */
(async () => {
  if (!/(^|\.)digitaltruth\.com$/.test(location.hostname)) {
    alert('Open https://www.digitaltruth.com/devchart.php first, then run this bookmark again.');
    return;
  }
  if (window.__mdcCsvRunning) return;
  window.__mdcCsvRunning = true;

  const DELAY_MS = 400;
  const BASE = '/devchart.php?Developer=&mdc=Search&TempUnits=C&TimeUnits=T&Film=';
  const HEADER = ['Film', 'Developer', 'Dilution', 'ASA/ISO', '35mm', '120', 'Sheet', 'Temp', 'Notes'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;max-width:440px;margin:0 auto;padding:14px 16px;background:#1d2422;color:#eef2ef;font:14px/1.45 system-ui,sans-serif;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45)';
  box.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Massive Dev Chart → CSV</div>' +
    '<div data-m>Reading film list…</div>' +
    '<div style="height:6px;background:#3a4542;border-radius:3px;margin:10px 0;overflow:hidden"><div data-b style="height:100%;width:0;background:#e0a33a;transition:width .2s"></div></div>' +
    '<button data-s style="font:inherit;padding:6px 12px;border-radius:6px;border:1px solid #6b7a76;background:transparent;color:inherit;cursor:pointer">Stop and save what I have</button>';
  document.body.appendChild(box);
  const msg = box.querySelector('[data-m]');
  const bar = box.querySelector('[data-b]');
  const stopBtn = box.querySelector('[data-s]');
  let stopped = false;
  stopBtn.onclick = () => { stopped = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping…'; };

  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

  const findFilmSelect = (doc) =>
    doc.querySelector('select[name="Film"]') ||
    [...doc.querySelectorAll('select')].find((s) => [...s.options].some((o) => /all films/i.test(o.text)));

  let sel = findFilmSelect(document);
  if (!sel) {
    try { sel = findFilmSelect(parse(await (await fetch('/devchart.php', { credentials: 'same-origin' })).text())); } catch (e) { /* handled below */ }
  }
  if (!sel) {
    msg.textContent = 'Could not find the film list on this page. Open devchart.php, finish any "verify you are human" check, then run the bookmark again.';
    stopBtn.textContent = 'Close';
    stopBtn.onclick = () => box.remove();
    window.__mdcCsvRunning = false;
    return;
  }
  const films = [...new Set([...sel.options].map((o) => o.value.trim()).filter(Boolean))];

  const findTable = (doc) => {
    const tables = [...doc.querySelectorAll('table')];
    return tables.find((t) => /developer/i.test(t.textContent) && /35\s*mm/i.test(t.textContent) && t.rows.length > 1) ||
      tables.find((t) => [...t.rows].some((r) => r.cells.length >= 8));
  };

  // "6-8" becomes 7, matching index.php; "6+" and plain values are kept as-is.
  const averageRange = (v) => {
    const m = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/.exec(v);
    return m ? String((parseFloat(m[1]) + parseFloat(m[2])) / 2) : v;
  };

  const notesUrl = (cell) => {
    if (!cell) return '';
    const a = cell.querySelector('a[href*="devrow"]');
    let id = a ? new URL(a.getAttribute('href'), location.href).searchParams.get('devrow') : null;
    if (!id) {
      const digits = cell.innerHTML.replace(/[^0-9 ]/g, '').trim();
      if (/^\d+$/.test(digits)) id = digits;
    }
    return id ? 'https://www.digitaltruth.com/devchart.php?devrow=' + id : '';
  };

  const rowsFor = (doc) => {
    const table = findTable(doc);
    if (!table) return null;
    const out = [];
    for (const tr of table.rows) {
      const cells = [...tr.cells];
      if (cells.length < 8 || cells.some((c) => c.tagName === 'TH')) continue;
      const text = cells.map((c) => c.textContent.replace(/\s+/g, ' ').trim());
      if (/^film$/i.test(text[0]) && /^developer$/i.test(text[1])) continue;
      const row = text.slice(0, 8);
      for (let i = 3; i <= 6; i++) row[i] = averageRange(row[i]);
      row.push(notesUrl(cells[8]));
      out.push(row);
    }
    return out;
  };

  const all = [];
  const failed = [];
  const started = Date.now();
  for (let i = 0; i < films.length && !stopped; i++) {
    const film = films[i];
    let rows = null;
    for (let attempt = 0; attempt < 3 && rows === null && !stopped; attempt++) {
      try {
        const res = await fetch(BASE + encodeURIComponent(film), { credentials: 'same-origin' });
        if (res.ok) rows = rowsFor(parse(await res.text())) || [];
      } catch (e) { /* retry */ }
      if (rows === null) await sleep(4000 * (attempt + 1));
    }
    if (rows === null) failed.push(film); else all.push(...rows);
    const done = i + 1;
    const left = Math.round(((Date.now() - started) / done) * (films.length - done) / 1000);
    bar.style.width = (100 * done / films.length).toFixed(1) + '%';
    msg.textContent = 'Film ' + done + ' of ' + films.length + ': ' + film + ' — ' + all.length.toLocaleString() + ' rows' +
      (left > 0 ? ' — about ' + (left > 90 ? Math.round(left / 60) + ' min' : left + ' s') + ' left' : '');
    await sleep(DELAY_MS);
  }

  const esc = (v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const csv = '﻿' + [HEADER, ...all].map((r) => r.map((v) => esc(v == null ? '' : String(v))).join(',')).join('\r\n') + '\r\n';
  const name = 'massive-dev-chart-' + new Date().toISOString().slice(0, 10) + '.csv';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.textContent = 'Download ' + name;
  link.style.cssText = 'display:inline-block;margin-right:10px;color:#e0a33a;font-weight:600';
  document.body.appendChild(link);
  link.click();

  msg.textContent = (stopped ? 'Stopped early. ' : 'Done. ') + all.length.toLocaleString() + ' rows from ' +
    (films.length - failed.length) + ' films saved as ' + name + '.' +
    (failed.length ? ' ' + failed.length + ' films could not be loaded: ' + failed.slice(0, 10).join(', ') + (failed.length > 10 ? '…' : '') : '') +
    ' If no download started, tap the link below.';
  bar.style.width = '100%';
  stopBtn.disabled = false;
  stopBtn.textContent = 'Close';
  stopBtn.onclick = () => box.remove();
  box.insertBefore(link, stopBtn);
  window.__mdcCsvRunning = false;
})();
