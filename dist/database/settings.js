import { db } from './db.js';
export const settingKeys = [
    'admin_role_id',
    'staff_role_id',
    'family_role_id',
    'rp_role_id',
    'verified_role_id',
    'unverified_role_id',
    'mentor_role_id',
    'cheat_hunter_role_id',
    'admin_panel_channel_id',
    'application_review_channel_id',
    'application_log_channel_id',
    'applications_open',
    'application_panel_banner_url',
    'application_panel_channel_id',
    'application_panel_message_id',
    'event_capt_channel_id',
    'event_capt_log_channel_id',
    'event_mcl_channel_id',
    'event_mcl_log_channel_id',
    'cheat_queue_channel_id',
    'cheat_log_channel_id',
    'profile_create_channel_id',
    'profile_log_channel_id',
    'default_voice_channel_id',
    'tier_1_role_id',
    'tier_2_role_id',
    'tier_3_role_id',
    'tier_1_category_id',
    'tier_2_category_id',
    'tier_3_category_id',
];
export function isSettingKey(value) {
    return settingKeys.includes(value);
}
export function getSetting(guildId, key) {
    const row = db
        .prepare('SELECT value FROM guild_settings WHERE guild_id = ? AND key = ?')
        .get(guildId, key);
    return row?.value ?? null;
}
export function setSetting(guildId, key, value, updatedBy) {
    db.prepare(`INSERT INTO guild_settings (guild_id, key, value, updated_by, updated_at)
     VALUES (?, ?, ?, ?, unixepoch())
     ON CONFLICT(guild_id, key) DO UPDATE SET
       value = excluded.value,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`).run(guildId, key, value, updatedBy);
}
export function listSettings(guildId) {
    const rows = db
        .prepare('SELECT key, value FROM guild_settings WHERE guild_id = ? ORDER BY key')
        .all(guildId);
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
export function deleteSetting(guildId, key) {
    const row = db
        .prepare('SELECT value FROM guild_settings WHERE guild_id = ? AND key = ?')
        .get(guildId, key);
    if (!row) {
        return { deleted: false, previousValue: null };
    }
    db.prepare('DELETE FROM guild_settings WHERE guild_id = ? AND key = ?').run(guildId, key);
    return { deleted: true, previousValue: row.value };
}
export function setRoleRule(guildId, scenario, checkRoleId, grantRoleId, updatedBy) {
    db.prepare(`INSERT INTO role_rules (guild_id, scenario, check_role_id, grant_role_id, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(guild_id, scenario) DO UPDATE SET
       check_role_id = excluded.check_role_id,
       grant_role_id = excluded.grant_role_id,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`).run(guildId, scenario, checkRoleId, grantRoleId, updatedBy);
}
export function getTierRoleId(guildId, tier) {
    return getSetting(guildId, `tier_${tier}_role_id`);
}
export function getTierCategoryId(guildId, tier) {
    return getSetting(guildId, `tier_${tier}_category_id`);
}
export function getEventPublishChannelKey(type) {
    return type === 'kapt' ? 'event_capt_channel_id' : 'event_mcl_channel_id';
}
export function getEventLogChannelKey(type) {
    return type === 'kapt' ? 'event_capt_log_channel_id' : 'event_mcl_log_channel_id';
}
export function getRoleRule(guildId, scenario) {
    const row = db
        .prepare('SELECT check_role_id, grant_role_id FROM role_rules WHERE guild_id = ? AND scenario = ?')
        .get(guildId, scenario);
    return {
        checkRoleId: row?.check_role_id ?? null,
        grantRoleId: row?.grant_role_id ?? null,
    };
}
