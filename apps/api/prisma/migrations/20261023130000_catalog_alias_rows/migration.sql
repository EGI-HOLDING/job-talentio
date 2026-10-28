-- Move previously hardcoded job-title variants into the existing alias table.
-- Rows are inserted only when their canonical catalog entry already exists.
INSERT INTO "JobTitleAlias" ("id", "jobTitleId", "alias", "aliasKey")
SELECT 'catalog_alias_jobtitle_' || aliases."aliasKey", titles."id", aliases."alias", aliases."aliasKey"
FROM (VALUES
  ('frontend-developer', 'Front End Developer', 'front-end-developer'),
  ('frontend-developer', 'Frontend Dev', 'frontend-dev'),
  ('frontend-developer', 'Front Developer', 'front-developer'),
  ('frontend-developer', 'FrontDev', 'frontdev'),
  ('backend-developer', 'Back End Developer', 'back-end-developer'),
  ('backend-developer', 'BackendDev', 'backenddev'),
  ('cplusplus-developer', 'CPP Developer', 'cpp-developer'),
  ('cplusplus-developer', 'C Plus Plus Developer', 'c-plus-plus-developer'),
  ('cplusplus-systems-engineer', 'CPP Systems Engineer', 'cpp-systems-engineer'),
  ('fullstack-developer', 'Fullstack Developer', 'fullstack-developer'),
  ('fullstack-developer', 'Full Stack Developer', 'full-stack-developer'),
  ('node-js-developer', 'NodeDev', 'nodedev'),
  ('react-developer', 'ReactJS Developer', 'reactjs-developer'),
  ('react-developer', 'React.js Developer', 'react-js-developer'),
  ('machine-learning-engineer', 'ML Engineer', 'ml-engineer'),
  ('machine-learning-engineer', 'AI Engineer', 'ai-engineer'),
  ('machine-learning-engineer', 'Artificial Intelligence Engineer', 'artificial-intelligence-engineer'),
  ('it-support', 'Helpdesk', 'helpdesk'),
  ('it-support', 'Helpdesk Technician', 'helpdesk-technician'),
  ('it-support', 'Helpdesk Specialist', 'helpdesk-specialist'),
  ('it-support', 'Helpdesk Analyst', 'helpdesk-analyst'),
  ('it-support', 'Technical Support', 'technical-support'),
  ('it-support', 'Technical Support Specialist', 'technical-support-specialist'),
  ('it-support', 'Desktop Support', 'desktop-support'),
  ('it-support', 'IT Specialist', 'it-specialist'),
  ('it-support', 'IT Support Engineer', 'it-support-engineer'),
  ('it-support', 'IT Support Specialist', 'it-support-specialist'),
  ('it-support', 'IT Handler', 'it-handler'),
  ('it-support', 'IT Handler Specialist', 'it-handler-specialist'),
  ('it-support', 'Computer Technician', 'computer-technician'),
  ('it-support', 'Service Desk', 'service-desk'),
  ('it-support', 'Service Desk Analyst', 'service-desk-analyst'),
  ('it-support', 'IT Technician', 'it-technician')
) AS aliases("slug", "alias", "aliasKey")
JOIN "JobTitle" titles ON titles."slug" = aliases."slug"
ON CONFLICT ("aliasKey") DO NOTHING;

-- Move skill synonyms into SkillAlias. Variants that normalize to the
-- canonical row identity already resolve directly and do not need alias rows.
INSERT INTO "SkillAlias" ("id", "skillId", "alias", "aliasKey")
SELECT 'catalog_alias_skill_' || aliases."aliasKey", skills."id", aliases."alias", aliases."aliasKey"
FROM (VALUES
  ('react', 'ReactJS', 'reactjs'),
  ('react', 'React JSX', 'reactjsx'),
  ('react', 'React TS', 'reactts'),
  ('cplusplus', 'CPP', 'cpp'),
  ('cplusplus', 'C Plus', 'cplus'),
  ('node-js', 'Node', 'node'),
  ('next-js', 'Next', 'next'),
  ('vue-js', 'Vue', 'vue'),
  ('angular', 'AngularJS', 'angularjs'),
  ('nestjs', 'Nest', 'nest'),
  ('postgresql', 'Postgres', 'postgres'),
  ('kubernetes', 'k8s', 'k8s'),
  ('javascript', 'JS', 'js'),
  ('typescript', 'TS', 'ts'),
  ('go', 'Golang', 'golang'),
  ('react-native', 'RN', 'rn')
) AS aliases("slug", "alias", "aliasKey")
JOIN "Skill" skills ON skills."slug" = aliases."slug"
ON CONFLICT ("aliasKey") DO NOTHING;

-- Move language synonyms into LanguageAlias. These aliases are useful only if
-- the corresponding language catalog row already exists.
INSERT INTO "LanguageAlias" ("id", "languageId", "alias", "aliasKey")
SELECT 'catalog_alias_language_' || aliases."aliasKey", languages."id", aliases."alias", aliases."aliasKey"
FROM (VALUES
  ('uz', 'Uzbek', 'uzbek'),
  ('uz', 'Uzbekcha', 'uzbekcha'),
  ('uz', 'O''zbek', 'ozbek'),
  ('uz', 'O''zbekcha', 'ozbekcha'),
  ('ru', 'Russian', 'russian'),
  ('ru', 'Russkiy', 'russkiy'),
  ('ru', 'Русский', 'русский'),
  ('en', 'English', 'english'),
  ('en', 'Eng', 'eng'),
  ('en', 'English language', 'englishlanguage'),
  ('kk', 'Kazakh', 'kazakh'),
  ('tr', 'Turkish', 'turkish'),
  ('de', 'German', 'german'),
  ('de', 'Deutsch', 'deutsch'),
  ('fr', 'French', 'french'),
  ('ko', 'Korean', 'korean'),
  ('zh', 'Chinese', 'chinese'),
  ('zh', 'Mandarin', 'mandarin'),
  ('ar', 'Arabic', 'arabic'),
  ('id', 'Bahasa Indonesia', 'bahasaindonesia')
) AS aliases("code", "alias", "aliasKey")
JOIN "Language" languages ON languages."code" = aliases."code"
ON CONFLICT ("aliasKey") DO NOTHING;

-- Move benefit synonyms into BenefitAlias.
INSERT INTO "BenefitAlias" ("id", "benefitId", "alias", "aliasKey")
SELECT 'catalog_alias_benefit_' || aliases."aliasKey", benefits."id", aliases."alias", aliases."aliasKey"
FROM (VALUES
  ('health-insurance', 'Healthcare', 'healthcare'),
  ('health-insurance', 'Medical Insurance', 'medicalinsurance'),
  ('health-insurance', 'Health', 'health'),
  ('remote-work', 'WFH', 'wfh'),
  ('remote-work', 'Remote', 'remote'),
  ('remote-work', 'Work from home', 'workfromhome'),
  ('flexible-hours', 'Flex Hours', 'flexhours'),
  ('flexible-hours', 'Flex Time', 'flextime'),
  ('gym', 'Gym Membership', 'gymmembership'),
  ('gym', 'Fitness', 'fitness'),
  ('paid-vacation', 'Vacation', 'vacation'),
  ('paid-vacation', 'Annual Leave', 'annualleave'),
  ('stock-options', 'Stock', 'stock'),
  ('stock-options', 'Equity', 'equity'),
  ('bonus', 'Performance Bonus', 'performancebonus')
) AS aliases("slug", "alias", "aliasKey")
JOIN "Benefit" benefits ON benefits."slug" = aliases."slug"
ON CONFLICT ("aliasKey") DO NOTHING;
