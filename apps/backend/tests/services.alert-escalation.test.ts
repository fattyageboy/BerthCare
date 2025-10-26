import * as crypto from 'crypto';

import { Pool } from 'pg';
import { createClient } from 'redis';

import { AlertEscalationService } from '../src/services/alert-escalation.service';

import {
  cleanAllTestData,
  generateTestEmail,
  setupTestConnections,
  teardownTestConnections,
} from './test-helpers';

describe('AlertEscalationService (integration)', () => {
  let pgPool: Pool;
  let redisClient: ReturnType<typeof createClient>;
  const zoneId = '550e8400-e29b-41d4-a716-446655440001';

  const smsMock = {
    sendSMS: jest.fn(),
  };

  const voiceMock = {
    initiateCall: jest.fn(),
  };

  const baseNow = new Date('2025-01-01T12:00:00.000Z');

  const service = () =>
    new AlertEscalationService(pgPool, {
      smsService: smsMock,
      voiceService: voiceMock,
      now: () => baseNow,
    });

  beforeAll(async () => {
    process.env.TWILIO_ACCOUNT_SID = 'test_account_sid';
    process.env.TWILIO_AUTH_TOKEN = 'test_auth_token';
    process.env.TWILIO_PHONE_NUMBER = '+15550000000';
    process.env.TWILIO_WEBHOOK_BASE_URL = 'http://localhost:3000';

    try {
      const connections = await setupTestConnections();
      pgPool = connections.pgPool;
      redisClient = connections.redisClient;
    } catch (error) {
      // Surface connection issues clearly before tests proceed.
      // eslint-disable-next-line no-console
      console.error('Failed to set up test connections', error);
      throw error;
    }
  });

  beforeEach(async () => {
    smsMock.sendSMS.mockReset();
    smsMock.sendSMS.mockResolvedValue({
      messageSid: 'SM123',
      status: 'queued',
      to: '',
      from: '',
      body: '',
      sentAt: baseNow,
    });

    voiceMock.initiateCall.mockReset();
    voiceMock.initiateCall.mockResolvedValue({
      callSid: 'CA456',
      status: 'queued',
      to: '',
      from: '',
      initiatedAt: baseNow,
    });

    await cleanAllTestData(pgPool, redisClient);
  });

  afterAll(async () => {
    await cleanAllTestData(pgPool, redisClient);
    await teardownTestConnections(pgPool, redisClient);
  });

  async function insertUser({
    id = crypto.randomUUID(),
    email,
    role,
    zone = zoneId,
    phone,
    firstName,
    lastName,
  }: {
    id?: string;
    email: string;
    role: 'caregiver' | 'coordinator' | 'admin';
    zone?: string | null;
    phone?: string | null;
    firstName?: string;
    lastName?: string;
  }): Promise<string> {
    await pgPool.query(
      `
        INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, phone_number, created_at, updated_at)
        VALUES ($1, $2, 'hashed-password', $3, $4, $5, $6, $7, NOW(), NOW())
      `,
      [
        id,
        email,
        firstName ?? 'Test',
        lastName ?? role.charAt(0).toUpperCase() + role.slice(1),
        role,
        zone,
        phone ?? null,
      ]
    );
    return id;
  }

  async function insertCoordinator({
    userId,
    phone,
    backupCoordinatorId,
    id = crypto.randomUUID(),
  }: {
    userId: string;
    phone: string;
    backupCoordinatorId?: string | null;
    id?: string;
  }): Promise<string> {
    await pgPool.query(
      `
        INSERT INTO coordinators (id, user_id, zone_id, phone_number, backup_coordinator_id, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
      `,
      [id, userId, zoneId, phone, backupCoordinatorId ?? null]
    );
    return id;
  }

  async function insertClient({
    id = crypto.randomUUID(),
    firstName = 'Client',
    lastName = 'Example',
  } = {}): Promise<string> {
    await pgPool.query(
      `
        INSERT INTO clients (
          id, first_name, last_name, date_of_birth, address,
          latitude, longitude, zone_id,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
          created_at, updated_at
        ) VALUES ($1, $2, $3, '1950-01-01', '123 Street', 45.0, -73.0, $4, 'Contact', '+15550001111', 'Family', NOW(), NOW())
      `,
      [id, firstName, lastName, zoneId]
    );
    return id;
  }

  async function insertAlert({
    id = crypto.randomUUID(),
    clientId,
    caregiverId,
    coordinatorUserId,
    status = 'initiated',
    initiatedAt,
    voiceMessageUrl = 'https://example.com/message.mp3',
  }: {
    id?: string;
    clientId: string;
    caregiverId: string;
    coordinatorUserId: string;
    status?: string;
    initiatedAt: Date;
    voiceMessageUrl?: string;
  }): Promise<string> {
    await pgPool.query(
      `
        INSERT INTO care_alerts (
          id, client_id, staff_id, coordinator_id, alert_type,
          voice_message_url, status, initiated_at,
          created_at, updated_at, call_sid
        ) VALUES ($1, $2, $3, $4, 'medical_concern', $5, $6, $7, NOW(), NOW(), 'CA-original')
      `,
      [id, clientId, caregiverId, coordinatorUserId, voiceMessageUrl, status, initiatedAt]
    );
    return id;
  }

  it('sends reminder SMS to coordinator after 5 minutes with no answer', async () => {
    const caregiverId = await insertUser({
      email: generateTestEmail('caregiver'),
      role: 'caregiver',
      phone: '+15550002222',
      firstName: 'Care',
      lastName: 'Giver',
    });

    const coordinatorUserId = await insertUser({
      email: generateTestEmail('coordinator'),
      role: 'coordinator',
      phone: '+15550003333',
      firstName: 'Primary',
      lastName: 'Coordinator',
    });

    await insertCoordinator({
      userId: coordinatorUserId,
      phone: '+15550003333',
    });

    const clientId = await insertClient({ firstName: 'Margaret', lastName: 'Lane' });

    const alertId = await insertAlert({
      clientId,
      caregiverId,
      coordinatorUserId,
      initiatedAt: new Date(baseNow.getTime() - 6 * 60 * 1000),
    });

    await service().run();

    expect(smsMock.sendSMS).toHaveBeenCalledTimes(1);
    expect(smsMock.sendSMS).toHaveBeenCalledWith(
      '+15550003333',
      expect.stringContaining('URGENT alert'),
      coordinatorUserId
    );
    expect(voiceMock.initiateCall).not.toHaveBeenCalled();

    const alertResult = await pgPool.query(
      'SELECT status, escalated_at FROM care_alerts WHERE id = $1',
      [alertId]
    );

    expect(alertResult.rows[0].status).toBe('no_answer');
    expect(alertResult.rows[0].escalated_at).toBeNull();
  });

  it('escalates to backup coordinator after 10 minutes and notifies caregiver', async () => {
    const caregiverId = await insertUser({
      email: generateTestEmail('caregiver2'),
      role: 'caregiver',
      phone: '+15550004444',
      firstName: 'Sarah',
      lastName: 'Lee',
    });

    const primaryCoordinatorUserId = await insertUser({
      email: generateTestEmail('primary'),
      role: 'coordinator',
      phone: '+15550005555',
      firstName: 'Mike',
      lastName: 'Stone',
    });

    const backupCoordinatorUserId = await insertUser({
      email: generateTestEmail('backup'),
      role: 'coordinator',
      phone: '+15550006666',
      firstName: 'Alex',
      lastName: 'Jordan',
    });

    const backupCoordinatorId = await insertCoordinator({
      userId: backupCoordinatorUserId,
      phone: '+15550006666',
    });

    await insertCoordinator({
      userId: primaryCoordinatorUserId,
      phone: '+15550005555',
      backupCoordinatorId,
    });

    const clientId = await insertClient({ firstName: 'Dorothy', lastName: 'Miles' });

    const alertId = await insertAlert({
      clientId,
      caregiverId,
      coordinatorUserId: primaryCoordinatorUserId,
      status: 'no_answer',
      initiatedAt: new Date(baseNow.getTime() - 11 * 60 * 1000),
    });

    voiceMock.initiateCall.mockResolvedValue({
      callSid: 'CA-backup',
      status: 'queued',
      to: '+15550006666',
      from: '+15550000000',
      initiatedAt: baseNow,
    });

    await service().run();

    expect(voiceMock.initiateCall).toHaveBeenCalledTimes(1);
    expect(voiceMock.initiateCall).toHaveBeenCalledWith(
      '+15550006666',
      'https://example.com/message.mp3',
      { alertId }
    );

    expect(smsMock.sendSMS).toHaveBeenCalledWith(
      '+15550004444',
      expect.stringContaining('Escalated alert'),
      backupCoordinatorUserId
    );

    const alertResult = await pgPool.query(
      'SELECT status, escalated_at, coordinator_id, call_sid FROM care_alerts WHERE id = $1',
      [alertId]
    );

    expect(alertResult.rows[0].status).toBe('escalated');
    expect(alertResult.rows[0].escalated_at).not.toBeNull();
    expect(alertResult.rows[0].coordinator_id).toBe(backupCoordinatorUserId);
    expect(alertResult.rows[0].call_sid).toBe('CA-backup');
  });
});
