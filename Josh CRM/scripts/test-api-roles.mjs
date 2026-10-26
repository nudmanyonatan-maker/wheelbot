// Roles, the change log and import matching, run from test-api.mjs after the basics pass.
// The manager (boss, member u1) invites a rep, then both work on the same workspace.
export async function run({ WS, db, client, key, ok, boss, inviteLink }) {
  const now = () => Date.now();
  // A manager adds a rep from the app and gets a one-time link back.
  const repEmail = 'api.rep+' + now() + '@example.com';
  let r = await boss.call('/api/team', { action: 'invite', name: 'Rita Rep', email: repEmail, role: 'rep' });
  ok(r.j.ok && /#invite=/.test(r.j.link), 'manager invites a rep');
  const repMember = r.j.member;
  const rep = client();
  r = await rep.call('/api/auth/accept', { token: r.j.link.split('#invite=')[1], key: await key(repEmail, 'rep password one') });
  ok(r.j.ok, 'rep picks a password');
  r = await rep.call('/api/auth/me');
  ok(r.j.user.role === 'rep' && r.j.team.length === 2 && r.j.team.some((t) => t.id === repMember && t.role === 'rep'), 'rep is signed in as a rep');
  r = await rep.call('/api/team');
  ok(r.status === 403, 'a rep cannot see or change the team');
  r = await rep.call('/api/team', { action: 'invite', name: 'X', email: 'x@example.com', role: 'manager' });
  ok(r.status === 403, 'a rep cannot invite');

  // The manager sets up two books.
  const t = now();
  const shopR = { id: 'sRep', name: 'Harbor Funding Group LLC', repId: repMember, updatedAt: t, contacts: [{ id: 'c1', name: 'Hal', phone: '+1 (212) 555-0181', email: 'hal@harborfunding.example' }], followUps: [{ id: 'fRep', due: '2026-10-20', time: '10:00', note: 'Check in', at: t + 864e5 }], activity: [] };
  const shopB = { id: 'sBoss', name: 'Summit Capital', repId: 'u1', updatedAt: t, contacts: [{ id: 'c1', name: 'Sue', phone: '(212) 555-0199', email: 'sue@gmail.com' }], followUps: [], activity: [] };
  const dealR = { id: 'dRep', shopId: 'sRep', stage: 'submitted', updatedAt: t, merchant: { business: 'Corner Deli' }, followUps: [], activity: [] };
  const dealB = { id: 'dBoss', shopId: 'sBoss', stage: 'submitted', updatedAt: t, merchant: { business: 'Main St Bakery' }, followUps: [], activity: [] };
  const msgB = { id: 'mBoss', phone: '(212) 555-0199', dir: 'out', kind: 'text', text: 'Hi Sue', at: new Date().toISOString(), updatedAt: t };
  r = await boss.call('/api/data', { shops: [shopR, shopB], deals: [dealR, dealB], msgs: [msgB] });
  ok(r.j.ok && r.j.written === 5 && !r.j.denied.length, 'manager writes into any book');
  let rows = db("SELECT member FROM alerts WHERE ws = '" + WS + "' AND fid = 'fRep'");
  ok(rows.length === 1 && rows[0].member === repMember, "a follow-up alert goes to the shop owner's devices");

  // The rep sees only their own book.
  r = await rep.call('/api/data?since=0');
  const repSince = r.j.now;
  ok(r.j.shops.sRep && !r.j.shops.sBoss && !r.j.shops.sApi1, 'rep gets only their own shops');
  ok(r.j.deals.dRep && !r.j.deals.dBoss, 'rep gets only deals on their shops');
  ok(!r.j.msgs.mBoss, "rep does not get the manager's texts");
  ok(r.j.shops.sRep.contacts[0].name === 'Hal' && r.j.shops.sRep.followUps[0].id === 'fRep' && r.j.shops.sRep.repId === repMember, 'a shop comes back whole: people, follow-ups, owner');
  r = await boss.call('/api/data?since=0');
  ok(r.j.shops.sRep && r.j.shops.sBoss && r.j.deals.dRep && r.j.deals.dBoss && r.j.msgs.mBoss, 'manager gets every book');

  // The rep can only change their own book.
  r = await rep.call('/api/data', { shops: [{ ...shopB, name: 'Hijacked', updatedAt: now() }] });
  ok(r.j.ok && r.j.written === 0 && r.j.denied.length === 1 && r.j.denied[0].id === 'sBoss', "rep cannot edit another rep's shop");
  r = await rep.call('/api/data', { shops: [{ id: 'sNew1', name: 'Planted Shop', repId: 'u1', updatedAt: now(), contacts: [], followUps: [], activity: [] }] });
  ok(r.j.written === 0 && r.j.denied.length === 1, 'rep cannot put a new shop in someone else\'s book');
  r = await rep.call('/api/data', { deals: [{ ...dealB, stage: 'funded', updatedAt: now() }] });
  ok(r.j.written === 0 && r.j.denied.length === 1, "rep cannot move a deal on another rep's shop");
  r = await rep.call('/api/data', { deals: [{ id: 'dSneak', shopId: 'sBoss', updatedAt: now(), merchant: { business: 'Sneak' }, followUps: [], activity: [] }] });
  ok(r.j.written === 0 && r.j.denied.length === 1, "rep cannot log a deal on another rep's shop");
  const own = { id: 'sRep2', name: 'Bayside ISO', repId: repMember, updatedAt: now(), contacts: [], followUps: [], activity: [] };
  r = await rep.call('/api/data', { shops: [own, { ...shopR, name: 'Harbor Funding', updatedAt: now() }], deals: [{ id: 'dRep2', shopId: 'sRep2', updatedAt: now(), merchant: { business: 'Pier Cafe' }, followUps: [], activity: [] }] });
  ok(r.j.written === 3 && !r.j.denied.length, 'rep adds and edits in their own book, deal on a shop made in the same save');
  r = await rep.call('/api/data', { shops: [{ id: 'sX', name: 'Ghost', repId: 'nobody-here', updatedAt: now(), contacts: [], followUps: [], activity: [] }] });
  ok(r.j.written === 0 && r.j.denied[0].why === 'unknown-person', 'a shop cannot go to someone not on the team');

  // Handing a shop to the manager takes it off the rep's devices on the next catch-up.
  r = await boss.call('/api/data', { shops: [{ ...shopR, name: 'Harbor Funding', repId: 'u1', updatedAt: now() + 5 }] });
  ok(r.j.written === 1, 'manager takes the shop back');
  r = await rep.call('/api/data?since=' + repSince);
  ok(r.j.shops.sRep && r.j.shops.sRep.deleted === true && r.j.deals.dRep && r.j.deals.dRep.deleted === true, 'rep gets the shop and its deal as deletions');
  ok(r.j.shops.sRep2 && !r.j.shops.sRep2.deleted, 'rep keeps the shop still in their book');

  // A device clock running ahead is pulled back to the server's time, and told so.
  r = await rep.call('/api/data', { shops: [{ ...own, name: 'Bayside ISO', updatedAt: now() + 36e5 }] });
  ok(r.j.written === 1 && r.j.stamped.length === 1 && r.j.stamped[0].id === 'sRep2' && r.j.stamped[0].updatedAt <= now(), 'a future time comes back stamped with the server time');

  // Change log.
  r = await boss.call('/api/audit?limit=200');
  const log = r.j.entries;
  ok(r.j.ok && log.some((e) => e.action === 'create' && e.recId === 'sRep2' && e.member === repMember && e.who === 'Rita Rep'), "manager sees the rep's changes with who made them");
  const rename = log.find((e) => e.action === 'update' && e.recId === 'sRep' && e.member === repMember);
  ok(rename && rename.changes.some((c) => c.f === 'name' && c.from === 'Harbor Funding Group LLC' && c.to === 'Harbor Funding'), 'a rename is logged with before and after');
  const moved = log.find((e) => e.action === 'update' && e.recId === 'sRep' && e.member === 'u1');
  ok(moved && moved.changes.some((c) => c.f === 'repId' && c.to === 'u1'), 'a hand-off is logged');
  ok(log.some((e) => e.action === 'invite' && e.label === 'Rita Rep') && log.some((e) => e.action === 'password' && e.label === 'Rita Rep'), 'invites and new logins are logged');
  ok(!log.some((e) => e.label === 'Hijacked' || e.recId === 'dSneak'), 'refused changes are not logged as changes');
  r = await rep.call('/api/audit');
  ok(r.j.entries.length && r.j.entries.every((e) => e.member === repMember), 'a rep sees only their own changes');
  r = await boss.call('/api/audit?rec=sRep');
  ok(r.j.entries.length >= 3 && r.j.entries.every((e) => e.recId === 'sRep'), 'history of one shop');

  // Import matching across the whole team.
  const probe = { names: ['SUMMIT CAPITAL, LLC', 'Bayside I.S.O.', 'Brand New Shop'], phones: ['212-555-0181', '2125550199'], domains: ['harborfunding.example', 'gmail.com'] };
  r = await rep.call('/api/import-check', probe);
  ok(r.j.names.summitcapital && r.j.names.summitcapital.id === null && r.j.names.summitcapital.owner === 'Api Tester', "rep learns a shop is in someone else's book, without its id");
  ok(r.j.names.baysideiso && r.j.names.baysideiso.id === 'sRep2' && r.j.names.baysideiso.yours, 'rep gets their own match with its id');
  ok(!r.j.names.brandnewshop, 'a new shop does not match');
  ok(r.j.phones['2125550181'] && r.j.phones['2125550181'].name === 'Harbor Funding' && r.j.phones['2125550199'].name === 'Summit Capital', 'phone numbers match shops');
  ok(r.j.domains['harborfunding.example'] && !r.j.domains['gmail.com'], 'company email domains match, free mail never does');
  r = await boss.call('/api/import-check', probe);
  ok(r.j.names.summitcapital.id === 'sBoss', 'manager gets ids for every match');

  // A link made in one workspace cannot take over a login that ends up in another.
  const crossEmail = 'api.cross+' + now() + '@example.com';
  r = await boss.call('/api/team', { action: 'invite', name: 'Cross Person', email: crossEmail, role: 'rep' });
  const staleLink = r.j.link;
  const other = client();
  r = await other.call('/api/auth/accept', { token: inviteLink(crossEmail, WS + 'b').split('#invite=')[1], key: await key(crossEmail, 'their own password') });
  ok(r.j.ok, 'the same email signs up in another workspace');
  const thief = client();
  r = await thief.call('/api/auth/accept', { token: staleLink.split('#invite=')[1], key: await key(crossEmail, 'taken over') });
  ok(!r.j.ok && !thief.cookie, "an older link from this workspace cannot reset that login");
  r = await client().call('/api/auth/login', { email: crossEmail, key: await key(crossEmail, 'their own password') });
  ok(r.j.ok, 'their own password still works');
  r = await boss.call('/api/team', { action: 'invite', name: 'Cross Person', email: crossEmail, role: 'rep' });
  ok(r.status === 409, 'a manager cannot make a link for a login in another workspace');

  // Promote, then remove.
  r = await boss.call('/api/team', { action: 'role', member: 'u1', role: 'rep' });
  ok(r.status === 400, 'the last manager cannot step down');
  r = await boss.call('/api/team', { action: 'role', member: repMember, role: 'manager' });
  ok(r.j.ok, 'manager promotes the rep');
  r = await rep.call('/api/data?since=0');
  ok(r.j.shops.sBoss, 'a new manager sees every book right away');
  r = await boss.call('/api/team');
  ok(r.j.people.length === 2 && r.j.people.find((p) => p.member === repMember).role === 'manager', 'team list shows roles');
  r = await boss.call('/api/team', { action: 'remove', member: repMember });
  ok(r.j.ok, 'manager removes someone');
  r = await rep.call('/api/data');
  ok(r.status === 401, 'a removed person is signed out everywhere');
  r = await rep.call('/api/auth/login', { email: repEmail, key: await key(repEmail, 'rep password one') });
  ok(r.status === 401, 'and cannot sign back in');
  r = await boss.call('/api/data?since=0');
  ok(r.j.shops.sRep2 && r.j.shops.sRep2.repId === repMember, "their shops stay put until someone hands them over");
}
