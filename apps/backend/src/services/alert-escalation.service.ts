import { Pool } from 'pg';

import { logDebug, logError, logInfo, logWarn } from '../config/logger';

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
  reminderThresholdMinutes?: number;
  escalationThresholdMinutes?: number;
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
 * 1. Remind coordinators via SMS when alerts remain unanswered (default: 5 minutes)
 * 2. Escalate to backup coordinators after threshold (default: 10 minutes) with voice call + caregiver SMS
 */
export class AlertEscalationService {
  private smsService?: SmsServiceLike;
  private voiceService?: VoiceServiceLike;
  private readonly now: () => Date;
  private readonly reminderThresholdMinutes: number;
  private readonly escalationThresholdMinutes: number;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly pgPool: Pool,
    dependencies: AlertEscalationDependencies = {}
  ) {
    this.smsService = dependencies.smsService;
    this.voiceService = dependencies.voiceService;
    this.now = dependencies.now ?? (() => new Date());
    this.reminderThresholdMinutes = dependencies.reminderThresholdMinutes ?? 5;
    this.escalationThresholdMinutes = dependencies.escalationThresholdMinutes ?? 10;
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
    }

    const pollIntervalMs = 100;
    const timeoutMs = 10_000;
    const startTime = Date.now();

    while (this.isRunning && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    if (this.isRunning) {
      logWarn('Alert escalation service stop timed out waiting for in-flight run to finish', {
        timeoutMs,
      });
    } else {
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
    const reminderThreshold = new Date(
      this.now().getTime() - this.reminderThresholdMinutes * 60 * 1000
    );

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
          // Send SMS first before updating status
          const message = this.buildCoordinatorReminderMessage(alert);
          await this.getSmsService().sendSMS(
            alert.coordinator_phone,
            message,
            alert.coordinator_user_id
          );

          // Only update status after successful SMS delivery
          const updateResult = await client.query(
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
            logDebug('Coordinator reminder status update skipped due to status change', {
              alertId: alert.id,
            });
            continue;
          }

          logInfo('Coordinator reminder SMS sent and status updated', {
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
          // Alert remains in 'initiated' status and will be retried
        }
      }
    } finally {
      client.release();
    }
  }

  private async processBackupEscalations(): Promise<void> {
    const escalationThreshold = new Date(
      this.now().getTime() - this.escalationThresholdMinutes * 60 * 1000
    );

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
          OR ca.status = 'initiated'
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

        let callResult: Awaited<ReturnType<VoiceServiceLike['initiateCall']>> | undefined;

        try {
          await client.query('BEGIN');

          try {
            const claimResult = await client.query(
              `
                UPDATE care_alerts
                SET status = 'escalated',
                    escalated_at = NOW(),
                    updated_at = NOW(),
                    coordinator_id = $2
                WHERE id = $1
                  AND escalated_at IS NULL
                  AND (status = 'initiated' OR status = 'no_answer')
                RETURNING id
              `,
              [alert.id, alert.backup_coordinator_user_id]
            );

            if (claimResult.rowCount === 0) {
              await client.query('ROLLBACK');
              logDebug('Escalation skipped due to status change', {
                alertId: alert.id,
              });
              continue;
            }

            // Initiate voice call before committing transaction (with 30s timeout)
            callResult = await Promise.race([
              this.getVoiceService().initiateCall(
                alert.backup_coordinator_phone,
                alert.voice_message_url,
                { alertId: alert.id }
              ),
              new Promise<CallResult>((_, reject) =>
                setTimeout(() => reject(new Error('Voice call initiation timeout (30s)')), 30000)
              ),
            ]);

            // Update alert with call SID (or null if call failed)
            if (callResult?.callSid) {
              await client.query(
                `
                  UPDATE care_alerts
                  SET call_sid = $2,
                      updated_at = NOW()
                  WHERE id = $1
                `,
                [alert.id, callResult.callSid]
              );
            } else {
              logWarn('Voice service did not return a call SID for escalated alert', {
                alertId: alert.id,
                backupCoordinatorId: alert.backup_coordinator_user_id,
              });
            }

            // Commit transaction regardless of call SID status
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            logError('Failed to escalate alert', error instanceof Error ? error : undefined, {
              alertId: alert.id,
              backupCoordinatorId: alert.backup_coordinator_user_id,
            });
            continue;
          }

          logInfo('Alert escalated to backup coordinator', {
            alertId: alert.id,
            backupCoordinatorId: alert.backup_coordinator_user_id,
            callSid: callResult?.callSid || null,
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
    this.smsService = new TwilioSMSService();
    return this.smsService;
  }

  private getVoiceService(): VoiceServiceLike {
    if (this.voiceService) {
      return this.voiceService;
    }
    this.voiceService = new TwilioVoiceService();
    return this.voiceService;
  }
}
