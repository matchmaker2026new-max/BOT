require('dotenv').config();

const color = Number.parseInt(process.env.BRAND_COLOR || '5865F2', 16);
const imageUrl = value => /^https?:\/\//i.test(value || '') ? value : '';

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  brandName: process.env.BRAND_NAME || 'Zero System',
  brandColor: Number.isNaN(color) ? 0x5865f2 : color,
  panelBannerUrl: imageUrl(process.env.PANEL_BANNER_URL),
  ticketBannerUrl: imageUrl(process.env.TICKET_BANNER_URL || process.env.PANEL_BANNER_URL),
  ticketCategoryId: process.env.TICKET_CATEGORY_ID || null,
  staffRoleId: process.env.STAFF_ROLE_ID || null,
  ticketStaffRoleIds: ['1546284686530318388', '1546283624331092048', '1544497333511913573'],
  ticketMentionRoleIds: ['1546298019794780260', '1546298041193988208'],
  transcriptChannelId: process.env.TRANSCRIPT_CHANNEL_ID || null,
  ratingsChannelId: process.env.RATINGS_CHANNEL_ID || '1520221660098203749',
  ticketPrefix: 'ticket',
  types: {
    technical: { label: 'دعم فني', emoji: '🧑🏻‍💻', description: 'مشكلة تقنية أو مساعدة في الخدمة', color: 0x5865f2 },
    complaint: { label: 'شكوى', emoji: '⚖️', description: 'تقديم شكوى أو بلاغ', color: 0xf1c40f },
    refund: { label: 'ريفند', emoji: '🔄', description: 'طلب استرجاع أو تحديث عملية', color: 0x95a5a6 }
  }
};
