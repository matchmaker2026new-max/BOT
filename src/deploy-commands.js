const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('./config');

const isPlaceholder = value => !value || value.includes('ضع_') || value.includes('معرف_');

if (isPlaceholder(config.token) || isPlaceholder(config.clientId) || isPlaceholder(config.guildId)) {
  throw new Error('استبدل قيم DISCORD_TOKEN و CLIENT_ID و GUILD_ID التجريبية في ملف .env بقيم Discord الحقيقية.');
}

const commands = [
  new SlashCommandBuilder().setName('setup-ticket').setDescription('نشر لوحة فتح التذاكر الاحترافية'),
  new SlashCommandBuilder().setName('zeropanel').setDescription('نشر لوحة تذاكر Zero System'),
  new SlashCommandBuilder().setName('close').setDescription('إغلاق التذكرة الحالية'),
  new SlashCommandBuilder().setName('rename').setDescription('تغيير اسم التذكرة').addStringOption(o => o.setName('name').setDescription('الاسم الجديد').setRequired(true)),
  new SlashCommandBuilder().setName('add').setDescription('إضافة عضو للتذكرة').addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)),
  new SlashCommandBuilder().setName('remove').setDescription('إزالة عضو من التذكرة').addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);
(async () => {
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commands });
  console.log(`تم تسجيل ${commands.length} أوامر بنجاح.`);
})();
