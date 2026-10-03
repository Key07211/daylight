import { useId } from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { useI18n } from './i18n.jsx';

export default function GlassSettings({ settings, onChange, onReset }) {
  const id = useId();
  const { t } = useI18n();
  const controls = [
    { key: 'transparency', label: t('通透度', 'Transparency'), max: 100, unit: '%' },
    { key: 'blur', label: t('背景模糊', 'Background blur'), max: 24, unit: 'px' },
    { key: 'glow', label: t('高光强度', 'Highlight intensity'), max: 100, unit: '%' },
  ];
  return (
    <section className="glass-settings" data-testid="glass-settings">
      <div className="glass-settings-heading">
        <h3><SlidersHorizontal size={17} />{t('液态玻璃', 'Liquid glass')}</h3>
        <button type="button" className="secondary glass-reset" onClick={onReset}>
          <RotateCcw size={14} />{t('恢复默认', 'Reset')}
        </button>
      </div>
      {controls.map(control => (
        <div className="glass-control" key={control.key}>
          <div className="glass-control-label">
            <label htmlFor={`${id}-${control.key}`}>{control.label}</label>
            <output htmlFor={`${id}-${control.key}`}>{settings[control.key]}{control.unit}</output>
          </div>
          <input id={`${id}-${control.key}`} data-glass-control={control.key} type="range"
            min="0" max={control.max} step="1" value={settings[control.key]}
            onChange={event => onChange({ [control.key]: Number(event.target.value) })} />
        </div>
      ))}
      <div className="setting-row glass-setting-switch">
        <div><strong>{t('动态装饰', 'Ambient motion')}</strong></div>
        <button type="button" role="switch" className={`switch ${settings.motion ? 'on' : ''}`}
          data-glass-control="motion" aria-label={t('动态装饰', 'Ambient motion')}
          aria-checked={settings.motion} onClick={() => onChange({ motion: !settings.motion })}>
          <span />
        </button>
      </div>
    </section>
  );
}
