import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities/user.entity';

export const SESSION_COOKIE_NAME = 'calltracer_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

export interface SessionPayload {
  uid: number;
  username: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret: string;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    const configured = this.configService.get<string>('SESSION_SECRET');
    if (configured) {
      this.secret = configured;
    } else {
      this.secret = crypto.randomBytes(32).toString('hex');
      this.logger.warn(
        'SESSION_SECRET не задан в .env — используется случайный секрет на время работы процесса, ' +
          'все сессии сбросятся при перезапуске. Задайте SESSION_SECRET в .env для прод-окружения.',
      );
    }
  }

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user || !user.active) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  createSessionCookie(user: User): string {
    const payload: SessionPayload & { exp: number } = {
      uid: user.id,
      username: user.username,
      exp: Date.now() + SESSION_TTL_MS,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const sig = crypto
      .createHmac('sha256', this.secret)
      .update(payloadB64)
      .digest('base64url');
    return `${payloadB64}.${sig}`;
  }

  verifySessionCookie(value: string | undefined): SessionPayload | null {
    if (!value) return null;
    const dotIndex = value.lastIndexOf('.');
    if (dotIndex === -1) return null;
    const payloadB64 = value.slice(0, dotIndex);
    const sig = value.slice(dotIndex + 1);

    const expectedSig = crypto
      .createHmac('sha256', this.secret)
      .update(payloadB64)
      .digest('base64url');
    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig)))
      return null;

    try {
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );
      if (typeof payload?.exp !== 'number' || payload.exp < Date.now())
        return null;
      if (
        typeof payload?.uid !== 'number' ||
        typeof payload?.username !== 'string'
      )
        return null;
      return { uid: payload.uid, username: payload.username };
    } catch {
      return null;
    }
  }
}
