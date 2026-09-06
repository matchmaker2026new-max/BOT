const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, PermissionsBitField, ChannelType,
  AttachmentBuilder, Events
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

if (!config.token) throw new Error('DISCORD_TOKEN غير موجود في .env');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const safe = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const isTicketStaff = member => Boolean(member && config.ticketStaffRoleIds.some(roleId => member.roles.cache.has(roleId)));
const isStaff = member => Boolean(member && (
  member.permissions.has(PermissionsBitField.Flags.Administrator) ||
  member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
  (config.staffRoleId && member.roles.cache.has(config.staffRoleId))
));
const ticketOf = channel => channel.topic?.match(/ticket-owner:(\d+)/)?.[1] || null;
const claimedStaffOf = channel => channel.topic?.match(/ticket-claimed-by:(\d+)/)?.[1] || null;
const serverEmoji = (guild, name) => guild.emojis.cache.find(emoji => emoji.name === name)?.toString() || '';
const pointsFile = path.join(__dirname, '..', 'data', 'admin-points.json');
const localPanelImage = path.join(__dirname, '..', 'assets', 'panel.png');
const hasLocalPanelImage = () => fs.existsSync(localPanelImage);
const bannerUrl = 'https://media.discordapp.net/attachments/1545552204998512751/1546065695928881172/Untitled41_20260507131326-1-1-1.png?ex=6a9e6d62&is=6a9d1be2&hm=dcedf72322d11ff1f4652bc9cf51778339642039aa81ef12ac484c52d8bf9b26&format=webp&quality=lossless&width=1024&height=577';
const surveyStates = new Map();

function loadAdminPoints() {
  try {
    return JSON.parse(fs.readFileSync(pointsFile, 'utf8'));
  } catch (error) {
    return {};
  }
}

function saveAdminPoints(points) {
  fs.mkdirSync(path.dirname(pointsFile), { recursive: true });
  fs.writeFileSync(pointsFile, JSON.stringify(points, null, 2));
}

function awardAdminPoints(userId) {
  const points = loadAdminPoints();
  const record = points[userId] || { points: 0, tickets: 0 };
  record.points += 10;
  record.tickets += 1;
  points[userId] = record;
  saveAdminPoints(points);
  return record;
}

function markPointsAwarded(channel) {
  const topic = channel.topic || '';
  if (topic.includes('ticket-points-awarded')) return false;
  channel.setTopic(`${topic} | ticket-points-awarded`).catch(error => console.error('Points topic update error:', error));
  return true;
}

function surveyComplete(channelId) {
  const state = surveyStates.get(channelId);
  return Boolean(state?.admin && state?.service && state?.speed);
}

async function publishSurveyResult(channel, state, surveyMessage = state.surveyMessage) {
  if (state.resultSent) return;
  const embed = surveyEmbed(state);
  let published = false;
  await channel.send({ content: `<@${state.ownerId}>`, embeds: [embed] })
    .then(() => { published = true; })
    .catch(error => console.error('Survey result in ticket error:', error));
  if (surveyMessage) await surveyMessage.edit({ components: [] }).catch(error => console.error('Survey form cleanup error:', error));
  state.resultSent = published;
  if (!published) return;
  if (config.ratingsChannelId && config.ratingsChannelId !== channel.id) {
    const ratingsChannel = await channel.guild.channels.fetch(config.ratingsChannelId).catch(() => null);
    if (ratingsChannel?.isTextBased()) {
      await ratingsChannel.send({ embeds: [embed] }).catch(error => console.error('Survey ratings channel error:', error));
    } else {
      console.error(`Ratings channel not found or is not text-based: ${config.ratingsChannelId}`);
    }
  }
}

