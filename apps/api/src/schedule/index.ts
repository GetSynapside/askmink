import nodemailer from 'nodemailer';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { AskminkDb } from '@askmink/db';
import { availabilityBlocks, availabilityRules, bookings } from '@askmink/db';
import type { AppConfig } from '../config.js';

export class BookingConflictError extends Error {
  constructor(message = 'This time slot is already booked') {
    super(message);
    this.name = 'BookingConflictError';
  }
}

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function generateBookingIcs(booking: {
  id: string;
  agentName: string;
  visitorName: string;
  visitorEmail: string;
  startsAt: Date;
  endsAt: Date;
  notes?: string;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Askmink//Native Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${booking.id}@askmink`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(booking.startsAt)}`,
    `DTEND:${formatIcsDate(booking.endsAt)}`,
    `SUMMARY:${escapeIcsText(`Meeting with ${booking.agentName} — ${booking.visitorName}`)}`,
    `DESCRIPTION:${escapeIcsText(booking.notes || 'Scheduled via Askmink')}`,
    `ATTENDEE;CN=${escapeIcsText(booking.visitorName)}:mailto:${booking.visitorEmail}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

export async function getAvailableSlots(params: {
  db: AskminkDb;
  agentId: string;
  daysAhead?: number;
}): Promise<Array<{ startsAt: string; endsAt: string; label: string; timezone: string }>> {
  const { db, agentId, daysAhead = 7 } = params;
  const rules = await db.query.availabilityRules.findMany({
    where: and(eq(availabilityRules.agentId, agentId), eq(availabilityRules.enabled, true)),
  });
  if (rules.length === 0) return [];

  const now = new Date();
  const rangeEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const [blocks, existingBookings] = await Promise.all([
    db.query.availabilityBlocks.findMany({
      where: and(
        eq(availabilityBlocks.agentId, agentId),
        lte(availabilityBlocks.startsAt, rangeEnd),
        gte(availabilityBlocks.endsAt, now)
      ),
    }),
    db.query.bookings.findMany({
      where: and(
        eq(bookings.agentId, agentId),
        eq(bookings.status, 'confirmed'),
        lte(bookings.startsAt, rangeEnd),
        gte(bookings.endsAt, now)
      ),
    }),
  ]);

  const slots: Array<{ startsAt: string; endsAt: string; label: string; timezone: string }> = [];

  for (let d = 0; d < daysAhead; d++) {
    const dayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d));
    const dow = dayDate.getUTCDay();
    const matchingRules = rules.filter((r) => r.dayOfWeek === dow);

    for (const rule of matchingRules) {
      const [sh, sm] = rule.startTime.split(':').map(Number);
      const [eh, em] = rule.endTime.split(':').map(Number);
      const startMinutes = (sh ?? 9) * 60 + (sm ?? 0);
      const endMinutes = (eh ?? 17) * 60 + (em ?? 0);
      const step = rule.slotDurationMinutes;

      for (let m = startMinutes; m + step <= endMinutes; m += step) {
        const slotStart = new Date(dayDate.getTime() + m * 60 * 1000);
        const slotEnd = new Date(slotStart.getTime() + step * 60 * 1000);
        if (slotStart <= now) continue;

        const overlapsBlock = blocks.some(
          (b) => slotStart < b.endsAt && slotEnd > b.startsAt
        );
        const overlapsBooking = existingBookings.some(
          (b) => slotStart < b.endsAt && slotEnd > b.startsAt
        );

        if (!overlapsBlock && !overlapsBooking) {
          slots.push({
            startsAt: slotStart.toISOString(),
            endsAt: slotEnd.toISOString(),
            label: `${slotStart.toISOString().slice(0, 10)} ${slotStart.toISOString().slice(11, 16)} UTC`,
            timezone: rule.timezone,
          });
        }
        if (slots.length >= 24) return slots;
      }
    }
  }

  return slots;
}

export async function createAtomicBooking(
  db: AskminkDb,
  data: {
    workspaceId: string;
    agentId: string;
    conversationId?: string;
    visitorName: string;
    visitorEmail: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    notes?: string;
  }
) {
  if (data.endsAt <= data.startsAt) {
    throw new Error('Booking end time must be after start time');
  }
  try {
    const [created] = await db.transaction(async (tx) => {
      // Serialize concurrent bookings per agentId so overlapping GiST inserts hit 23P01 cleanly instead of 40P01 deadlocking
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${data.agentId}::text))`);
      return tx
        .insert(bookings)
        .values({
          workspaceId: data.workspaceId,
          agentId: data.agentId,
          conversationId: data.conversationId ?? null,
          visitorName: data.visitorName,
          visitorEmail: data.visitorEmail,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          timezone: data.timezone,
          notes: data.notes ?? '',
          status: 'confirmed',
        })
        .returning();
    });
    return created!;
  } catch (err: any) {
    // PostgreSQL 23P01 = exclusion_violation from bookings_no_overlap GiST constraint
    // PostgreSQL 40P01 = deadlock_detected (defensive fallback if concurrent GiST contention occurs)
    const codes = [err?.code, err?.cause?.code];
    if (codes.includes('23P01') || codes.includes('40P01')) {
      throw new BookingConflictError();
    }
    throw err;
  }
}

export async function sendBookingEmailIfConfigured(
  config: AppConfig,
  params: {
    to: string;
    subject: string;
    text: string;
    icsContent: string;
  }
): Promise<boolean> {
  if (!config.smtp) {
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });

  await transporter.sendMail({
    from: config.smtp.from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    attachments: [
      {
        filename: 'invite.ics',
        content: params.icsContent,
        contentType: 'text/calendar; method=REQUEST',
      },
    ],
  });
  return true;
}
