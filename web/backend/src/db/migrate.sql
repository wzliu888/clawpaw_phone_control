CREATE TABLE IF NOT EXISTS users (
  uid          CHAR(36)        NOT NULL COMMENT 'UUID',
  login_type   VARCHAR(32)     NOT NULL COMMENT 'e.g. google',
  login_id     VARCHAR(255)    NOT NULL COMMENT 'provider user id',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uq_login (login_type, login_id)
);

CREATE TABLE IF NOT EXISTS clawpaw_secrets (
  uid        CHAR(36)     NOT NULL COMMENT 'references users.uid',
  secret     VARCHAR(64)  NOT NULL COMMENT 'clawpaw secret token',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid)
);

-- SSH reverse tunnel credentials.
-- All users share the Linux user 'cp_shared' on the tunnel node.
-- Each user gets a unique adb_port in [10000, 19999] for their reverse tunnel.
-- adb_port_slot (0 or 1) selects the active port: slot 0 → adb_port, slot 1 → adb_port + 10000.
-- On each reconnect the slot is flipped so the new tunnel binds a fresh port while the old sshd
-- session still holds the previous one (avoids "remote port forwarding failed" races).
-- password is used by the Android app to authenticate to the SSH server.
CREATE TABLE IF NOT EXISTS ssh_credentials (
  uid            CHAR(36)     NOT NULL COMMENT 'references users.uid',
  linux_user     VARCHAR(32)  NOT NULL DEFAULT 'cp_shared',
  linux_password VARCHAR(64)  NOT NULL COMMENT 'SSH password for cp_shared (shared secret)',
  adb_port       INT          NOT NULL COMMENT 'base port in [10000, 19999]',
  adb_port_slot  TINYINT      NOT NULL DEFAULT 0 COMMENT '0 or 1; active port = adb_port + slot * 10000',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (uid),
  UNIQUE KEY uq_adb_port (adb_port)
);

-- Migration: add adb_port_slot to existing tables (compatible with MySQL < 8.0.3)
-- Safe to run multiple times: INSERT IGNORE pattern via stored procedure
DROP PROCEDURE IF EXISTS _migrate_add_adb_port_slot;
DELIMITER $$
CREATE PROCEDURE _migrate_add_adb_port_slot()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ssh_credentials'
      AND COLUMN_NAME  = 'adb_port_slot'
  ) THEN
    ALTER TABLE ssh_credentials
      ADD COLUMN adb_port_slot TINYINT NOT NULL DEFAULT 0
        COMMENT '0 or 1; active port = adb_port + slot * 10000'
      AFTER adb_port;
  END IF;
END$$
DELIMITER ;
CALL _migrate_add_adb_port_slot();
DROP PROCEDURE IF EXISTS _migrate_add_adb_port_slot;