const ticketOptions = {
  nitro: { label: 'نـيـتـرو', emoji: { id: '1532262943708680395', name: 'NitroActivate', animated: true }, description: 'شراء أو تفعيل Nitro', color: 0x5865f2 },
  effects: { label: 'افـيكتـات', emoji: { id: '1494960318886055996', name: '6FA1', animated: true }, description: 'شراء أو طلب إيفكتات', color: 0x9b59b6 },
  visa: { label: 'فـيـزا', emoji: { id: '1538863370088873984', name: 'Visa', animated: false }, description: 'خدمات الفيزا والدفع', color: 0x3498db },
  credit: { label: 'كـرديـت', emoji: { id: '1353307920183459980', name: 'credit', animated: true }, description: 'شراء كريدت', color: 0x2ecc71 },
  subscriptions: { label: 'اشـتـركـات', emoji: { id: '1522575696239661156', name: 'd_netflix', animated: true }, description: 'الاشتراكات الرقمية', color: 0xe74c3c },
  other: { label: 'اخـرى', emoji: { id: '1541593884591788208', name: 'stock', animated: false }, description: 'أي طلب آخر', color: 0xf1c40f },
  reset: { label: 'ريـسـت', emoji: { id: '1526965959720439971', name: 'loading', animated: true }, description: 'تحديث قائمة الخيارات', color: 0x95a5a6 }
};

const rulesText = [
  '# قوانين التذكرة',
  '',
  '**1 يمنع إسبام المنشن، يرجى التحلي بالصبر!**',
  '**2 يمنع إلغاء الطلب أو تغييره بعد تحويل المبلغ.**',
  '**3 يمنع الاستهبال داخل التذكرة.**',
  '**4 بعد إكمال طلبك يجب إرسال تقييم للخدمة.**',
  '**5 الاحترام واجب داخل التذكرة!**'
].join('\n');

function typeMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('ticket_type').setPlaceholder('🛒 اختر نوع الخدمة المطلوبة').addOptions(
      Object.entries(ticketOptions).map(([value, item]) => ({ label: item.label, value, description: item.description, emoji: item.emoji }))
    )
  );
}

function ticketControls(claimed = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(claimed ? 'ticket_release' : 'ticket_claim').setLabel(claimed ? 'ترك' : 'استلام').setEmoji(claimed ? '↩️' : '✅').setStyle(claimed ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_add_member').setLabel('إضافة عضو').setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_remove_member').setLabel('إزالة عضو').setEmoji('➖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('إغلاق').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_delete').setLabel('حذف').setEmoji('🗑️').setStyle(ButtonStyle.Secondary)
  );
}

function panelEmbed() {
  const e = new EmbedBuilder().setColor(config.brandColor)
    .setTitle('📜 قوانين التذكرة')
    .setDescription(rulesText)
    .setFooter({ text: `${config.brandName} • اختر الخدمة من القائمة` });
  e.setImage(bannerUrl);
  return e;
}

async function sendPanel(channel) {
  await channel.send({ embeds: [panelEmbed()], components: [typeMenu()] });
}

