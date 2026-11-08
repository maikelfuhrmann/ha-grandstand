import {words} from './i18n.js';
import {escapeHtml} from './model.js';

const radarLabels={
 weatherRadar:['Weather radar','Wetterradar','Radar meteorológico','Radar météo','Radar meteo','Weerradar'],
 radarNow:['Current radar at the event venue','Aktuelles Radar am Austragungsort','Radar actual en la sede del evento','Radar actuel sur le lieu de l’événement','Radar attuale sul luogo dell’evento','Actuele radar bij de evenementlocatie'],
 radarHint:['Observed precipitation, not the forecast for match day. Coverage and timestamps are provided by Windy.','Beobachteter Niederschlag, keine Vorhersage für den Spieltag. Abdeckung und Zeitstempel kommen von Windy.','Precipitación observada, no el pronóstico del día del partido. Cobertura y horarios de Windy.','Précipitations observées, pas les prévisions du jour du match. Couverture et horaires fournis par Windy.','Precipitazioni osservate, non le previsioni del giorno della partita. Copertura e orari forniti da Windy.','Waargenomen neerslag, geen voorspelling voor de wedstrijddag. Dekking en tijdstippen van Windy.'],
 radarUnavailable:['The venue coordinates could not be verified.','Die Koordinaten des Austragungsorts konnten nicht bestätigt werden.','No se pudieron verificar las coordenadas de la sede.','Les coordonnées du lieu n’ont pas pu être vérifiées.','Impossibile verificare le coordinate del luogo.','De coördinaten van de locatie konden niet worden bevestigd.'],
 radarOpen:['Open radar','Radar öffnen','Abrir radar','Ouvrir le radar','Apri radar','Radar openen'],
 radarSource:['Venue coordinates','Ortskoordinaten','Coordenadas del recinto','Coordonnées du lieu','Coordinate del luogo','Locatiecoördinaten']
};
for(const [key,values] of Object.entries(radarLabels))['en','de','es','fr','it','nl'].forEach((code,i)=>{words[code][key]=values[i];});

export function radarUrl(location,lang='en'){
  if(!location||location.latitude==null||location.longitude==null||location.latitude===''||location.longitude==='')return '';
  if(typeof location.latitude==='boolean'||typeof location.longitude==='boolean')return '';
  const lat=Number(location.latitude),lon=Number(location.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return '';
  return 'https://embed.windy.com/embed.html?'+new URLSearchParams({type:'map',location:'coordinates',metricRain:'mm',metricTemp:'°C',metricWind:'km/h',zoom:'8',overlay:'radar',product:'radar',level:'surface',lat:String(lat),lon:String(lon),detailLat:String(lat),detailLon:String(lon),marker:'true',lang:['en','de','es','fr','it','nl'].includes(lang)?lang:'en'});
}
export const radarMethods={
 _radar(radar,id){
   if(!radar)return '';
   const place=radar.location,url=radarUrl(place,this.lang),esc=escapeHtml;
   return `<section class="radar-card dossier-section" data-radar-id="${esc(id)}"><div class="dossier-heading"><div><div class="eyebrow">${esc(this.t.radarNow)}</div><h2>${esc(this.t.weatherRadar)}</h2></div>${url?`<a class="text-action" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(this.t.radarOpen)} ↗</a>`:''}</div><p class="radar-location"><strong>${esc(place?.name||radar.event_name||'')}</strong>${place?.city?` · ${esc(place.city)}`:''}${place?.country?` · ${esc(place.country)}`:''}</p>${radar.event_name&&radar.event_name!==place?.name?`<p class="meta">${esc(radar.event_name)}</p>`:''}${url?`<iframe class="venue-radar" src="${esc(url)}" title="${esc(this.t.weatherRadar+' · '+place.name)}" loading="lazy" referrerpolicy="no-referrer" allowfullscreen></iframe>`:`<p class="notice">${esc(this.t.radarUnavailable)}</p>`}<p class="meta">${esc(this.t.radarHint)}</p>${url?`<div class="radar-credit"><a href="https://www.windy.com/" target="_blank" rel="noopener noreferrer">Windy.com ↗</a><span>${esc(this.t.radarSource)}: ${place.source==='OpenStreetMap / Photon'?'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · <a href="https://photon.komoot.io/" target="_blank" rel="noopener noreferrer">Photon</a>':esc(place.source||'ESPN')}</span></div>`:''}</section>`;
 }
};
export const radarStyles=`.radar-card{margin-top:24px}.radar-location{font-size:15px;line-height:1.6}.radar-card .eyebrow{line-height:1.6}.venue-radar{display:block;width:100%;height:460px;border:1px solid var(--line);border-radius:16px;background:#101b27;margin:18px 0}.radar-credit{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;color:var(--muted);font-size:11px}.radar-credit a{text-decoration:underline;text-underline-offset:3px}@media(max-width:600px){.venue-radar{height:380px}.radar-card .dossier-heading{align-items:flex-start;gap:12px}.radar-card .text-action{font-size:11px}}`;
