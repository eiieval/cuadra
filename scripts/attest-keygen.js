// npm run attest:keygen
// Prints HOW to create the Ed25519 key that signs attestations (api/attest.js). It never generates or prints a key
// itself: you run the command, so the key goes straight to the place that needs it and never into this terminal's history
// of a shared machine, a log or a commit.
const lines = [
  'Cuadra signed attestation: enable it with one environment variable, ATTEST_PRIVATE_KEY.',
  '',
  '1. Generate a key (either command; the key is printed by THAT command, not by this script):',
  '',
  '   node -e "process.stdout.write(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
  '   openssl genpkey -algorithm ed25519          (a PEM; keep the BEGIN/END lines)',
  '',
  '2. Store it as ATTEST_PRIVATE_KEY, never in the repository:',
  '',
  '   Vercel:   vercel env add ATTEST_PRIVATE_KEY production      (paste the value when asked), then redeploy',
  '   Local:    a line ATTEST_PRIVATE_KEY=<value> in cuadra/.env  (git-ignored)',
  '',
  '3. Check it: GET /api/attest returns { "enabled": true, "keyId": ... } and /api/health says "attestation": true.',
  '',
  'Without the variable attestation is simply off ("Unsigned copy" everywhere, no errors). Rotating the key makes older',
  'signatures read "Signed with another key: signature not checked". With MOCK=1 a fixed test key is used.',
];
console.log(lines.join('\n'));
