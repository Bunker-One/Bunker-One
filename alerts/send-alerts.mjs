// Contract Register: daily deadline alerts (90, 60, 30 and 15 days).
// Run by GitHub Actions every morning (see .github/workflows/alerts.yml).
// Needs these repository secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
// ALERT_FROM (e.g. "Contract Register <alerts@yourcompany.com>") and ALERT_TO
// (administrators, comma-separated). APP_URL is optional (link in the email).
// Without RESEND_API_KEY it only prints what it would send (useful for a first test).

const env = process.env;
const MILESTONES = [90, 60, 30, 15];
const DEFAULT_FAMILIES = {
  'fuel-transport': 'Fuel transport', 'fuel-storage': 'Fuel storage', bunkering: 'Ship bunkering (fuel pumping)',
  environmental: 'Environmental support', surveyor: 'Surveyor services', terminal: 'Terminal services',
  weather: 'Weather forecasting', agency: 'Ship agency', immigration: 'Immigration services', maintenance: 'Maintenance services'
};
const PERIODS = { day: 'per day', month: 'per month', year: 'per year', total: 'contract total' };

export function todayIn(tz = 'America/Sao_Paulo', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const ms = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (iso, n) => new Date(ms(iso) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((ms(to) - ms(from)) / 864e5);
const fdate = iso => new Date(ms(iso)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function money(v, cur) {
  const n = Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return ({ BRL: 'R$ ', USD: 'US$ ', UYU: '$U ' }[cur] || (cur ? cur + ' ' : '')) + n;
}
const charterType = v => !v ? '' : /bare/i.test(v) ? 'Bareboat' : /time|tcp/i.test(v) ? 'TCP' : 'Other';

export function findAlerts(contracts, today) {
  const out = [];
  for (const c of contracts) {
    if (!c || c.archived) continue;
    const dl = [];
    if (c.endDate) {
      dl.push({ date: c.endDate, kind: c.autoRenew ? 'Renews automatically' : 'Contract ends', action: c.autoRenew ? 'Decide whether to let it renew.' : 'Decide on renewal, renegotiation or closing.' });
      if (Number(c.noticeDays) > 0) dl.push({ date: addDays(c.endDate, -Number(c.noticeDays)), kind: c.autoRenew ? 'Last day to cancel' : 'Last day for notice', action: c.autoRenew ? 'Send cancellation notice if you do not want it to renew.' : 'Send notice of renewal or termination.' });
    }
    if (c.category === 'charter' && charterType(c.charterType) === 'Bareboat' && c.nextDrydock) dl.push({ date: c.nextDrydock, kind: 'Dry-docking due', action: 'Plan the dry-docking: yard slot, class survey and off-hire period.' });
    for (const d of dl) {
      const left = daysBetween(today, d.date);
      if (MILESTONES.includes(left)) out.push({ ...d, left, contract: c });
    }
  }
  return out.sort((a, b) => a.left - b.left);
}

function currentValue(c, today) {
  const v = [...(c.versions || [])].sort((a, b) => (a.eff < b.eff ? -1 : a.eff > b.eff ? 1 : a.n - b.n));
  let cur = v[0];
  for (const x of v) if (x.eff <= today) cur = x;
  return cur ? cur.value : null;
}

export function buildEmail(alerts, today, families, appUrl) {
  const fam = id => families[id] || id;
  const groups = MILESTONES.slice().reverse().map(m => [m, alerts.filter(a => a.left === m)]).filter(([, l]) => l.length);
  const row = (k, v) => v ? `<tr><td style="color:#666;padding:2px 12px 2px 0;vertical-align:top">${esc(k)}</td><td style="padding:2px 0">${v}</td></tr>` : '';
  const html = `<div style="font-family:Arial,sans-serif;color:#111;max-width:640px">
  <h2 style="margin:0 0 4px">Contract alerts for ${esc(fdate(today))}</h2>
  <p style="margin:0 0 16px;color:#666">${alerts.length} deadline${alerts.length === 1 ? '' : 's'} reached a 90, 60, 30 or 15-day mark today.</p>
  ${groups.map(([m, list]) => `<h3 style="border-bottom:2px solid #111;padding-bottom:4px;margin:20px 0 8px;color:${m <= 30 ? '#e4002b' : '#111'}">${m} days left</h3>
  ${list.map(a => {
    const c = a.contract, ct = charterType(c.charterType);
    return `<div style="border-bottom:1px solid #ddd;padding:10px 0">
      <div style="font-weight:bold;font-size:16px">${esc(a.kind)}: ${esc(c.title)}</div>
      <table style="font-size:14px;border-collapse:collapse;margin-top:4px">
      ${row('Date', esc(fdate(a.date)))}
      ${row('Supplier', esc(c.counterparty))}
      ${row('Reference', esc(c.reference))}
      ${row('Responsible', esc([c.owner, c.ownerEmail].filter(Boolean).join(', ')))}
      ${row('Current value', esc(money(currentValue(c, today), c.currency) + ' ' + (PERIODS[c.period] || '')))}
      ${c.category === 'service' ? row('Services', esc((c.services || []).map(fam).join(', '))) : ''}
      ${c.category === 'charter' ? row('Charter', esc([ct === 'TCP' ? 'TCP (time charter party)' : ct === 'Bareboat' ? 'Bareboat charter' : ct, c.vesselName, c.imo ? 'IMO ' + c.imo : ''].filter(Boolean).join(', '))) : ''}
      ${c.category === 'charter' ? row('Ports', esc([c.deliveryPort, c.redeliveryPort].filter(Boolean).join(' to '))) : ''}
      ${ct === 'TCP' ? row('Extension option', esc(c.tcpOption)) : ''}
      ${(() => { const cv = [...(c.crew?.versions || [])].sort((x, y) => (x.eff < y.eff ? -1 : 1)); let cc = cv[0]; for (const x of cv) if (x.eff <= today) cc = x; return cc ? row('Brazilian crew cost', esc(money(cc.value, c.crew.currency) + ' ' + (PERIODS[c.crew.period] || '') + (cc.members ? ', ' + cc.members + ' crew' : ''))) : ''; })()}
      ${ct === 'Bareboat' ? row('Purchase option', esc(c.purchaseOption === 'Yes' ? 'Yes' + (c.purchasePrice ? ', ' + money(c.purchasePrice, c.currency) : '') : c.purchaseOption)) : ''}
      ${row('Suggested action', esc(a.action))}
      </table></div>`;
  }).join('')}`).join('')}
  ${appUrl ? `<p style="margin-top:20px"><a href="${esc(appUrl)}" style="color:#111;font-weight:bold">Open the Contract Register</a></p>` : ''}
  </div>`;
  const subject = `Contract alerts: ${alerts.length} deadline${alerts.length === 1 ? '' : 's'} (${fdate(today)})`;
  return { subject, html };
}

async function supa(path) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/(rest\/v1\/?)?$/, '')}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

async function send(to, subject, html) {
  if (!env.RESEND_API_KEY) { console.log(`[dry run] would email ${to.join(', ')}: ${subject}`); return; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.ALERT_FROM, to, subject, html })
  });
  if (!r.ok) throw new Error(`Email to ${to.join(', ')} failed: ${r.status} ${await r.text()}`);
  console.log(`Sent to ${to.join(', ')}: ${subject}`);
}

