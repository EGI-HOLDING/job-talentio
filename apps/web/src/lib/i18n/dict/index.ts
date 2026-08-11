import { core } from './core';
import { employee } from './employee';
import { enums } from './enums';
import { jobs } from './jobs';
import { recruiter } from './recruiter';
import { talent } from './talent';
import { ui } from './ui';

/** Namespaces are merged into one flat lookup so `t('key')` stays unchanged. */
export const DICT = {
  ...core,
  ...jobs,
  ...talent,
  ...recruiter,
  ...employee,
  ...ui,
  ...enums,
} as const;

export type DictKey = keyof typeof DICT;
