import { Injectable, Logger } from '@nestjs/common';

// Sends via Resend's REST API directly (no SDK dependency needed for one call).
// Requires RESEND_API_KEY + RESEND_FROM_EMAIL env vars, which is a manual setup
// step for whoever owns this deployment: create a Resend account, verify a
// sending domain, generate an API key. Without a key configured, this logs the
// email instead of sending it -- the reset/invite flow still works end-to-end
// for testing, it just doesn't leave this server.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private get apiKey() {
    return process.env.RESEND_API_KEY;
  }

  private get fromAddress() {
    return process.env.RESEND_FROM_EMAIL ?? 'Puggey <onboarding@resend.dev>';
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(`[email not configured] would send to ${to}: ${subject}\n${html}`);
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.fromAddress, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Resend API error ${res.status}: ${body}`);
      // Deliberately not thrown: a transactional email failing should not surface
      // as a 500 to the user, especially on forgot-password where the response
      // must stay generic regardless of what happened server-side.
    }
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    await this.send(
      to,
      'Reset your Puggey password',
      `<p>Someone requested a password reset for this email on Puggey.</p>
       <p><a href="${resetUrl}">Click here to set a new password</a>. This link expires in 1 hour.</p>
       <p>If you didn't request this, you can ignore this email.</p>`,
    );
  }
}
