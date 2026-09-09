const { REST, Routes } = require('discord.js');
const { token, clientId, guildId } = require('./config');
const commands = require('./commands.json');
if (!token || !clientId) throw new Error('ضع DISCORD_TOKEN و CLIENT_ID في .env');
const rest = new REST({ version: '10' }).setToken(token);
const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
rest.put(route, { body: commands }).then(() => console.log(`✅ تم تسجيل ${commands.length} أمرًا.`)).catch(console.error);
