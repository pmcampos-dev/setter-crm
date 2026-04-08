import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), 'leads.db')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            scheduled_at TEXT,
            calendly_event_uri TEXT UNIQUE,
            status TEXT DEFAULT 'nuevo',
            country TEXT DEFAULT 'México',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL,
            duration INTEGER DEFAULT 0,
            status TEXT DEFAULT 'initiated',
            twilio_call_sid TEXT,
            recording_url TEXT,
            recording_duration INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (lead_id) REFERENCES leads(id)
        );

        CREATE TABLE IF NOT EXISTS sms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL,
            direction TEXT DEFAULT 'outbound',
            body TEXT NOT NULL,
            twilio_sid TEXT,
            status TEXT DEFAULT 'sent',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (lead_id) REFERENCES leads(id)
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (lead_id) REFERENCES leads(id)
        );
    """)
    conn.commit()
    conn.close()


# --- Leads ---

def create_lead(name, email, phone, scheduled_at, calendly_event_uri=None, country='México'):
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO leads (name, email, phone, scheduled_at, calendly_event_uri, country) VALUES (?, ?, ?, ?, ?, ?)",
            (name, email, phone, scheduled_at, calendly_event_uri, country)
        )
        conn.commit()
        return conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def get_leads(status=None):
    conn = get_db()
    if status and status != 'todos':
        rows = conn.execute(
            "SELECT * FROM leads ORDER BY scheduled_at DESC",
        ).fetchall()
        rows = [r for r in rows if r['status'] == status]
    else:
        rows = conn.execute("SELECT * FROM leads ORDER BY scheduled_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_lead(lead_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def find_lead_by_phone(phone):
    conn = get_db()
    # Try exact match first, then try matching last 10 digits
    row = conn.execute("SELECT * FROM leads WHERE phone = ?", (phone,)).fetchone()
    if not row:
        # Match by last 10 digits (handles +52 vs +521 formatting differences)
        digits = ''.join(c for c in phone if c.isdigit())[-10:]
        rows = conn.execute("SELECT * FROM leads").fetchall()
        for r in rows:
            lead_digits = ''.join(c for c in (r['phone'] or '') if c.isdigit())[-10:]
            if lead_digits == digits and digits:
                row = r
                break
    conn.close()
    return dict(row) if row else None


def update_lead_status(lead_id, status):
    conn = get_db()
    conn.execute("UPDATE leads SET status = ? WHERE id = ?", (status, lead_id))
    conn.commit()
    conn.close()


# --- Calls ---

def create_call(lead_id, twilio_call_sid=None):
    conn = get_db()
    conn.execute(
        "INSERT INTO calls (lead_id, twilio_call_sid) VALUES (?, ?)",
        (lead_id, twilio_call_sid)
    )
    conn.commit()
    call_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return call_id


def update_call(call_id, duration=None, status=None):
    conn = get_db()
    if duration is not None:
        conn.execute("UPDATE calls SET duration = ? WHERE id = ?", (duration, call_id))
    if status is not None:
        conn.execute("UPDATE calls SET status = ? WHERE id = ?", (status, call_id))
    conn.commit()
    conn.close()


def update_call_recording(call_sid, recording_url, recording_duration=None):
    conn = get_db()
    conn.execute(
        "UPDATE calls SET recording_url = ?, recording_duration = ? WHERE twilio_call_sid = ?",
        (recording_url, recording_duration, call_sid)
    )
    conn.commit()
    conn.close()


def get_calls_for_lead(lead_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM calls WHERE lead_id = ? ORDER BY created_at DESC", (lead_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- SMS ---

def create_sms(lead_id, body, direction='outbound', twilio_sid=None, status='sent'):
    conn = get_db()
    conn.execute(
        "INSERT INTO sms (lead_id, body, direction, twilio_sid, status) VALUES (?, ?, ?, ?, ?)",
        (lead_id, body, direction, twilio_sid, status)
    )
    conn.commit()
    sms_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return sms_id


def get_sms_for_lead(lead_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM sms WHERE lead_id = ? ORDER BY created_at DESC", (lead_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- Notes ---

def create_note(lead_id, text):
    conn = get_db()
    conn.execute("INSERT INTO notes (lead_id, text) VALUES (?, ?)", (lead_id, text))
    conn.commit()
    conn.close()


def get_notes_for_lead(lead_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at DESC", (lead_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
