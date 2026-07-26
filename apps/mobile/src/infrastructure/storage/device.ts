import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { Device as DeviceEntity, DeviceRepository } from "@stone/domain";
import type { StoneDatabase } from "./database";

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
    await this.database.runAsync(
      "UPDATE devices SET last_seen_at = ? WHERE id = ?",
      lastSeenAt,
      id,
    );
  }

  public async bindOwner(id: string, ownerId: string): Promise<void> {
    await this.database.runAsync("UPDATE devices SET owner_id = ? WHERE id = ?", ownerId, id);
  }
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
