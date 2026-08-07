-- Repair category/benefit icons corrupted to "????" during non-UTF8 seeds.
-- Values written via UTF-8 hex so this file stays ASCII-safe.

-- JobCategory
UPDATE "JobCategory" SET icon = convert_from(decode('f09f92bb', 'hex'), 'utf8') WHERE slug = 'it-software';
UPDATE "JobCategory" SET icon = convert_from(decode('f09f8fa6', 'hex'), 'utf8') WHERE slug = 'finance';
UPDATE "JobCategory" SET icon = convert_from(decode('f09f9388', 'hex'), 'utf8') WHERE slug = 'sales-marketing';
UPDATE "JobCategory" SET icon = convert_from(decode('f09f8ea8', 'hex'), 'utf8') WHERE slug = 'design';
UPDATE "JobCategory" SET icon = convert_from(decode('f09f91a5', 'hex'), 'utf8') WHERE slug = 'hr';
UPDATE "JobCategory" SET icon = convert_from(decode('f09f93da', 'hex'), 'utf8') WHERE slug = 'education';
UPDATE "JobCategory" SET icon = convert_from(decode('f09f8fa5', 'hex'), 'utf8') WHERE slug = 'healthcare';
UPDATE "JobCategory" SET icon = convert_from(decode('e29a99efb88f', 'hex'), 'utf8') WHERE slug = 'engineering';
UPDATE "JobCategory" SET icon = convert_from(decode('f09f8ea7', 'hex'), 'utf8') WHERE slug = 'customer-support';
UPDATE "JobCategory" SET icon = convert_from(decode('f09f9a9a', 'hex'), 'utf8') WHERE slug = 'logistics';
UPDATE "JobCategory" SET icon = convert_from(decode('e29a96efb88f', 'hex'), 'utf8') WHERE slug = 'legal';
UPDATE "JobCategory" SET icon = convert_from(decode('f09f8fa8', 'hex'), 'utf8') WHERE slug = 'hospitality';

-- Benefit
UPDATE "Benefit" SET icon = convert_from(decode('f09f8fa5', 'hex'), 'utf8') WHERE slug = 'health-insurance';
UPDATE "Benefit" SET icon = convert_from(decode('f09f8fa0', 'hex'), 'utf8') WHERE slug = 'remote-work';
UPDATE "Benefit" SET icon = convert_from(decode('e28fb0', 'hex'), 'utf8') WHERE slug = 'flexible-hours';
UPDATE "Benefit" SET icon = convert_from(decode('f09f8db1', 'hex'), 'utf8') WHERE slug = 'meal-allowance';
UPDATE "Benefit" SET icon = convert_from(decode('f09f9396', 'hex'), 'utf8') WHERE slug = 'learning-budget';
UPDATE "Benefit" SET icon = convert_from(decode('f09f92aa', 'hex'), 'utf8') WHERE slug = 'gym';
UPDATE "Benefit" SET icon = convert_from(decode('f09f8cb4', 'hex'), 'utf8') WHERE slug = 'paid-vacation';
UPDATE "Benefit" SET icon = convert_from(decode('f09f938a', 'hex'), 'utf8') WHERE slug = 'stock-options';
UPDATE "Benefit" SET icon = convert_from(decode('e29c88efb88f', 'hex'), 'utf8') WHERE slug = 'relocation';
UPDATE "Benefit" SET icon = convert_from(decode('f09f92bb', 'hex'), 'utf8') WHERE slug = 'equipment';
UPDATE "Benefit" SET icon = convert_from(decode('f09f91b6', 'hex'), 'utf8') WHERE slug = 'parental-leave';
UPDATE "Benefit" SET icon = convert_from(decode('f09f92b0', 'hex'), 'utf8') WHERE slug = 'bonus';
