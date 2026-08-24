const crypto = require('crypto');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const createInviteCode = (length = 6) => Array.from(crypto.randomBytes(length), byte => ALPHABET[byte % ALPHABET.length]).join('');
module.exports = { createInviteCode };
