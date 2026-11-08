export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username ? url.href : ''; } catch { return ''; } };

export function dateKey(date, timeZone = 'UTC') {
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(parsed).map(p => [p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDate(key, days) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0,10);
}

export function isFavorite(event, favorites) {
  return event.participants.some(p => p.key && favorites.includes(p.key));
}

export function isFreshLive(event, now = Date.now()) {
  return event.state === 'live' && !event.stale && Number.isFinite(Date.parse(event.updated_at)) && now - Date.parse(event.updated_at) < 120_000;
}

export function filterEvents(events, {view = 'home', sport = 'all', league = 'all', search = '', date, timeZone = 'UTC', favorites = [], now = Date.now()} = {}) {
  const query = search.toLocaleLowerCase().trim();
  return events.filter(e => {
    if (sport !== 'all' && e.sport !== sport) return false;
    if (league !== 'all' && e.league_id !== league) return false;
    if (query && ![e.name, e.league, ...e.participants.map(p => p.name)].join(' ').toLocaleLowerCase().includes(query)) return false;
    if (view === 'live') return isFreshLive(e, now);
    if (view === 'favorites' && !isFavorite(e, favorites)) return false;
    if (view === 'results' && e.state !== 'finished') return false;
    if (view === 'schedule' && !['scheduled','postponed','interrupted'].includes(e.state)) return false;
    if (date && !['favorites','live'].includes(view)) {
      const first = dateKey(e.date, timeZone);
      // Only leaderboards are multi-day events; tennis match dates are independent.
      const last = e.format === 'leaderboard' && e.end_date ? dateKey(e.end_date, timeZone) : first;
      if (date < first || date > last) return false;
    }
    return true;
  }).sort((a,b) => {
    if (view === 'home' || view === 'favorites') {
      const rank = e => isFreshLive(e, now) ? 0 : e.state === 'scheduled' ? 1 : 2;
      const delta = rank(a) - rank(b);
      if (delta) return delta;
    }
    return view === 'results' ? Date.parse(b.date)-Date.parse(a.date) : Date.parse(a.date)-Date.parse(b.date);
  });
}

export function scoreDisplay(participant, event, hidden) {
  if (hidden) return '•';
  if (event.state === 'scheduled' || event.state === 'postponed') return '–';
  if (participant.score !== null && participant.score !== undefined) return String(participant.score);
  if (event.sport === 'tennis' && participant.linescores?.length) return participant.linescores.map(x => x === null ? '–' : String(Number.isFinite(Number(x)) ? Number(x) : x)).join('  ');
  if (event.sport === 'mma' && event.state === 'finished' && event.participants.some(p => p.winner === true)) return participant.winner ? 'W' : 'L';
  return '–';
}
