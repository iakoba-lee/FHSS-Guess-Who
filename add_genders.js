const fs = require('fs');
const path = require('path');

const PEOPLE_FILE = path.join(__dirname, 'people.json');
const maleNames = new Set([
  'Jeff', 'Danny', 'Jordan', 'Joe', 'Daniel', 'Matt', 'Sam', 'Jonathan',
  'David', 'Tom', 'A aron', 'Tyler', 'Jason', 'Duncan', 'Alden', 'Chris',
  'Aaron', 'Jay', 'Brendan', 'Mike', 'Lars', 'Spencer', 'Chad', 'Ryan', 'Curtis'
]);

const people = JSON.parse(fs.readFileSync(PEOPLE_FILE, 'utf8'));

for (const person of people) {
  const firstName = String(person.name || '').split(/\s+/)[0];
  person.gender = maleNames.has(firstName) ? 'M' : 'F';
}

fs.writeFileSync(PEOPLE_FILE, `${JSON.stringify(people, null, 4)}\n`);
console.log('Updated people.json with genders!');
