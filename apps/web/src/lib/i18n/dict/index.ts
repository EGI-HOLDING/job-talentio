import { core } from './core';
import { employee } from './employee';
import { enums } from './enums';
import { jobs } from './jobs';
import { recruiter } from './recruiter';
import { talent } from './talent';
import { ui } from './ui';
import { landing } from './landing';
import { workspace } from './workspace';
import { discovery } from './discovery';
import { publicPages } from './publicPages';
import { employers } from './employers';
import { profileCv } from './profileCv';
import { employeeWorkspace } from './employeeWorkspace';
import { registerUi } from './registerUi';
import { recruiterWorkspace } from './recruiterWorkspace';

/** Namespaces are merged into one flat lookup so `t('key')` stays unchanged. */
export const DICT = {
  ...core,
  ...jobs,
  ...talent,
  ...recruiter,
  ...employee,
  ...ui,
  ...enums,
  ...landing,
  ...workspace,
  ...discovery,
  ...publicPages,
  ...employers,
  ...profileCv,
  ...employeeWorkspace,
  ...registerUi,
  ...recruiterWorkspace,
} as const;

export type DictKey = keyof typeof DICT;
