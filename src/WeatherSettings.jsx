import { useRef, useState } from 'react';
import { CloudSun, MapPin, LocateFixed, RefreshCw, Search, CloudRain } from 'lucide-react';
import { useI18n } from './i18n.jsx';
import './weather-controls.css';

const conditions = {
  clear: ['晴朗', 'Clear'], cloudy: ['多云', 'Cloudy'], rain: ['下雨', 'Rain'],
  storm: ['雷雨', 'Thunderstorm'], snow: ['下雪', 'Snow'], fog: ['雾', 'Fog'], unknown: ['天气暂不可用', 'Weather unavailable'],
};
const phases = { dawn: ['日出', 'Dawn'], morning: ['上午', 'Morning'], noon: ['正午', 'Noon'], afternoon: ['午后', 'Afternoon'], sunset: ['日落', 'Sunset'], twilight: ['晚霞', 'Twilight'], night: ['入夜', 'After dark'] };
const temperature = value => Number.isFinite(value) ? String(Math.round(value)) : '—';
const clockMinute = (value, fallback) => /^\d\d:\d\d$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : fallback;

export function WeatherBadge({ climate, onClick }) {
  const { t } = useI18n();
  const { preferences, location, weather, status, locationStatus, atmosphere } = climate;
  const simulated = preferences.mode === 'preview';
  const label = simulated ? t('效果预览', 'Preview') : location?.name || t('识别所在城市…', 'Finding your city…');
  const unavailable = !simulated && (status === 'unavailable' || !location);
  return <button className="weather-badge" data-weather-mode={preferences.mode} type="button" onClick={onClick}
    aria-label={t('天气与光照设置', 'Weather and daylight settings')}>
    {atmosphere.rainIntensity > 0 ? <CloudRain size={15} /> : <CloudSun size={15} />}
    <span>{unavailable && !location ? t('选择天气城市', 'Choose weather city') : label}</span>
    {simulated ? <span>{t(...conditions[atmosphere.condition])} · {atmosphere.timeLabel}</span>
      : weather && <span>{temperature(weather.temperature)}° · {t(...conditions[atmosphere.condition])}</span>}
    {!simulated && (status === 'cached' || locationStatus === 'unavailable' && preferences.locationMode === 'auto') && <small>{t('缓存', 'Cached')}</small>}
    {!simulated && status === 'unavailable' && location && <small>{t('离线', 'Offline')}</small>}
  </button>;
}

