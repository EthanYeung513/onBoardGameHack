// Weather — SDV-style weather modes, optionally synced to real-world weather.
// Resolution order: ?weather= URL param > ob_weather localStorage > auto-detect
// (browser/IP geolocation -> open-meteo) > 'sunny' fallback.

export type WeatherMode = 'sunny' | 'cloudy' | 'rain' | 'storm' | 'snow';
const MODES: WeatherMode[] = ['sunny', 'cloudy', 'rain', 'storm', 'snow'];

// WMO weather-code -> our mode
function fromWmo(code: number): WeatherMode {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 2 && code <= 3 || code === 45 || code === 48) return 'cloudy';
  return 'sunny';
}

async function fetchJson(url: string, ms = 3500): Promise<any | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function detectWeather(): Promise<{ mode: WeatherMode; where: string }> {
  // geo: ob_geo="lat,lon" in localStorage, else IP geolocation
  let lat: number | undefined, lon: number | undefined, where = 'somewhere';
  const geo = localStorage.getItem('ob_geo');
  if (geo) {
    const [a, b] = geo.split(',').map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) { lat = a; lon = b; where = geo; }
  }
  if (lat === undefined) {
    const ip = await fetchJson('https://ipapi.co/json/');
    if (ip && Number.isFinite(ip.latitude)) {
      lat = ip.latitude; lon = ip.longitude; where = ip.city ?? 'your area';
    }
  }
  if (lat === undefined) return { mode: 'sunny', where };
  const wx = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
  const code = wx?.current_weather?.weathercode;
  if (typeof code !== 'number') return { mode: 'sunny', where };
  return { mode: fromWmo(code), where };
}

export async function resolveWeather(): Promise<{ mode: WeatherMode; where: string; source: string }> {
  const q = new URLSearchParams(location.search).get('weather');
  if (q && MODES.includes(q as WeatherMode)) return { mode: q as WeatherMode, where: 'debug', source: 'param' };
  const ls = localStorage.getItem('ob_weather');
  if (ls && MODES.includes(ls as WeatherMode)) return { mode: ls as WeatherMode, where: 'override', source: 'config' };
  const d = await detectWeather();
  return { ...d, source: 'auto' };
}