async function createTicket(interaction, type, subject, description, link, ids) {
  const guild = interaction.guild;
  await interaction.deferReply({ ephemeral: true });
  const existing = guild.channels.cache.find(c => c.topic?.includes(`ticket-owner:${interaction.user.id}`));
  if (existing) return interaction.editReply({ content: `لديك تذكرة مفتوحة بالفعل: ${existing}` });
  const botMember = guild.members.me || await guild.members.fetch(interaction.client.user.id);
  const category = config.ticketCategoryId ? guild.channels.cache.get(config.ticketCategoryId) : null;
  if (config.ticketCategoryId && (!category || category.type !== ChannelType.GuildCategory)) {
    return interaction.editReply({ content: `فئة التذاكر غير موجودة أو ليست فئة قنوات: ${config.ticketCategoryId}` });
  }
  const availableStaffRoleIds = config.ticketStaffRoleIds.filter(roleId => guild.roles.cache.has(roleId));
  const missingStaffRoleIds = config.ticketStaffRoleIds.filter(roleId => !guild.roles.cache.has(roleId));
  if (missingStaffRoleIds.length) console.warn(`رتب غير موجودة في هذا السيرفر: ${missingStaffRoleIds.join(', ')}`);
  const item = ticketOptions[type] || ticketOptions.other;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: botMember.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] }
  ];
  for (const roleId of availableStaffRoleIds) overwrites.push({
    id: roleId,
    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
    deny: [PermissionsBitField.Flags.SendMessages]
  });
  const channel = await guild.channels.create({
    name: `${config.ticketPrefix}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 80) || `${config.ticketPrefix}-${interaction.user.id.slice(-4)}`,
    type: ChannelType.GuildText,
    parent: category?.id,
    topic: `ticket-owner:${interaction.user.id} | type:${type}`,
    permissionOverwrites: overwrites,
    reason: `تذكرة جديدة بواسطة ${interaction.user.tag}`
  });
  const embed = new EmbedBuilder().setColor(item.color)
    .setTitle(`${item.label}`)
    .setDescription(`تم فتح التذكرة <@${interaction.user.id}>\n\nاكتب طلبك هنا وسيقوم فريق الدعم بالرد عليك.`)
    .setFooter({ text: `${config.brandName} • فريق الدعم` });
  embed.setImage(bannerUrl);
  const controls = ticketControls();
  await interaction.editReply({ content: `تم إنشاء التذكرة داخل الفئة المطلوبة: ${channel}` });
  const staffMentions = availableStaffRoleIds.map(roleId => `<@&${roleId}>`).join(' ');
  await channel.send({ content: `<@${interaction.user.id}> ${staffMentions}`, embeds: [embed], components: [controls] }).catch(error => console.error('Ticket message error:', error));
}

function ticketModal(type) {
  return new ModalBuilder().setCustomId(`ticket_modal:${type}`).setTitle('تفاصيل التذكرة').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('العنوان').setPlaceholder('اكتب عنوان الإيميل أو الطلب').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('الوصف').setPlaceholder('اشرح المشكلة أو الطلب بالتفصيل').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('link').setLabel('الرابط — اختياري').setPlaceholder('رابط صورة أو ملف أو صفحة').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500))
  );
}

function memberModal(action) {
  return new ModalBuilder().setCustomId(`ticket_member:${action}`).setTitle(action === 'add' ? 'إضافة عضو للتذكرة' : 'إزالة عضو من التذكرة').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('member').setLabel('منشن العضو أو ID').setPlaceholder('@العضو أو 123456789012345678').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30))
  );
}

const memberIdFromInput = value => value.match(/\d{17,20}/)?.[0] || null;

function ratingMenu(kind, label, channelId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`survey:${kind}:${channelId}`).setPlaceholder(label).addOptions(
      [1, 2, 3, 4, 5].map(score => ({ label: `${score}/5`, value: String(score), description: score === 5 ? 'ممتاز' : score === 1 ? 'يحتاج إلى تحسين' : 'تقييم الخدمة' }))
    )
  );
}

function surveyEmbed(state) {
  const average = ((state.admin + state.service + state.speed) / 3).toFixed(2);
  const stars = score => `${'⭐'.repeat(score)}${'☆'.repeat(5 - score)}  **${score}/5**`;
  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setAuthor({ name: `${config.brandName} • نظام التقييم`, iconURL: 'https://cdn.discordapp.com/embed/avatars/0.png' })
    .setTitle('🏆 تقييم التذكرة')
    .setDescription([
      '**تم استلام التقييم بنجاح**',
      'شكرًا لصاحب التذكرة على مشاركته رأيه. هذه النتيجة توثّق جودة الخدمة المقدمة.',
      '',
      `👤 **صاحب التذكرة:** <@${state.ownerId}>`,
      `🛡️ **الإداري:** ${state.staffMention}`
    ].join('\n'))
    .addFields(
      { name: '👨‍💼 تقييم الإداري', value: stars(state.admin), inline: false },
      { name: '💰 تقييم سعر الخدمة', value: stars(state.service), inline: false },
      { name: '⚡ تقييم سرعة التسليم', value: stars(state.speed), inline: false },
      { name: '📊 المتوسط النهائي', value: `## ⭐ ${average} / 5\n${Number(average) >= 4 ? '🌟 تقييم ممتاز، شكرًا لثقتكم!' : 'شكرًا لملاحظاتكم، سنعمل على تحسين التجربة.'}`, inline: false }
    )
    .setFooter({ text: `${config.brandName} • تقييم موثّق من صاحب التذكرة` })
    .setTimestamp();
  if (state.staffAvatar) embed.setThumbnail(state.staffAvatar);
  embed.setImage(bannerUrl);
  return embed;
}