async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.log('Alerts are not set up yet (secrets SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY missing). Nothing to do.'); return; }
  if (env.RESEND_API_KEY && !env.ALERT_FROM) throw new Error('Missing secret ALERT_FROM');
  const today = env.TODAY || todayIn();
  const rows = await supa('contracts?select=id,doc');
  const settings = await supa('settings?select=value&key=eq.families');
  const families = { ...DEFAULT_FAMILIES };
  for (const f of settings[0]?.value?.list || []) families[f.id] = f.name;

  const alerts = findAlerts(rows.map(r => r.doc), today);
  console.log(`${today}: ${rows.length} contracts checked, ${alerts.length} alert(s).`);
  if (!alerts.length) return;

  const admins = (env.ALERT_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  const perPerson = new Map();
  for (const email of admins) perPerson.set(email.toLowerCase(), { to: email, list: alerts });
  for (const a of alerts) {
    const e = (a.contract.ownerEmail || '').trim();
    if (!e || perPerson.has(e.toLowerCase())) continue;
    perPerson.set(e.toLowerCase(), { to: e, list: alerts.filter(x => (x.contract.ownerEmail || '').trim().toLowerCase() === e.toLowerCase()) });
  }
  let failed = 0;
  for (const { to, list } of perPerson.values()) {
    const { subject, html } = buildEmail(list, today, families, env.APP_URL);
    try { await send([to], subject, html); } catch (e) { failed++; console.error(e.message); }
  }
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
