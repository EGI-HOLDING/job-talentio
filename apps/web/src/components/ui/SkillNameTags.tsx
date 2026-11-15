'use client';

import { useId, useRef, useState } from 'react';
import { normalizeSkillKey, SKILL_FILTER_LIMIT, SKILL_NAME_MAX_LENGTH, skillLabelIssue } from '@job-talentio/shared';
import { useI18n } from '@/lib/i18n';
import s from './SkillNameTags.module.css';

export type SkillTag = { name: string; slug?: string };

export function skillTagIssue(name: string, tags: SkillTag[]) {
  if (skillLabelIssue(name)) return 'skillNameInvalid';
  if (tags.some(tag => normalizeSkillKey(tag.name) === normalizeSkillKey(name))) return 'skillNameDuplicate';
  if (tags.length >= SKILL_FILTER_LIMIT) return 'skillNameLimit';
  return null;
}

export function SkillNameTags({ tags, onChange, onInputChange }: {
  tags: SkillTag[];
  onChange: (tags: SkillTag[]) => void;
  onInputChange?: (name: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  function add() {
    const value = name.trim();
    if (!value) return;
    const issue = skillTagIssue(value, tags);
    if (issue) { setError(t(issue)); return; }
    onChange([...tags, { name: value }]);
    setName('');
    onInputChange?.('');
    setError('');
    input.current?.focus();
  }

  return <div className={s.root}>
    <div className={s.entry}>
      <label htmlFor={id} className={s.srOnly}>{t('skillName')}</label>
      <input ref={input} id={id} value={name} placeholder={t('skillName')}
        maxLength={SKILL_NAME_MAX_LENGTH} autoComplete="off" aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? id + '-error' : undefined}
        onChange={event => { setName(event.target.value); onInputChange?.(event.target.value); setError(''); }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }}/>
      <button type="button" onClick={add} disabled={!name.trim()}>{t('addSkill')}</button>
    </div>
    {error && <small role="alert" id={id + '-error'} className={s.error}>{error}</small>}
    {!!tags.length && <ul className={s.tags}>
      {tags.map((tag, index) => <li key={tag.slug ? 'slug:' + tag.slug : 'name:' + normalizeSkillKey(tag.name)}>
        <span>{tag.name}</span>
        <button type="button" aria-label={t('pc.remove') + ': ' + tag.name}
          onClick={() => { onChange(tags.filter((_, i) => i !== index)); setError(''); input.current?.focus(); }}>×</button>
      </li>)}
    </ul>}
  </div>;
}
