import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AttendanceQrPayload {
  type: 'attendance_qr';
  tenantId: string;
  generatedByMembershipId: string;
  lat: number;
  lng: number;
}

// How long a generated QR stays scannable. The frontend regenerates a fresh
// one every 30s, so this only needs a little headroom beyond that for
// network/render lag -- not so long that a photographed QR is useful once
// its holder has walked away.
export const ATTENDANCE_QR_TTL_SECONDS = 45;

// Signs/verifies the QR payload with the same secret used for access tokens
// (JwtService is already wired up for that), distinguished by its own
// `type` claim so an attendance QR can never be replayed as an access token
// or vice versa.
@Injectable()
export class AttendanceQrTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(payload: Omit<AttendanceQrPayload, 'type'>): string {
    return this.jwt.sign({ ...payload, type: 'attendance_qr' }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: `${ATTENDANCE_QR_TTL_SECONDS}s` });
  }

  verify(token: string): AttendanceQrPayload {
    let payload: AttendanceQrPayload;
    try {
      payload = this.jwt.verify<AttendanceQrPayload>(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException({ error: 'expired_qr', message: 'This QR code has expired. Ask for a fresh one.' });
    }
    if (payload.type !== 'attendance_qr') {
      throw new UnauthorizedException({ error: 'invalid_qr', message: 'Not a valid attendance QR code.' });
    }
    return payload;
  }
}
