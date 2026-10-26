// Loads the UK sample book (lender.js). Follow-ups that would fall due while filming move to
// tomorrow, so no pop-up interrupts a take.
module.exports = (page) => page.evaluate(async () => {
  const s = window.AD.buildSeed(), now = Date.now();
  const later = (r) => (r.followUps || []).forEach((f) => {
    if (f.doneAt) return;
    const [y, mo, d] = f.due.split('-').map(Number), [hh, mm] = (f.time || '09:00').split(':').map(Number);
    const t = new Date(y, mo - 1, d, hh, mm).getTime();
    if (t > now - 3 * 3600000 && t < now + 30 * 60000) { const n = new Date(now + 864e5); f.due = n.toISOString().slice(0, 10); f.time = '09:00'; }
  });
  s.shops.forEach(later); s.deals.forEach(later);
  for (const [kind, list] of [['shops', s.shops], ['deals', s.deals], ['meta', s.meta]]) {
    for (let i = 0; i < list.length; i += 100) {
      const b = {}; b[kind] = list.slice(i, i + 100).map((x) => Object.assign(x, { updatedAt: now }));
      const r = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
      if (!r.ok) throw new Error(kind + ' ' + r.status);
    }
  }
});
