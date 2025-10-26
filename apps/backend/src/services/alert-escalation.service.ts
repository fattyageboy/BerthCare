import { Pool } from 'pg';

import { logDebug, logError, logInfo } from '../config/logger';

import { SMSResult, TwilioSMSService } from './twilio-sms.service';
import { CallResult, InitiateCallOptions, TwilioVoiceService } from './twilio-voice.service';

type SmsServiceLike = {
  sendSMS: (to: string, message: string, userId?: string) => Promise<SMSResult>;
};

type VoiceServiceLike = {
  initiateCall: (
    to: string,
    voiceMessageUrl: string,
    options?: InitiateCallOptions
  ) => Promise<CallResult>;
};

interface AlertEscalationDependencies {
  smsService?: SmsServiceLike;
  voiceService?: VoiceServiceLike;
  now?: () => Date;
}

interface CoordinatorReminderRow {
  id: string;
  coordinator_user_id: string;
  coordinator_phone: string | null;
  coordinator_first_name: string | null;
  coordinator_last_name: string | null;
  client_first_name: string;
  client_last_name: string;
  caregiver_first_name: string | null;
  caregiver_last_name: string | null;
  caregiver_phone: string | null;
  voice_message_url: string | null;
  alert_type: string;
}

interface BackupEscalationRow extends CoordinatorReminderRow {
  backup_coordinator_user_id: string | null;
  backup_coordinator_phone: string | null;
  backup_coordinator_first_name: string | null;
  backup_coordinator_last_name: string | null;
}

/**
 * Alert Escalation Service
 *
 * Runs every minute to:
 * 1. Remind coordinators via SMS when alerts remain unanswered for 5 minutes
 * 2. Escalate to backup coordinators after 10 minutes (voice call + caregiver SMS)
 */
