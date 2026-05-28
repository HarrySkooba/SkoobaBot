import { db } from './db.js';
const migrations = [
    `CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_by TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (guild_id, key)
  )`,
    `CREATE TABLE IF NOT EXISTS role_rules (
    guild_id TEXT NOT NULL,
    scenario TEXT NOT NULL,
    check_role_id TEXT,
    grant_role_id TEXT,
    updated_by TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (guild_id, scenario)
  )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    type TEXT NOT NULL,
    actor_id TEXT,
    target_id TEXT,
    details TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
    `CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    answers_json TEXT NOT NULL,
    reviewer_id TEXT,
    review_message_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
    `CREATE TABLE IF NOT EXISTS call_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    scheduled_by TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
  )`,
    `CREATE TABLE IF NOT EXISTS cheat_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    hunter_id TEXT,
    queue_message_id TEXT,
    called_at INTEGER,
    resolved_at INTEGER,
    result TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
    `CREATE TABLE IF NOT EXISTS player_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    tier INTEGER NOT NULL DEFAULT 3,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (guild_id, user_id)
  )`,
    `CREATE TABLE IF NOT EXISTS profile_tier_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    mentor_id TEXT NOT NULL,
    old_tier INTEGER NOT NULL,
    new_tier INTEGER NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (profile_id) REFERENCES player_profiles(id) ON DELETE CASCADE
  )`,
    `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    type TEXT NOT NULL,
    start_time TEXT NOT NULL,
    voice_time TEXT NOT NULL,
    side TEXT NOT NULL,
    map TEXT NOT NULL,
    voice_channel_id TEXT,
    message_channel_id TEXT,
    message_id TEXT,
    created_by TEXT NOT NULL,
    reminders_sent TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
    `CREATE TABLE IF NOT EXISTS event_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    list_type TEXT NOT NULL,
    tier INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (event_id, user_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  )`,
    `CREATE TABLE IF NOT EXISTS event_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    list_type TEXT NOT NULL,
    was_present INTEGER NOT NULL,
    checked_by TEXT NOT NULL,
    checked_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  )`,
];
for (const migration of migrations) {
    db.prepare(migration).run();
}
const alterMigrations = [
    'ALTER TABLE events ADD COLUMN list_closed INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE events ADD COLUMN mcl_subtype TEXT',
    'ALTER TABLE events ADD COLUMN teleport_time TEXT',
    'ALTER TABLE events ADD COLUMN player_count TEXT',
    'ALTER TABLE events ADD COLUMN image_url TEXT',
];
for (const migration of alterMigrations) {
    try {
        db.prepare(migration).run();
    }
    catch {
        // column already exists
    }
}
console.log('Database migrations completed.');
