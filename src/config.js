const path = require('node:path');
require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || '',
  ownerId: process.env.OWNER_ID || '',
  prefix: process.env.PREFIX || '!',
  dataFile: path.join(__dirname, '..', 'data', 'store.json')
};