async function showSurvey(message) {
  const channelId = message.channel.id;
  const ownerId = ticketOf(message.channel);
  const state = { ownerId, staffId: message.author.id, staffMention: `${message.author}`, staffAvatar: message.author.displayAvatarURL({ size: 128 }), admin: null, service: null, speed: null };
  surveyStates.set(channelId, state);
  const surveyMessage = await message.channel.send({
    content: `<@${ownerId}>`,
    embeds: [new EmbedBuilder().setColor(config.brandColor).setTitle('📝 نموذج تقييم').setDescription('يرجى تقييم تجربتك قبل إغلاق التذكرة.\n\nالتقييم متاح لصاحب التذكرة فقط.')],
    components: [ratingMenu('admin', 'تقييم الإداري', channelId), ratingMenu('service', 'تقييم سعر الخدمة', channelId), ratingMenu('speed', 'تقييم سرعة التسليم', channelId)]
  }).catch(error => {
    console.error('Survey form message error:', error);
    return null;
  });
  if (surveyMessage) state.surveyMessage = surveyMessage;
}

async function transcript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const rows = [...messages.values()].reverse().map(message => {
    const avatar = message.author.displayAvatarURL({ extension: 'png', size: 64 });
    const content = safe(message.content || '').replace(/\n/g, '<br>');
    const embeds = message.embeds.map(embed => `<div class="discord-embed"><strong>${safe(embed.title || 'رسالة مضمّنة')}</strong>${embed.description ? `<p>${safe(embed.description).replace(/\n/g, '<br>')}</p>` : ''}</div>`).join('');
    const attachments = [...message.attachments.values()].map(file => `<div class="attachment">📎 ${safe(file.name)}</div>`).join('');
    const body = content || embeds || attachments || '<span class="muted">[رسالة بدون نص]</span>';
    return `<article class="message"><img class="avatar" src="${avatar}" alt=""><div class="message-body"><div class="meta"><strong>${safe(message.member?.displayName || message.author.username)}</strong><span class="bot">${message.author.bot ? 'BOT' : ''}</span><time>${new Date(message.createdTimestamp).toLocaleString('ar')}</time></div><div class="content">${body}${embeds && content ? embeds : ''}${attachments && (content || embeds) ? attachments : ''}</div></div></article>`;
  }).join('\n');
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#${safe(channel.name)}</title><style>
  :root{color-scheme:dark;font-family:Arial,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;direction:rtl}.app{max-width:980px;margin:0 auto;min-height:100vh;background:#313338}.channel-header{height:76px;padding:14px 24px;border-bottom:1px solid #1f2023;background:#2b2d31;display:flex;align-items:center;gap:12px}.hash{font-size:30px;color:#949ba4}.channel-header h1{font-size:20px;margin:0;color:#f2f3f5}.channel-header p{margin:4px 0 0;color:#949ba4;font-size:13px}.chat{padding:24px 20px 44px}.day{display:flex;align-items:center;gap:12px;color:#949ba4;font-size:12px;margin:8px 0 24px}.day:before,.day:after{content:"";height:1px;background:#4e5058;flex:1}.message{display:flex;gap:14px;direction:rtl;padding:8px 10px;margin:2px 0;border-radius:6px}.message:hover{background:#2e3035}.avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;flex:none}.message-body{min-width:0;flex:1}.meta{display:flex;align-items:center;gap:8px;direction:rtl}.meta strong{font-size:15px;color:#f2f3f5}.meta time{font-size:11px;color:#949ba4;font-weight:normal}.bot{font-size:10px;background:#5865f2;color:white;border-radius:3px;padding:2px 4px}.content{font-size:15px;line-height:1.65;margin-top:3px;white-space:normal;overflow-wrap:anywhere}.muted{color:#949ba4}.discord-embed{border-right:4px solid #5865f2;background:#2b2d31;border-radius:4px;padding:12px 14px;margin-top:8px;max-width:620px}.discord-embed strong{color:#f2f3f5}.discord-embed p{margin:6px 0;color:#dbdee1}.attachment{display:inline-block;margin-top:8px;background:#1e1f22;border:1px solid #4e5058;border-radius:4px;padding:8px 12px;color:#00a8fc}.footer{padding:18px 24px;color:#949ba4;border-top:1px solid #1f2023;font-size:12px}@media(max-width:600px){.chat{padding:16px 10px}.channel-header{padding:12px 16px}.message{gap:10px}.avatar{width:36px;height:36px}.content{font-size:14px}}
  </style></head><body><main class="app"><header class="channel-header"><span class="hash">#</span><div><h1>${safe(channel.name)}</h1><p>بداية قناة التذكرة • سجل المحادثة الكامل</p></div></header><section class="chat"><div class="day">${new Date(channel.createdTimestamp || Date.now()).toLocaleDateString('ar')}</div>${rows}</section><footer class="footer">تم تصدير ${messages.size} رسالة من #${safe(channel.name)} • ${config.brandName}</footer></main></body></html>`;
  const file = path.join(__dirname, '..', 'transcripts', `${channel.id}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html);
  return file;
}

async function closeTicket(interaction, deleteAfter = false) {
  if (!ticketOf(interaction.channel)) return interaction.reply({ content: 'هذا الأمر يعمل داخل قناة تذكرة فقط.', ephemeral: true });
  const ownerId = ticketOf(interaction.channel);
  const claimedStaffId = claimedStaffOf(interaction.channel);
  if (!claimedStaffId) return interaction.reply({ content: 'يجب استلام التذكرة أولًا قبل إغلاقها أو حذفها.', ephemeral: true });
  if (!isTicketStaff(interaction.member)) return interaction.reply({ content: 'هذه العملية متاحة للرتب المحددة فقط.', ephemeral: true });
  if (interaction.user.id !== claimedStaffId) return interaction.reply({ content: 'فقط الإداري الذي استلم التذكرة يستطيع إغلاقها أو حذفها.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  if (markPointsAwarded(interaction.channel)) awardAdminPoints(interaction.user.id);
  const file = await transcript(interaction.channel);
  let downloadSent = false;
  if (deleteAfter) {
    const owner = await interaction.client.users.fetch(ownerId).catch(() => null);
    const transcriptEmbed = new EmbedBuilder()
      .setColor(config.brandColor)
      .setTitle('📄 سجل التذكرة')
      .setDescription('تم إغلاق تذكرتك. أرفقنا لك نسخة كاملة قابلة للتحميل والفتح في المتصفح.')
      .addFields(
        { name: '🎫 التذكرة', value: `#${interaction.channel.name}`, inline: true },
        { name: '👤 صاحب التذكرة', value: `<@${ownerId}>`, inline: true },
        { name: '🛡️ أغلقها', value: `${interaction.user}`, inline: true },
        { name: '🕒 وقت الإغلاق', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
      )
      .setFooter({ text: `${config.brandName} • احتفظ بالنسخة للرجوع إليها` })
      .setTimestamp();
    if (owner) transcriptEmbed.setThumbnail(owner.displayAvatarURL({ size: 128 }));
    if (owner) {
      downloadSent = Boolean(await owner.send({
        embeds: [transcriptEmbed],
        files: [new AttachmentBuilder(file, { name: `${interaction.channel.name}-transcript.html` })]
      }).then(() => true).catch(() => false));
    }
  }
  const result = deleteAfter
    ? (downloadSent ? 'تم إرسال نسخة كاملة من التذكرة إلى الخاص، وسيتم حذف القناة.' : 'تعذر إرسال النسخة إلى الخاص لأن الرسائل الخاصة مغلقة، وتم حفظ السجل محليًا.')
    : 'تم إغلاق التذكرة وحفظ السجل محليًا.';
  await interaction.editReply({ content: result });
  if (config.transcriptChannelId) {
    const log = await interaction.guild.channels.fetch(config.transcriptChannelId).catch(() => null);
    if (log?.isTextBased()) await log.send({
      embeds: [new EmbedBuilder()
        .setColor(config.brandColor)
        .setTitle('📄 تم إغلاق تذكرة')
        .setDescription('تم حفظ نسخة السجل محليًا وإرسالها إلى صاحب التذكرة عبر الخاص عند نجاح الإرسال.')
        .addFields(
          { name: '🎫 التذكرة', value: `#${interaction.channel.name}`, inline: true },
          { name: '👤 صاحب التذكرة', value: `<@${ownerId}>`, inline: true },
          { name: '🛡️ أغلقها', value: `${interaction.user}`, inline: true }
        )
        .setFooter({ text: config.brandName })
        .setTimestamp()]
    });
  }
  if (deleteAfter) {
    const botPermissions = interaction.channel.permissionsFor(interaction.guild.members.me);
    if (!botPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
      console.error('Cannot delete ticket: bot is missing Manage Channels.');
      return interaction.editReply({ content: 'تم حفظ النسخة، لكن لا أملك صلاحية Manage Channels لحذف القناة.' });
    }
    await interaction.channel.delete(`حذف التذكرة بواسطة ${interaction.user.tag}`).catch(error => {
      console.error('Ticket deletion error:', error);
    });
    return;
  }
  await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch(error => {
    console.error('Ticket close permission update error:', error);
  });
  await interaction.channel.setName(`closed-${interaction.channel.name.replace(/^closed-/, '')}`).catch(() => {});
}

