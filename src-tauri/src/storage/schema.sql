PRAGMA foreign_keys=ON;
PRAGMA journal_mode=DELETE;
PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS books(
 id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT,source_hash TEXT NOT NULL UNIQUE,
 encoding TEXT NOT NULL,source_path TEXT NOT NULL,content_path TEXT NOT NULL,
 total_utf16 INTEGER NOT NULL,total_bytes INTEGER NOT NULL,imported_at TEXT NOT NULL,last_read_at TEXT,
 index_meta TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','deleting')));
CREATE TABLE IF NOT EXISTS chapters(
 book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,id TEXT NOT NULL,chapter_order INTEGER NOT NULL,
 title TEXT NOT NULL,volume_id TEXT,heading_start INTEGER NOT NULL,body_start INTEGER NOT NULL,body_end INTEGER NOT NULL,
 byte_start INTEGER NOT NULL,byte_end INTEGER NOT NULL,PRIMARY KEY(book_id,id),UNIQUE(book_id,chapter_order));
CREATE TABLE IF NOT EXISTS reading_positions(book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,offset INTEGER NOT NULL CHECK(offset>=0),updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookmarks(id TEXT PRIMARY KEY,book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,offset INTEGER NOT NULL CHECK(offset>=0),excerpt TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(book_id,offset));
CREATE TABLE IF NOT EXISTS preferences(id INTEGER PRIMARY KEY CHECK(id=1),value_json TEXT NOT NULL);
PRAGMA user_version=1;
