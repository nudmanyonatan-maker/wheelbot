import { generateVapidKeys } from '../lib/webpush.js';

const keys = await generateVapidKeys();
process.stdout.write(JSON.stringify({ publicKey: keys.publicKey, privateJwk: keys.privateJwk }));