client.once(Events.ClientReady, c => console.log(`✅ ${c.user.tag} متصل وجاهز.`));
client.once(Events.ClientReady, c => {
  if (!config.staffRoleId) console.warn('تنبيه: STAFF_ROLE_ID فارغ؛ الرؤية الكاملة للتذاكر مضمونة للإداريين بصلاحية Administrator فقط.');
  if (config.ticketCategoryId) console.log(`📁 فئة التذاكر: ${config.ticketCategoryId}`);
  if (config.ratingsChannelId) console.log(`⭐ روم التقييم: ${config.ratingsChannelId}`);
});
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (['setup-ticket', 'zeropanel'].includes(interaction.commandName)) {
        if (!isStaff(interaction.member)) return interaction.reply({ content: 'تحتاج صلاحية Manage Channels لنشر اللوحة.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        await sendPanel(interaction.channel);
        return interaction.editReply({ content: 'تم نشر لوحة التذاكر.' });
      }
      if (interaction.commandName === 'close') return closeTicket(interaction);
      if (interaction.commandName === 'rename') {
        if (!isStaff(interaction.member)) return interaction.reply({ content: 'هذا الأمر لفريق الدعم فقط.', ephemeral: true });
        if (!ticketOf(interaction.channel)) return interaction.reply({ content: 'هذه ليست قناة تذكرة.', ephemeral: true });
        await interaction.channel.setName(`${config.ticketPrefix}-${interaction.options.getString('name').toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 80)}`); return interaction.reply({ content: 'تم تغيير الاسم.', ephemeral: true });
      }
      if (['add', 'remove'].includes(interaction.commandName)) {
        if (!isStaff(interaction.member) || !ticketOf(interaction.channel)) return interaction.reply({ content: 'هذا الأمر لفريق الدعم داخل التذكرة فقط.', ephemeral: true });
        const user = interaction.options.getUser('user');
        await interaction.channel.permissionOverwrites[interaction.commandName === 'add' ? 'create' : 'edit'](user.id, interaction.commandName === 'add' ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } : { ViewChannel: false });
        return interaction.reply({ content: interaction.commandName === 'add' ? `تمت إضافة ${user}.` : `تمت إزالة ${user}.`, ephemeral: true });
      }
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type') {
      if (interaction.values[0] === 'reset') return interaction.update({ components: [typeMenu()] });
      return createTicket(interaction, interaction.values[0], '', '', '', interaction.user.id);
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('survey:')) {
      const [, kind, channelId] = interaction.customId.split(':');
      const state = surveyStates.get(channelId);
      if (!state || interaction.channel.id !== channelId) return interaction.reply({ content: 'انتهى هذا النموذج.', ephemeral: true });
      if (interaction.user.id !== state.ownerId) return interaction.reply({ content: 'التقييم متاح لصاحب التذكرة فقط.', ephemeral: true });
      if (state[kind] !== null) return interaction.reply({ content: 'تم تسجيل هذا التقييم مسبقًا.', ephemeral: true });
      state[kind] = Number(interaction.values[0]);
      await interaction.reply({ content: surveyComplete(channelId) ? 'تم اكتمال التقييم بالكامل، يمكن للإدارة إنهاء التذكرة.' : 'تم حفظ تقييمك، أكمل بقية الأسئلة.', ephemeral: true });
      if (surveyComplete(channelId)) await publishSurveyResult(interaction.channel, state, interaction.message);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal:')) {
      const type = interaction.customId.split(':')[1];
      return await createTicket(interaction, type, interaction.fields.getTextInputValue('subject'), interaction.fields.getTextInputValue('description'), interaction.fields.getTextInputValue('link'), interaction.user.id);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_member:')) {
      if (!isTicketStaff(interaction.member)) return interaction.reply({ content: 'هذا الزر للرتب المحددة فقط.', ephemeral: true });
      if (!ticketOf(interaction.channel)) return interaction.reply({ content: 'هذا الزر يعمل داخل التذكرة فقط.', ephemeral: true });
      const action = interaction.customId.split(':')[1];
      const memberId = memberIdFromInput(interaction.fields.getTextInputValue('member'));
      if (!memberId) return interaction.reply({ content: 'أرسل منشن العضو أو ID صحيح.', ephemeral: true });
      const member = await interaction.guild.members.fetch(memberId).catch(() => null);
      if (!member) return interaction.reply({ content: 'لم أجد هذا العضو في السيرفر.', ephemeral: true });
      await interaction.channel.permissionOverwrites.edit(member.id, action === 'add'
        ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }
        : { ViewChannel: false });
      return interaction.reply({ content: action === 'add' ? `تمت إضافة ${member} إلى التذكرة.` : `تمت إزالة ${member} من التذكرة.`, ephemeral: true });
    }
    if (interaction.isButton()) {
      if (['ticket_add_member', 'ticket_remove_member'].includes(interaction.customId)) {
        if (!isTicketStaff(interaction.member)) return interaction.reply({ content: 'هذا الزر للرتب المحددة فقط.', ephemeral: true });
        return interaction.showModal(memberModal(interaction.customId === 'ticket_add_member' ? 'add' : 'remove'));
      }
      if (interaction.customId === 'ticket_claim') {
        if (!isTicketStaff(interaction.member)) return interaction.reply({ content: 'الاستلام متاح للرتب المحددة فقط.', ephemeral: true });
        if (claimedStaffOf(interaction.channel)) return interaction.reply({ content: 'التذكرة مستلمة من إداري آخر.', ephemeral: true });
        const topic = interaction.channel.topic || '';
        const updatedTopic = topic.replace(/\s*\|\s*ticket-claimed-by:\d+/, '').replace(/\s*\|\s*ticket-points-awarded/, '');
        await interaction.channel.setTopic(`${updatedTopic} | ticket-claimed-by:${interaction.user.id}`);
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });
        await interaction.message.edit({ components: [ticketControls(true)] });
        await interaction.channel.send(`✅ تم استلام التذكرة بواسطة ${interaction.user}.`); return interaction.reply({ content: 'تم استلام التذكرة.', ephemeral: true });
      }
      if (interaction.customId === 'ticket_release') {
        if (!isTicketStaff(interaction.member)) return interaction.reply({ content: 'ترك التذكرة متاح للرتب المحددة فقط.', ephemeral: true });
        if (claimedStaffOf(interaction.channel) !== interaction.user.id) return interaction.reply({ content: 'فقط الإداري المستلم يستطيع ترك التذكرة.', ephemeral: true });
        const topic = interaction.channel.topic || '';
        await interaction.channel.setTopic(topic.replace(/\s*\|\s*ticket-claimed-by:\d+/, ''));
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
          ViewChannel: true,
          SendMessages: false,
          ReadMessageHistory: true
        });
        await interaction.message.edit({ components: [ticketControls(false)] });
        return interaction.reply({ content: 'تم ترك التذكرة، وأصبحت متاحة لإداري آخر.', ephemeral: true });
      }
      if (interaction.customId === 'ticket_close') return closeTicket(interaction);
      if (interaction.customId === 'ticket_delete') return closeTicket(interaction, true);
    }
  } catch (error) {
    console.error(error);
    const message = error.code === 50013
      ? 'لا أملك صلاحيات كافية في هذه القناة. امنحني View Channel وSend Messages وEmbed Links وUse Application Commands.'
      : 'حدث خطأ غير متوقع. راجع سجل البوت.';
    if (interaction.deferred) await interaction.editReply({ content: message }).catch(() => {});
    else if (!interaction.replied) await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
});