export class AlertEscalationService {
  private readonly smsService?: SmsServiceLike;
  private readonly voiceService?: VoiceServiceLike;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly pgPool: Pool,
    dependencies: AlertEscalationDependencies = {}
  ) {
    this.smsService = dependencies.smsService;
    this.voiceService = dependencies.voiceService;
    this.now = dependencies.now ?? (() => new Date());
  }

  /**
   * Start cron interval (runs every minute)
   */
  start(): void {
    if (this.timer) {
      return;
    }

    logInfo('Starting alert escalation service');
    // Run immediately to catch up quickly
    void this.run();

    this.timer = setInterval(() => {
      void this.run();
    }, 60_000);
  }

  /**
   * Stop cron interval
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logInfo('Alert escalation service stopped');
    }
  }

  /**
   * Execute escalation workflow
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      logDebug('Alert escalation service skipping run (already in progress)');
      return;
    }

    this.isRunning = true;

    try {
      await this.processCoordinatorReminders();
      await this.processBackupEscalations();
    } catch (error) {
      logError(
        'Unexpected error during alert escalation run',
        error instanceof Error ? error : undefined
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async processCoordinatorReminders(): Promise<void> {
    const reminderThreshold = new Date(this.now().getTime() - 5 * 60 * 1000);

    const query = `
      SELECT
        ca.id,
        ca.alert_type,
        ca.voice_message_url,
        coord.user_id AS coordinator_user_id,
        coord.phone_number AS coordinator_phone,
        coord_user.first_name AS coordinator_first_name,
        coord_user.last_name AS coordinator_last_name,
        client.first_name AS client_first_name,
        client.last_name AS client_last_name,
        caregiver.first_name AS caregiver_first_name,
        caregiver.last_name AS caregiver_last_name,
        caregiver.phone_number AS caregiver_phone
      FROM care_alerts ca
      JOIN coordinators coord ON coord.user_id = ca.coordinator_id
      JOIN users coord_user ON coord_user.id = coord.user_id
      JOIN clients client ON client.id = ca.client_id
      JOIN users caregiver ON caregiver.id = ca.staff_id
      WHERE ca.status = 'initiated'
        AND ca.answered_at IS NULL
        AND ca.deleted_at IS NULL
        AND ca.initiated_at <= $1
    `;

    const client = await this.pgPool.connect();

    try {
      const { rows } = await client.query<CoordinatorReminderRow>(query, [reminderThreshold]);

      if (!rows.length) {
        return;
      }

      logInfo('Processing coordinator reminder SMS queue', {
        count: rows.length,
      });

      for (const alert of rows) {
        if (!alert.coordinator_phone) {
          logError('Cannot send coordinator reminder SMS: missing phone number', undefined, {
            alertId: alert.id,
            coordinatorId: alert.coordinator_user_id,
          });
          continue;
        }

        try {
          const message = this.buildCoordinatorReminderMessage(alert);
          await this.getSmsService().sendSMS(
            alert.coordinator_phone,
            message,
            alert.coordinator_user_id
          );

          const updateResult = await this.pgPool.query(
            `
              UPDATE care_alerts
              SET status = 'no_answer',
                  updated_at = NOW()
              WHERE id = $1
                AND status = 'initiated'
              RETURNING id
            `,
            [alert.id]
          );

          if (updateResult.rowCount === 0) {
            logDebug('Coordinator reminder skipped due to status change', {
              alertId: alert.id,
            });
            continue;
          }

          logInfo('Coordinator reminder SMS sent', {
            alertId: alert.id,
            coordinatorId: alert.coordinator_user_id,
          });
        } catch (error) {
          logError(
            'Failed to send coordinator reminder SMS',
            error instanceof Error ? error : undefined,
            {
              alertId: alert.id,
              coordinatorId: alert.coordinator_user_id,
            }
          );
        }
      }
    } finally {
      client.release();
    }
  }

  private async processBackupEscalations(): Promise<void> {
    const escalationThreshold = new Date(this.now().getTime() - 10 * 60 * 1000);

    const query = `
      SELECT
        ca.id,
        ca.alert_type,
        ca.voice_message_url,
        coord.user_id AS coordinator_user_id,
        coord.phone_number AS coordinator_phone,
        coord_user.first_name AS coordinator_first_name,
        coord_user.last_name AS coordinator_last_name,
        backup.user_id AS backup_coordinator_user_id,
        backup.phone_number AS backup_coordinator_phone,
        backup_user.first_name AS backup_coordinator_first_name,
        backup_user.last_name AS backup_coordinator_last_name,
        client.first_name AS client_first_name,
        client.last_name AS client_last_name,
        caregiver.first_name AS caregiver_first_name,
        caregiver.last_name AS caregiver_last_name,
        caregiver.phone_number AS caregiver_phone
      FROM care_alerts ca
      JOIN coordinators coord ON coord.user_id = ca.coordinator_id
      JOIN users coord_user ON coord_user.id = coord.user_id
      JOIN clients client ON client.id = ca.client_id
      JOIN users caregiver ON caregiver.id = ca.staff_id
      LEFT JOIN coordinators backup ON backup.id = coord.backup_coordinator_id
      LEFT JOIN users backup_user ON backup_user.id = backup.user_id
      WHERE ca.deleted_at IS NULL
        AND ca.answered_at IS NULL
        AND ca.escalated_at IS NULL
        AND ca.initiated_at <= $1
        AND (
          ca.status = 'no_answer'
          OR (ca.status = 'initiated' AND ca.initiated_at <= $1)
        )
    `;

    const client = await this.pgPool.connect();

    try {
      const { rows } = await client.query<BackupEscalationRow>(query, [escalationThreshold]);

      if (!rows.length) {
        return;
      }

      logInfo('Processing backup coordinator escalations', {
        count: rows.length,
      });

      for (const alert of rows) {
        if (!alert.backup_coordinator_user_id || !alert.backup_coordinator_phone) {
          logError('Cannot escalate alert: backup coordinator not configured', undefined, {
            alertId: alert.id,
            coordinatorId: alert.coordinator_user_id,
          });
          continue;
        }

        if (!alert.voice_message_url) {
          logError('Cannot escalate alert: missing voice message URL', undefined, {
            alertId: alert.id,
          });
          continue;
        }

        try {
          const callResult = await this.getVoiceService().initiateCall(
            alert.backup_coordinator_phone,
            alert.voice_message_url,
            { alertId: alert.id }
          );

          const updateResult = await this.pgPool.query(
            `
              UPDATE care_alerts
              SET status = 'escalated',
                  escalated_at = NOW(),
                  updated_at = NOW(),
                  coordinator_id = $2,
                  call_sid = COALESCE($3, call_sid)
              WHERE id = $1
                AND escalated_at IS NULL
            `,
            [alert.id, alert.backup_coordinator_user_id, callResult.callSid]
          );

          if (updateResult.rowCount === 0) {
            logDebug('Escalation skipped due to status change', {
              alertId: alert.id,
            });
            continue;
          }

          logInfo('Alert escalated to backup coordinator', {
            alertId: alert.id,
            backupCoordinatorId: alert.backup_coordinator_user_id,
            callSid: callResult.callSid,
          });

          if (alert.caregiver_phone) {
            try {
              const caregiverMessage = this.buildCaregiverEscalationMessage(alert);
              await this.getSmsService().sendSMS(
                alert.caregiver_phone,
                caregiverMessage,
                alert.backup_coordinator_user_id
              );

              logInfo('Caregiver notified of escalation', {
                alertId: alert.id,
                caregiverPhone: alert.caregiver_phone,
              });
            } catch (error) {
              logError(
                'Failed to notify caregiver of escalation',
                error instanceof Error ? error : undefined,
                {
                  alertId: alert.id,
                  caregiverPhone: alert.caregiver_phone,
                }
              );
            }
          } else {
            logDebug('Caregiver escalation notification skipped (no phone number)', {
              alertId: alert.id,
            });
          }
        } catch (error) {
          logError(
            'Failed to escalate alert to backup coordinator',
            error instanceof Error ? error : undefined,
            {
              alertId: alert.id,
              backupCoordinatorId: alert.backup_coordinator_user_id,
            }
          );
        }
      }
    } finally {
      client.release();
    }
  }

  private buildCoordinatorReminderMessage(alert: CoordinatorReminderRow): string {
    const clientName = `${alert.client_first_name} ${alert.client_last_name}`.trim();
    const caregiverName =
      `${alert.caregiver_first_name ?? ''} ${alert.caregiver_last_name ?? ''}`.trim();
    const caregiverPhone = alert.caregiver_phone ? `Call ${alert.caregiver_phone}` : '';
    const voiceMessage = alert.voice_message_url ? `Message: ${alert.voice_message_url}` : '';

    return [
      `URGENT alert for ${clientName}`,
      caregiverName ? `from ${caregiverName}` : null,
      caregiverPhone || null,
      voiceMessage || null,
    ]
      .filter(Boolean)
      .join(' • ');
  }

  private buildCaregiverEscalationMessage(alert: BackupEscalationRow): string {
    const clientName = `${alert.client_first_name} ${alert.client_last_name}`.trim();
    const backupName =
      `${alert.backup_coordinator_first_name ?? ''} ${alert.backup_coordinator_last_name ?? ''}`.trim();

    return [
      `Escalated alert for ${clientName}.`,
      backupName ? `${backupName} is calling now.` : 'Backup coordinator is calling now.',
      'We will keep you updated.',
    ].join(' ');
  }

  private getSmsService(): SmsServiceLike {
    if (this.smsService) {
      return this.smsService;
    }
    return new TwilioSMSService();
  }

  private getVoiceService(): VoiceServiceLike {
    if (this.voiceService) {
      return this.voiceService;
    }
    return new TwilioVoiceService();
  }
}