export default function WeatherSettings({ climate }) {
  const { t, lang } = useI18n();
  const { preferences, setPreferences, location, weather, status, locationStatus, refresh, atmosphere } = climate;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState('');
  const requestId = useRef(0);
  const simulated = preferences.mode === 'preview';
  async function search(event) {
    event.preventDefault();
    if (query.trim().length < 2) { setSearchStatus('short'); return; }
    const id = ++requestId.current;
    setSearching(true); setSearchStatus(''); setResults([]);
    try {
      const response = await fetch(`/api/weather/locations?${new URLSearchParams({ q: query.trim(), language: lang })}`);
      if (!response.ok) throw new Error('Search unavailable');
      const cities = await response.json();
      if (requestId.current !== id) return;
      setResults(cities); setSearchStatus(cities.length ? '' : 'empty');
    } catch { if (requestId.current === id) setSearchStatus('error'); }
    finally { if (requestId.current === id) setSearching(false); }
  }
  const presets = [
    { id: 'dawn', label: t('日出', 'Dawn'), minutes: Math.min(1439, clockMinute(atmosphere.sunriseLabel, 360) + 15), condition: 'clear' },
    { id: 'noon', label: t('正午', 'Noon'), minutes: 720, condition: 'clear' },
    { id: 'sunset', label: t('晚霞', 'Sunset'), minutes: Math.min(1439, clockMinute(atmosphere.sunsetLabel, 1080) + 5), condition: 'clear' },
    { id: 'rain', label: t('雨天', 'Rain'), minutes: 840, condition: 'rain' },
  ];
  return <section className="weather-settings" data-testid="weather-settings">
    <div className="weather-settings-heading"><h3><CloudSun size={18} />{t('天气与光照', 'Weather & daylight')}</h3>
      <button className="icon-button" type="button" aria-label={t('刷新天气', 'Refresh weather')} onClick={refresh}><RefreshCw size={15} /></button></div>
    <div className="weather-modes" role="group" aria-label={t('天气来源', 'Weather source')}>
      <button type="button" data-weather-source="live" aria-pressed={!simulated} onClick={() => setPreferences({ mode: 'live' })}>{t('实时天气', 'Live weather')}</button>
      <button type="button" data-weather-source="preview" aria-pressed={simulated} onClick={() => setPreferences({ mode: 'preview' })}>{t('效果预览', 'Preview effects')}</button>
    </div>
    {!simulated ? <>
      <div className="weather-city"><MapPin size={17} /><div><strong>{location?.name || t('尚未识别城市', 'City not detected')}</strong>
        <small>{[location?.region, location?.country].filter(Boolean).join(' · ')}</small></div>
        <button className="secondary" type="button" data-weather-locate onClick={() => { setPreferences({ locationMode: 'auto' }); refresh(); }}>
          <LocateFixed size={14} />{t('使用所在城市', 'Use my city')}</button></div>
      <p className="weather-note">{preferences.locationMode === 'auto'
        ? locationStatus === 'unavailable' ? t('自动定位暂不可用，可搜索并选择城市。', 'City detection is unavailable. Search for your city below.')
          : t('通过网络识别城市，可在下方手动修正。', 'City detected from your network. You can correct it below.')
        : t('正在使用手动选择的城市。', 'Using your selected city.')}</p>
      <form className="weather-city-search" onSubmit={search}>
        <input aria-label={t('搜索天气城市', 'Search weather city')} placeholder={t('搜索城市，例如 Berkeley', 'Search a city, e.g. Berkeley')} value={query} maxLength={100} onChange={event => { requestId.current++; setQuery(event.target.value); setResults([]); setSearchStatus(''); setSearching(false); }} />
        <button className="secondary" disabled={searching} type="submit"><Search size={14} />{searching ? t('搜索中', 'Searching') : t('搜索', 'Search')}</button>
      </form>
      {searchStatus && <p className="weather-note" role="status">{searchStatus === 'short' ? t('请输入至少两个字符。', 'Enter at least two characters.') : searchStatus === 'empty' ? t('未找到城市，试试英文名称。', 'No cities found. Try the English name.') : t('城市搜索暂不可用，请稍后重试。', 'City search is unavailable. Please try again.')}</p>}
      {!!results.length && <ul className="weather-city-results">{results.map((result, index) => <li key={result.id || index}><button type="button" onClick={() => {
        setPreferences({ locationMode: 'manual', location: result }); setResults([]); setQuery('');
      }}><strong>{result.name}</strong><span>{[result.region, result.country].filter(Boolean).join(' · ')}</span></button></li>)}</ul>}
      <div className="weather-readout"><span>{status === 'loading' ? t('天气更新中…', 'Updating weather…') : status === 'unavailable' ? t('天气暂不可用，光照按时间变化。', 'Weather unavailable. Daylight still follows the clock.') : weather ? `${temperature(weather.temperature)}°C · ${t(...conditions[atmosphere.condition])}` : t('等待城市信息', 'Waiting for a city')}
        {status === 'cached' && <small>{t('上次更新的天气', 'Last available weather')}</small>}</span>
        <span>{t('日出', 'Sunrise')} {atmosphere.sunriseLabel || '—'} · {t('日落', 'Sunset')} {atmosphere.sunsetLabel || '—'}{atmosphere.solarEstimated && <small>{t('估算', 'Estimated')}</small>}</span></div>
      <p className="weather-note">{atmosphere.timeLabel} · {atmosphere.timezone} · {t(...phases[atmosphere.phase])}</p>
      <p className="weather-attribution">{t('天气数据', 'Weather data')}: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · {t('城市定位', 'City detection')}: <a href="https://ipwhois.io/" target="_blank" rel="noreferrer">IPWHOIS</a></p>
    </> : <>
      <div className="weather-presets">{presets.map(preset => <button type="button" key={preset.id} data-weather-preset={preset.id}
        onClick={() => setPreferences({ preview: { condition: preset.condition, minutes: preset.minutes } })}>{preset.label}</button>)}</div>
      <label className="weather-preview-time">{t('时间', 'Time')}<output>{atmosphere.timeLabel}</output>
        <input type="range" min="0" max="1439" step="1" data-weather-time aria-label={t('预览时间', 'Preview time')}
          value={preferences.preview.minutes} onChange={event => setPreferences({ preview: { minutes: Number(event.target.value) } })} /></label>
      <label className="weather-preview-condition">{t('天气', 'Weather')}<select data-weather-condition value={preferences.preview.condition}
        onChange={event => setPreferences({ preview: { condition: event.target.value } })}>
        {Object.entries(conditions).filter(([value]) => value !== 'unknown').map(([value, label]) => <option key={value} value={value}>{t(...label)}</option>)}</select></label>
      <p className="weather-note">{t('预览只改变视觉效果，不影响任务截止时间或提醒。', 'Preview changes visuals only. Task deadlines and reminders keep real time.')}</p>
    </>}
  </section>;
}