client.on(Events.MessageCreate, async message => {
  try {
    if (message.author.bot || !message.guild) return;
    const command = message.content.trim().replace(/[إأآ]/g, 'ا');
    if (command === '!كيزام') {
      await message.channel.send('<@1256322885669228556>');
      return;
    }
    if (command.toLowerCase() === 'mp') {
      if (!isTicketStaff(message.member)) return message.reply('هذا الأمر للرتب المحددة فقط.');
      const record = loadAdminPoints()[message.author.id] || { points: 0, tickets: 0 };
      const embed = new EmbedBuilder()
        .setColor(config.brandColor)
        .setAuthor({ name: `${message.member?.displayName || message.author.username} • نقاط الإدارة`, iconURL: message.author.displayAvatarURL({ size: 128 }) })
        .setTitle('🏅 رصيد النقاط الإدارية')
        .setDescription(`هذه إحصائياتك يا ${message.author}.`)
        .addFields(
          { name: '⭐ النقاط', value: `**${record.points}** نقطة`, inline: true },
          { name: '🎫 التذاكر المنجزة', value: `**${record.tickets}** تذكرة`, inline: true },
          { name: '📌 طريقة الاحتساب', value: '10 نقاط عند إغلاق أو حذف تذكرة استلمتها.', inline: false }
        )
        .setFooter({ text: config.brandName })
        .setTimestamp();
      await message.channel.send({ embeds: [embed] });
      return;
    }
    if (command === 'تفضل') {
      if (!ticketOf(message.channel) || !isTicketStaff(message.member)) return;
      await message.delete().catch(error => console.error('Greeting message delete error:', error));
      const staffId = claimedStaffOf(message.channel) || message.author.id;
      const firstEmoji = serverEmoji(message.guild, '2434darkbluecrown');
      const secondEmoji = serverEmoji(message.guild, '16577crownbrown');
      const thirdEmoji = serverEmoji(message.guild, 'Dancing');
      await message.channel.send(
        `${firstEmoji} تفضل معاك الإداري <@${staffId}> ${secondEmoji}\nكيف أقدر أساعدك اليوم؟ ${thirdEmoji}`
      );
      return;
    }
    if (command === 'نموذج') {
      if (!ticketOf(message.channel)) return message.reply('هذا الأمر يعمل داخل قناة تذكرة فقط.');
      if (!isTicketStaff(message.member)) return message.reply('هذا الأمر للرتب المحددة فقط.');
      return showSurvey(message);
    }
    if (!['اغلاق التكت', 'اغلاق التذكرة', 'اغلاق'].includes(command)) return;
    if (!ticketOf(message.channel)) return message.reply('هذا الأمر يعمل داخل قناة تذكرة فقط.');
    if (claimedStaffOf(message.channel) !== message.author.id) return message.reply('فقط الإداري الذي استلم التذكرة يستطيع إغلاقها.');
    if (markPointsAwarded(message.channel)) awardAdminPoints(message.author.id);
    await message.reply('جاري إغلاق التذكرة...');
    await message.channel.permissionOverwrites.edit(ticketOf(message.channel), { SendMessages: false }).catch(() => {});
    await message.channel.setName(`closed-${message.channel.name.replace(/^closed-/, '')}`).catch(() => {});
    await message.channel.send('🔒 تم إغلاق التذكرة بواسطة الإدارة.').catch(() => {});
  } catch (error) {
    console.error('Text command error:', error);
  }
});

client.on(Events.Error, error => console.error('Discord client error:', error));
client.on(Events.Warn, warning => console.warn('Discord warning:', warning));
process.on('unhandledRejection', error => console.error('Unhandled promise rejection:', error));

client.login(config.token);
