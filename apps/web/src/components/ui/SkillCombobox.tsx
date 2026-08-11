'use client';

import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { useEnumLabel, useI18n } from '@/lib/i18n';

type SkillComboboxProps = {
  onPick: (skill: {
    slug: string;
    name: string;
    isNew?: boolean;
    level?: string;
  }) => void | Promise<void>;
  levelSelect?: boolean;
  levelName?: string;
  defaultLevel?: string;
  allowCreate?: boolean;
  disabled?: boolean;
  submitLabel?: string;
};

/** Skills-specific wrapper around LookupCombobox. */
export function SkillCombobox({
  onPick,
  levelSelect = true,
  levelName = 'level',
  defaultLevel = 'INTERMEDIATE',
  allowCreate = true,
  disabled,
  submitLabel,
}: SkillComboboxProps) {
  const { t } = useI18n();
  const enumLabel = useEnumLabel();
  return (
    <LookupCombobox
      kind="skills"
      onPick={onPick}
      allowCreate={allowCreate}
      levelName={levelName}
      defaultLevel={defaultLevel}
      levelOptions={
        levelSelect
          ? [
              { value: 'BEGINNER', label: enumLabel('skillLevel', 'BEGINNER') },
              { value: 'INTERMEDIATE', label: enumLabel('skillLevel', 'INTERMEDIATE') },
              { value: 'ADVANCED', label: enumLabel('skillLevel', 'ADVANCED') },
              { value: 'EXPERT', label: enumLabel('skillLevel', 'EXPERT') },
            ]
          : undefined
      }
      disabled={disabled}
      submitLabel={submitLabel || t('addSkill')}
      placeholder={t('skillSearchPlaceholder')}
    />
  );
}
