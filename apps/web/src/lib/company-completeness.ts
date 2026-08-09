export type CompanyCompletenessInput = {
  name?: string | null;
  logoUrl?: string | null;
  description?: string | null;
  website?: string | null;
  cityId?: string | null;
  city?: { id?: string; name?: string } | null;
  industryId?: string | null;
  industry?: { id?: string; name?: string } | null;
  size?: string | null;
  isVerified?: boolean;
};

export type CompletenessItem = {
  key: string;
  labelKey:
   | 'trustItemName'
   | 'trustItemLogo'
   | 'trustItemDescription'
   | 'trustItemWebsite'
   | 'trustItemCity'
   | 'trustItemIndustry'
   | 'trustItemSize';
  done: boolean;
};

export type CompanyCompleteness = {
  items: CompletenessItem[];
  done: number;
  total: number;
  percent: number;
  complete: boolean;
  isVerified: boolean;
};

export function computeCompanyCompleteness(company: CompanyCompletenessInput | null | undefined): CompanyCompleteness {
  const desc = (company?.description || '').trim();
  const items: CompletenessItem[] = [
    { key: 'name', labelKey: 'trustItemName', done: !!(company?.name || '').trim() },
    { key: 'logo', labelKey: 'trustItemLogo', done: !!(company?.logoUrl || '').trim() },
    { key: 'description', labelKey: 'trustItemDescription', done: desc.length >= 40 },
    { key: 'website', labelKey: 'trustItemWebsite', done: !!(company?.website || '').trim() },
    {
      key: 'city',
      labelKey: 'trustItemCity',
      done: !!(company?.cityId || company?.city?.id || company?.city?.name),
    },
    {
      key: 'industry',
      labelKey: 'trustItemIndustry',
      done: !!(company?.industryId || company?.industry?.id || company?.industry?.name),
    },
    { key: 'size', labelKey: 'trustItemSize', done: !!(company?.size || '').trim() },
  ];
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  return {
    items,
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    complete: done === total,
    isVerified: !!company?.isVerified,
  };
}
