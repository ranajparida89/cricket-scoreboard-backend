const bcrypt = require("bcrypt");

const inputPassword = "Ranaj@89"; // ✅ The password you're typing
const hashedPasswordFromDB = "$2b$10$NbkeQsrcZwnNKs7nqcYbl.k.fNQEnbDSCCd/qzLYs3hWUCpEBfXZ2"; // ✅ From your DB

bcrypt.compare(inputPassword, hashedPasswordFromDB).then((isMatch) => {
  console.log("✅ Password Match:", isMatch);
});

