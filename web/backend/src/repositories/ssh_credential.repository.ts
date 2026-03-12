import pool from '../db/connection';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface SshCredential {
  uid: string;
  linux_user: string;
  linux_password: string;
  adb_port: number;
  adb_port_slot: number;  // 0 or 1; active port = adb_port + slot * 10000
  created_at: Date;
  updated_at: Date;
}

/** Returns the port the phone is currently using (or will use after a flip). */
export function activePort(cred: SshCredential): number {
  return cred.adb_port + cred.adb_port_slot * 10000;
}

const ADB_PORT_MIN = 10000;
const ADB_PORT_MAX = 19999;
const SHARED_USER  = 'cp_shared';

export class SshCredentialRepository {
  async findByUid(uid: string): Promise<SshCredential | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM ssh_credentials WHERE uid = ? LIMIT 1',
      [uid]
    );
    return (rows[0] as SshCredential) ?? null;
  }

  /**
   * Atomically insert a new credential, auto-assigning the next available port
   * via MAX(adb_port)+1 inside a single INSERT ... SELECT statement.
   * Uses INSERT IGNORE so concurrent calls for the same uid are safe.
   */
  async upsert(uid: string, linux_password: string): Promise<SshCredential> {
    await pool.query<ResultSetHeader>(`
      INSERT IGNORE INTO ssh_credentials (uid, linux_user, linux_password, adb_port)
      SELECT ?, ?, ?, COALESCE(MAX(adb_port), ? - 1) + 1
      FROM ssh_credentials
      HAVING COALESCE(MAX(adb_port), ? - 1) + 1 <= ?
    `, [uid, SHARED_USER, linux_password, ADB_PORT_MIN, ADB_PORT_MIN, ADB_PORT_MAX]);

    const cred = await this.findByUid(uid);
    if (!cred) throw new Error(`Port exhausted: all ports in [${ADB_PORT_MIN}, ${ADB_PORT_MAX}] are taken`);
    return cred;
  }

  /**
   * Flip adb_port_slot (0 → 1, 1 → 0) and return the updated credential.
   * The new activePort() will be on the opposite slot, guaranteed unused by the old sshd session.
   */
  async flipSlot(uid: string): Promise<SshCredential> {
    await pool.query<ResultSetHeader>(
      'UPDATE ssh_credentials SET adb_port_slot = 1 - adb_port_slot WHERE uid = ?',
      [uid],
    );
    const cred = await this.findByUid(uid);
    if (!cred) throw new Error(`No SSH credentials for uid=${uid}`);
    return cred;
  }
}
