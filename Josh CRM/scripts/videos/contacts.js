// A small phone contacts export used on screen in the videos. All names are made up.
module.exports = [
  ['Tony Reyes', 'Keystone Business Funding', 'Owner', '(305) 555-0144', 'tony@keystone.example'],
  ['Rita Gomez', 'Sunrise Capital Group', 'Owner', '(786) 555-0177', 'rita@sunrisecap.example'],
  ['Sam Lee', 'Sunrise Capital Group LLC', 'Sales rep', '(786) 555-0178', ''],
  ['Dev Patel', 'Blue Harbor Funding', 'Managing partner', '(954) 555-0150', 'dev@blueharbor.example'],
  ['Lena Cho', 'Blue Harbor Funding', 'File processor', '(954) 555-0151', 'files@blueharbor.example'],
  ['Mom', '', '', '(305) 555-0199', ''],
  ['Dr. Ellis Dental', '', '', '(305) 555-0123', '']
].map(([name, org, title, tel, email]) => ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + name, org ? 'ORG:' + org + ';' : '', title ? 'TITLE:' + title : '',
  'TEL;type=CELL:' + tel, email ? 'EMAIL;type=WORK:' + email : '', 'END:VCARD'].filter(Boolean).join('\n')).join('\n') + '\n';
