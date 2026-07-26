import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { Device as DeviceEntity, DeviceRepository } from "@stone/domain";
import type { StoneDatabase } from "./database";
import { enqueueOutbox } from "./sync";

export class SQLiteDeviceRepository implements DeviceRepository {
  public constructor(private readonly database: StoneDatabase) {}

  public async getOrCreate(input: Omit<DeviceEntity, "lastSeenAt">): Promise<DeviceEntity> {
    const now = new Date().toISOString();
    const existing = await this.database.getFirstAsync<DeviceEntity>(
      "SELECT id, owner_id as ownerId, platform, name, app_version as appVersion, last_seen_at as lastSeenAt FROM devices WHERE id = ?",
      input.id,
    );
    if (existing) {
      await this.touch(existing.id, now);
      return { ...existing, lastSeenAt: now };
    }
    const device: DeviceEntity = { ...input, lastSeenAt: now };
    await this.database.runAsync(
      "INSERT INTO devices (id, owner_id, platform, name, app_version, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      device.id,
      device.ownerId,
      device.platform,
      device.name,
      device.appVersion,
      device.lastSeenAt,
    );
    return device;
  }

  public async touch(id: string, lastSeenAt: string): Promise<void> {
    await this.database.withTransactionAsync(async () => {
      const current = await this.database.getFirstAsync<DeviceRow>(
        "SELECT * FROM devices WHERE id = ?",
        id,
      );
      if (!current) return;
      const revision = current.revision + 1;
      await this.database.runAsync(
        "UPDATE devices SET last_seen_at = ?, revision = ? WHERE id = ?",
        lastSeenAt,
        revision,
        id,
      );
      if (current.owner_id !== "pending-auth") {
        await enqueueDevice(
          this.database,
          { ...current, last_seen_at: lastSeenAt, revision },
          current.revision,
        );
      }
    });
  }

  public async bindOwner(id: string, ownerId: string): Promise<void> {
    await this.database.withTransactionAsync(async () => {
      const current = await this.database.getFirstAsync<DeviceRow>(
        "SELECT * FROM devices WHERE id = ?",
        id,
      );
      if (!current || current.owner_id === ownerId) return;
      const revision = 1;
      await this.database.runAsync(
        "UPDATE devices SET owner_id = ?, revision = ? WHERE id = ?",
        ownerId,
        revision,
        id,
      );
      await enqueueDevice(this.database, { ...current, owner_id: ownerId, revision }, 0);
    });
  }
}

interface DeviceRow {
  id: string;
  owner_id: string;
  platform: DeviceEntity["platform"];
  name: string;
  app_version: string;
  last_seen_at: string;
  revision: number;
}

async function enqueueDevice(
  database: StoneDatabase,
  row: DeviceRow,
  baseRevision: number,
): Promise<void> {
  await enqueueOutbox(database, {
    ownerId: row.owner_id,
    entityType: "device",
    entityId: row.id,
    operation: "upsert",
    baseRevision,
    revision: row.revision,
    payloadVersion: 1,
    payload: {
      id: row.id,
      ownerId: row.owner_id,
      platform: row.platform,
      name: row.name,
      appVersion: row.app_version,
      lastSeenAt: row.last_seen_at,
      revision: row.revision,
    },
    createdAt: row.last_seen_at,
    idempotencyKey: `${row.id}:device:${row.revision}`,
  });
}

const DEVICE_ID_KEY = "stone.device.id";

export async function createDeviceIdentity(): Promise<Omit<DeviceEntity, "lastSeenAt">> {
  const platform: DeviceEntity["platform"] = Platform.OS === "ios" ? "ios" : "android";
  const storedId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  const id = storedId ?? Crypto.randomUUID();
  if (!storedId) await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return {
    id,
    ownerId: "pending-auth",
    platform,
    name: Device.deviceName ?? `${platform} device`,
    appVersion: Constants.expoConfig?.version ?? "0.1.0",
  };
}
