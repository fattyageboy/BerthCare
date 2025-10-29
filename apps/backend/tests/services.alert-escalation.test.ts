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
    phone: string | null;
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

  it('sends reminder SMS to coordinator after 6 minutes with no answer', async () => {
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

  it('escalates to backup coordinator after 11 minutes and notifies caregiver', async () => {
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

    expect(smsMock.sendSMS).toHaveBeenCalledTimes(1);
    expect(smsMock.sendSMS).toHaveBeenCalledWith(
      '+15550004444',
      expect.stringContaining('Escalated alert'),
      caregiverId
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

  it('does not persist call SID when voice service omits it', async () => {
    const caregiverId = await insertUser({
      email: generateTestEmail('caregiver-missing-sid'),
      role: 'caregiver',
      phone: '+15550007777',
      firstName: 'Jamie',
      lastName: 'Fox',
    });

    const primaryCoordinatorUserId = await insertUser({
      email: generateTestEmail('primary-missing-sid'),
      role: 'coordinator',
      phone: '+15550008888',
      firstName: 'Taylor',
      lastName: 'Quinn',
    });

    const backupCoordinatorUserId = await insertUser({
      email: generateTestEmail('backup-missing-sid'),
      role: 'coordinator',
      phone: '+15550009999',
      firstName: 'Morgan',
      lastName: 'Reed',
    });

    const backupCoordinatorId = await insertCoordinator({
      userId: backupCoordinatorUserId,
      phone: '+15550009999',
    });

    await insertCoordinator({
      userId: primaryCoordinatorUserId,
      phone: '+15550008888',
      backupCoordinatorId,
    });

    const clientId = await insertClient({ firstName: 'Phil', lastName: 'Nash' });

    const alertId = await insertAlert({
      clientId,
      caregiverId,
      coordinatorUserId: primaryCoordinatorUserId,
      status: 'no_answer',
      initiatedAt: new Date(baseNow.getTime() - 11 * 60 * 1000),
    });

    voiceMock.initiateCall.mockResolvedValueOnce({
      callSid: '',
      status: 'queued',
      to: '+15550009999',
      from: '+15550000000',
      initiatedAt: baseNow,
    });

    smsMock.sendSMS.mockResolvedValueOnce({
      messageSid: 'SM-caregiver-notify',
      status: 'queued',
      to: '+15550007777',
      from: '+15550000000',
      sentAt: baseNow,
    });

    await service().run();

    expect(voiceMock.initiateCall).toHaveBeenCalledTimes(1);
    expect(smsMock.sendSMS).toHaveBeenCalledTimes(1);
    expect(smsMock.sendSMS).toHaveBeenCalledWith(
      '+15550007777',
      expect.stringContaining('Escalated alert for Phil Nash'),
      backupCoordinatorUserId
    );

    const alertResult = await pgPool.query(
      'SELECT status, escalated_at, coordinator_id, call_sid FROM care_alerts WHERE id = $1',
      [alertId]
    );

    expect(alertResult.rows[0].status).toBe('escalated');
    expect(alertResult.rows[0].escalated_at).not.toBeNull();
    expect(alertResult.rows[0].coordinator_id).toBe(backupCoordinatorUserId);
    expect(alertResult.rows[0].call_sid).toBeNull();
  });

  describe('Error Handling', () => {
    it('should handle SMS send failure gracefully', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-sms-fail'),
        role: 'caregiver',
        phone: '+15550001111',
        firstName: 'SMS',
        lastName: 'Fail',
      });

      const coordinatorUserId = await insertUser({
        email: generateTestEmail('coordinator-sms-fail'),
        role: 'coordinator',
        phone: '+15550002222',
        firstName: 'Coord',
        lastName: 'Test',
      });

      await insertCoordinator({
        userId: coordinatorUserId,
        phone: '+15550002222',
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'SMS' });

      const alertId = await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId,
        status: 'initiated',
        initiatedAt: new Date(baseNow.getTime() - 6 * 60 * 1000),
      });

      // Mock SMS to fail
      smsMock.sendSMS.mockRejectedValueOnce(new Error('SMS service unavailable'));

      await service().run();

      // Alert should still be updated to no_answer despite SMS failure
      const alertResult = await pgPool.query('SELECT status FROM care_alerts WHERE id = $1', [
        alertId,
      ]);
      expect(alertResult.rows[0].status).toBe('no_answer');
      expect(smsMock.sendSMS).toHaveBeenCalledTimes(1);
    });

    it('should handle voice call initiation failure gracefully', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-voice-fail'),
        role: 'caregiver',
        phone: '+15550003333',
        firstName: 'Voice',
        lastName: 'Fail',
      });

      const primaryCoordinatorUserId = await insertUser({
        email: generateTestEmail('primary-voice-fail'),
        role: 'coordinator',
        phone: '+15550004444',
        firstName: 'Primary',
        lastName: 'Coord',
      });

      const backupCoordinatorUserId = await insertUser({
        email: generateTestEmail('backup-voice-fail'),
        role: 'coordinator',
        phone: '+15550005555',
        firstName: 'Backup',
        lastName: 'Coord',
      });

      const backupCoordinatorId = await insertCoordinator({
        userId: backupCoordinatorUserId,
        phone: '+15550005555',
      });

      await insertCoordinator({
        userId: primaryCoordinatorUserId,
        phone: '+15550004444',
        backupCoordinatorId,
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'Voice' });

      const alertId = await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId: primaryCoordinatorUserId,
        status: 'no_answer',
        initiatedAt: new Date(baseNow.getTime() - 11 * 60 * 1000),
      });

      // Mock voice call to fail
      voiceMock.initiateCall.mockRejectedValueOnce(new Error('Voice service unavailable'));

      await service().run();

      // Alert should not be escalated if voice call fails
      const alertResult = await pgPool.query(
        'SELECT status, escalated_at FROM care_alerts WHERE id = $1',
        [alertId]
      );
      expect(alertResult.rows[0].status).toBe('no_answer');
      expect(alertResult.rows[0].escalated_at).toBeNull();
      expect(voiceMock.initiateCall).toHaveBeenCalledTimes(1);
      expect(smsMock.sendSMS).not.toHaveBeenCalled();
    });

    it('should skip escalation when backup coordinator has no phone', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-no-backup-phone'),
        role: 'caregiver',
        phone: '+15550006666',
        firstName: 'Care',
        lastName: 'Giver',
      });

      const primaryCoordinatorUserId = await insertUser({
        email: generateTestEmail('primary-no-backup-phone'),
        role: 'coordinator',
        phone: '+15550007777',
        firstName: 'Primary',
        lastName: 'Coord',
      });

      const backupCoordinatorUserId = await insertUser({
        email: generateTestEmail('backup-no-phone'),
        role: 'coordinator',
        phone: null,
        firstName: 'Backup',
        lastName: 'NoPhone',
      });

      const backupCoordinatorId = await insertCoordinator({
        userId: backupCoordinatorUserId,
        phone: null,
      });

      await insertCoordinator({
        userId: primaryCoordinatorUserId,
        phone: '+15550007777',
        backupCoordinatorId,
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'NoBackup' });

      const alertId = await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId: primaryCoordinatorUserId,
        status: 'no_answer',
        initiatedAt: new Date(baseNow.getTime() - 11 * 60 * 1000),
      });

      await service().run();

      // Alert should remain in no_answer status
      const alertResult = await pgPool.query(
        'SELECT status, escalated_at FROM care_alerts WHERE id = $1',
        [alertId]
      );
      expect(alertResult.rows[0].status).toBe('no_answer');
      expect(alertResult.rows[0].escalated_at).toBeNull();
      expect(voiceMock.initiateCall).not.toHaveBeenCalled();
      expect(smsMock.sendSMS).not.toHaveBeenCalled();
    });

    it('should skip escalation when no backup coordinator configured', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-no-backup'),
        role: 'caregiver',
        phone: '+15550008888',
        firstName: 'Care',
        lastName: 'Giver',
      });

      const coordinatorUserId = await insertUser({
        email: generateTestEmail('coordinator-no-backup'),
        role: 'coordinator',
        phone: '+15550009999',
        firstName: 'Coord',
        lastName: 'NoBackup',
      });

      // Create coordinator without backup
      await insertCoordinator({
        userId: coordinatorUserId,
        phone: '+15550009999',
        backupCoordinatorId: null,
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'NoBackup' });

      const alertId = await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId,
        status: 'no_answer',
        initiatedAt: new Date(baseNow.getTime() - 11 * 60 * 1000),
      });

      await service().run();

      // Alert should remain in no_answer status
      const alertResult = await pgPool.query(
        'SELECT status, escalated_at FROM care_alerts WHERE id = $1',
        [alertId]
      );
      expect(alertResult.rows[0].status).toBe('no_answer');
      expect(alertResult.rows[0].escalated_at).toBeNull();
      expect(voiceMock.initiateCall).not.toHaveBeenCalled();
    });
  });

  describe('Boundary Conditions', () => {
    it('should not send reminder at exactly 5 minutes (boundary)', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-5min'),
        role: 'caregiver',
        phone: '+15550010000',
        firstName: 'Five',
        lastName: 'Min',
      });

      const coordinatorUserId = await insertUser({
        email: generateTestEmail('coordinator-5min'),
        role: 'coordinator',
        phone: '+15550011111',
        firstName: 'Coord',
        lastName: 'Five',
      });

      await insertCoordinator({
        userId: coordinatorUserId,
        phone: '+15550011111',
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'Five' });

      await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId,
        status: 'initiated',
        initiatedAt: new Date(baseNow.getTime() - 5 * 60 * 1000), // Exactly 5 minutes
      });

      await service().run();

      // Should send reminder (threshold is <=)
      expect(smsMock.sendSMS).toHaveBeenCalledTimes(1);
    });

    it('should send reminder just after 5 minutes', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-6min'),
        role: 'caregiver',
        phone: '+15550012222',
        firstName: 'Six',
        lastName: 'Min',
      });

      const coordinatorUserId = await insertUser({
        email: generateTestEmail('coordinator-6min'),
        role: 'coordinator',
        phone: '+15550013333',
        firstName: 'Coord',
        lastName: 'Six',
      });

      await insertCoordinator({
        userId: coordinatorUserId,
        phone: '+15550013333',
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'Six' });

      await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId,
        status: 'initiated',
        initiatedAt: new Date(baseNow.getTime() - 6 * 60 * 1000),
      });

      await service().run();

      expect(smsMock.sendSMS).toHaveBeenCalledTimes(1);
    });

    it('should not escalate at exactly 10 minutes (boundary)', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-10min'),
        role: 'caregiver',
        phone: '+15550014444',
        firstName: 'Ten',
        lastName: 'Min',
      });

      const primaryCoordinatorUserId = await insertUser({
        email: generateTestEmail('primary-10min'),
        role: 'coordinator',
        phone: '+15550015555',
        firstName: 'Primary',
        lastName: 'Ten',
      });

      const backupCoordinatorUserId = await insertUser({
        email: generateTestEmail('backup-10min'),
        role: 'coordinator',
        phone: '+15550016666',
        firstName: 'Backup',
        lastName: 'Ten',
      });

      const backupCoordinatorId = await insertCoordinator({
        userId: backupCoordinatorUserId,
        phone: '+15550016666',
      });

      await insertCoordinator({
        userId: primaryCoordinatorUserId,
        phone: '+15550015555',
        backupCoordinatorId,
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'Ten' });

      await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId: primaryCoordinatorUserId,
        status: 'no_answer',
        initiatedAt: new Date(baseNow.getTime() - 10 * 60 * 1000), // Exactly 10 minutes
      });

      await service().run();

      // Should escalate (threshold is <=)
      expect(voiceMock.initiateCall).toHaveBeenCalledTimes(1);
    });

    it('should escalate just after 10 minutes', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-11min'),
        role: 'caregiver',
        phone: '+15550017777',
        firstName: 'Eleven',
        lastName: 'Min',
      });

      const primaryCoordinatorUserId = await insertUser({
        email: generateTestEmail('primary-11min'),
        role: 'coordinator',
        phone: '+15550018888',
        firstName: 'Primary',
        lastName: 'Eleven',
      });

      const backupCoordinatorUserId = await insertUser({
        email: generateTestEmail('backup-11min'),
        role: 'coordinator',
        phone: '+15550019999',
        firstName: 'Backup',
        lastName: 'Eleven',
      });

      const backupCoordinatorId = await insertCoordinator({
        userId: backupCoordinatorUserId,
        phone: '+15550019999',
      });

      await insertCoordinator({
        userId: primaryCoordinatorUserId,
        phone: '+15550018888',
        backupCoordinatorId,
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'Eleven' });

      await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId: primaryCoordinatorUserId,
        status: 'no_answer',
        initiatedAt: new Date(baseNow.getTime() - 11 * 60 * 1000),
      });

      await service().run();

      expect(voiceMock.initiateCall).toHaveBeenCalledTimes(1);
    });
  });

  describe('Invalid Phone Numbers', () => {
    it('should skip reminder when coordinator has no phone', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-no-coord-phone'),
        role: 'caregiver',
        phone: '+15550020000',
        firstName: 'Care',
        lastName: 'Giver',
      });

      const coordinatorUserId = await insertUser({
        email: generateTestEmail('coordinator-no-phone'),
        role: 'coordinator',
        phone: null,
        firstName: 'Coord',
        lastName: 'NoPhone',
      });

      await insertCoordinator({
        userId: coordinatorUserId,
        phone: null,
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'NoPhone' });

      await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId,
        status: 'initiated',
        initiatedAt: new Date(baseNow.getTime() - 6 * 60 * 1000),
      });

      await service().run();

      // Should not send SMS
      expect(smsMock.sendSMS).not.toHaveBeenCalled();

      // Alert should remain in initiated status
      const alertResult = await pgPool.query(
        'SELECT status FROM care_alerts WHERE coordinator_id = $1',
        [coordinatorUserId]
      );
      expect(alertResult.rows[0].status).toBe('initiated');
    });

    it('should skip caregiver notification when caregiver has no phone', async () => {
      const caregiverId = await insertUser({
        email: generateTestEmail('caregiver-no-phone-escalate'),
        role: 'caregiver',
        phone: null,
        firstName: 'Care',
        lastName: 'NoPhone',
      });

      const primaryCoordinatorUserId = await insertUser({
        email: generateTestEmail('primary-caregiver-no-phone'),
        role: 'coordinator',
        phone: '+15550021111',
        firstName: 'Primary',
        lastName: 'Coord',
      });

      const backupCoordinatorUserId = await insertUser({
        email: generateTestEmail('backup-caregiver-no-phone'),
        role: 'coordinator',
        phone: '+15550022222',
        firstName: 'Backup',
        lastName: 'Coord',
      });

      const backupCoordinatorId = await insertCoordinator({
        userId: backupCoordinatorUserId,
        phone: '+15550022222',
      });

      await insertCoordinator({
        userId: primaryCoordinatorUserId,
        phone: '+15550021111',
        backupCoordinatorId,
      });

      const clientId = await insertClient({ firstName: 'Client', lastName: 'NoCaregiver' });

      await insertAlert({
        clientId,
        caregiverId,
        coordinatorUserId: primaryCoordinatorUserId,
        status: 'no_answer',
        initiatedAt: new Date(baseNow.getTime() - 11 * 60 * 1000),
      });

      await service().run();

      // Voice call should be made
      expect(voiceMock.initiateCall).toHaveBeenCalledTimes(1);

      // SMS should not be sent to caregiver
      expect(smsMock.sendSMS).not.toHaveBeenCalled();
    });
  });
});
