import crypto from 'node:crypto';

const password = process.argv[2];
if (!password) throw new Error('Usage: node hash-password.js <password>');
const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.scryptSync(password, salt, 32).toString('base64url');
console.log(`${salt}:${hash}`);
