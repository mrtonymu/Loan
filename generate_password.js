const bcrypt = require('bcryptjs');

async function generatePassword() {
  const password = 'admin123';
  const saltRounds = 10;
  const hash = await bcrypt.hash(password, saltRounds);
  console.log('Password:', password);
  console.log('Hash:', hash);
}

generatePassword();
