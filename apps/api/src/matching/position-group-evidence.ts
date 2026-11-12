type WorkRule = {
  action: RegExp;
  output: RegExp;
  boundary?: RegExp;
};

// Broad groups need evidence of the work itself, including when a local title
// cites a broader ESCO profile. An official seed is curated separately.
const primaryWork: Readonly<Record<string, readonly WorkRule[]>> = {
  'group:sales': [
    {
      action: /\b(?:sell(?:s|ing)?|upsell(?:s|ing)?|prospect(?:ed|ing|s(?= for))?|negotiat\w*|win|secure|convert)\b/i,
      output: /\b(?:customers?|prospects?|clients?|deals?|contracts?|merchandise|products?|goods|services?|tickets?|sales|advertising|prices?|offers?|buyers?|orders?|speciali[sz]ed shops?)\b/i,
      boundary: /\b(?:refunds?|missing information|dispatching|complaints?)\b/i,
    },
    {
      action: /\b(?:manag\w*|lead\w*|develop\w*|direct\w*|plan\w*|define\w*|set\w*|grow\w*|maintain\w*)\b/i,
      output: /\b(?:sales (?:accounts?|relationships?|channels?|programmes?|programs?|strateg\w*|agents?|teams?|targets?)|selling efforts?|commercial (?:targets?|accounts?)|sales business plans?)\b/i,
      boundary: /\b(?:evaluation stage|working in conjunction with|technical demonstrations?)\b/i,
    },
  ],
  'group:doctor': [
    {
      action: /\b(?:diagnos\w*|treat\w*|operat\w*|prescrib\w*|assess\w*|examin\w*|perform\w*|administ\w*|prevent\w*|provid\w*|plan\w*)\b/i,
      output: /\b(?:diseases?|disorders?|(?:medical|skin and venereal) conditions?|medical examinations?|patients?|surger\w*|surgical|clinical nutrition care|medical rehabilitation|anaesthes\w*|anesthes\w*|impairments?)\b/i,
    },
  ],
  'group:driver': [
    {
      action: /\b(?:drive[sn]?|driving|drove|operate[sd]?|operating|transport(?:s|ed|ing)?|deliver(?:s|ed|ing)?|collect(?:s|ed|ing)?|haul(?:s|ed|ing)?|tow(?:s|ed|ing)?)\b/i,
      output: /\b(?:vehicles?|vans?|buses|coaches|trucks?|cars?|taxis?|ambulances?|hearses?|trains?|trams?|trolleybuses|passengers?|freight|road|railway)\b/i,
      boundary: /\b(?:plan|schedule|dispatch|supervise|coordinate)\w* (?:the |a )?(?:driv\w*|deliver\w*|transport\w*)\b/i,
    },
  ],
  'group:engineer': [
    {
      action: /\b(?:design\w*|develop\w*|build\w*|research\w*|simulat\w*|validat\w*|analys\w*|analyz\w*|test\w*|implement\w*|maintain\w*|maintenance|install\w*|commission\w*|integrat\w*|optimis\w*|optimiz\w*|automate\w*|improv\w*|inspect\w*|repair\w*|assess\w*|study|verify|oversee|compliance)\b/i,
      output: /\b(?:systems?|software|hardware|applications?|models?|algorithms?|components?|assemblies|equipment|infrastructure|installations?|(?:engineering|technical|industrial) (?:processes|designs?|solutions?|specifications?|projects?)|structures?|circuits?|machines?|machinery|networks?|materials?|plants?|engines?|batteries|devices?|aircrafts?|airports?|vessels?|vehicles?|robot\w*|pipelines?|manufacturing|power generation|energy (?:production|conversion|supply)|substations?|utilities|chemical solutions?|prototypes?|oil|gas wells?|drilling|fuel extraction|extracting liquid fuels|soils?|natural language processing|computing science|programming and code|(?:science of sound|sound transmission)|mine development|health and safety programs?)\b/i,
      boundary: /\b(?:sales|prospects?|schedule\w* and requirements|games? of chance|test cases?|assist\w* .{0,45} with checking operations)\b/i,
    },
  ],
  'group:machine-operator': [
    {
      action: /\b(?:set(?:s|ting)? up|operate[sd]?|operating|runs?|running|tend(?:s|ed|ing)?|adjust(?:s|ed|ing)?|control(?:s|led|ling)?|program(?:s|med|ming)?|regulate[sd]?|regulating|use[sd]?|using|utili[sz]e|work with|handle)\b/i,
      output: /\b(?:machines?|machinery|equipment|production lines?|press(?:es)?|lathes|furnaces|kilns|tools|saws|drills|industrial robots|moulds?|molds?|textile process|transfer pumps?)\b/i,
      boundary: /\b(?:direct\w* workers|supervis\w* (?:workers|operators)|vending|remove cash|refill goods)\b/i,
    },
  ],
  'group:biologist': [
    { action: /\b(?:study|research\w*|test\w*|identify|interpret\w*)\b/i, output: /\b(?:organisms?|microorganisms?|microbiology|ecology|genetics)\b/i },
  ],
  'group:electrician': [
    { action: /\b(?:install\w*|inspect\w*|repair\w*|maintain\w*|fit\w*)\b/i, output: /\b(?:electrical|wiring|control panels?)\b/i },
  ],
  'group:pharmacist': [
    { action: /\b(?:dispens\w*|formulat\w*|test\w*|prepar\w*|oversee|ensur\w*)\b/i,
      output: /\b(?:medications?|prescriptions?|pharmacy services|medicine handling|pharmaceutical production)\b/i },
  ],
};

export function primaryGroupWork(groupId: string, description: string, coreTasks: readonly string[] = []) {
  const rules = primaryWork[groupId];
  if (!rules) return undefined;
  const delegatesOperation = groupId === 'group:machine-operator'
    && /\b(?:direct\w* workers|supervis\w* (?:workers|operators)|vending|remove cash|refill goods)\b/i.test(description);
  const clauses = [description, ...delegatesOperation ? [] : coreTasks].flatMap(text => text.split(/[.!?;\n]+/));
  return clauses.find(clause => rules.some(rule => rule.action.test(clause) && rule.output.test(clause) && !rule.boundary?.test(clause)))?.trim() ?? null;
}
