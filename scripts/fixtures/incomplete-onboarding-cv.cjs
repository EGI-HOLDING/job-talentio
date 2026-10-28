module.exports = {
  headline: 'Frontend Developer', summary: 'Synthetic CV review fixture.',
  skillNames: ['React'],
  experiences: Array.from({ length: 10 }, (_, index) => ({
    title: [0, 5, 9].includes(index) ? '' : 'Engineer ' + (index + 1),
    companyName: 'Example Studio', startDate: '2020-01-01', endDate: '2021-01-01',
    description: 'Synthetic experience for draft validation.', isCurrent: false,
  })),
  educations: [{ school: 'Example University', degree: 'BACHELOR', startDate: '2015-01-01', endDate: '2019-01-01' }],
  languages: [],
};
