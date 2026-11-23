import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { IdentityService } from '@modules/01-identity/identity.service';
import {
  CreateSalesStaffDto,
  SetSalesStaffActiveDto,
} from './dto/platform-admin.dto';

@Injectable()
export class AdminStaffService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
    private readonly identityService: IdentityService,
  ) {}

  async listStaff() {
    const staff = await this.prismaService.user.findMany({
      where: { role: Role.SALES_STAFF },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        phoneE164: true,
        isActive: true,
        preferredLanguage: true,
        createdAt: true,
      },
    });

    return {
      count: staff.length,
      staff: staff.map((member) => ({
        userId: member.id,
        fullName: member.fullName,
        phoneE164: member.phoneE164,
        isActive: member.isActive,
        preferredLanguage: member.preferredLanguage,
        createdAt: member.createdAt.toISOString(),
      })),
    };
  }

  async createSalesStaff(dto: CreateSalesStaffDto) {
    const phoneE164 = dto.phoneE164.trim();
    const existing = await this.prismaService.user.findUnique({
      where: { phoneE164 },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A user with this Tanzanian phone number already exists.');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    const smsHmacSecret = randomBytes(32).toString('hex');
    const language = dto.preferredLanguage ?? 'sw';

    const created = await this.prismaService.runInTransaction('ReadCommitted', async (tx) => {
      const user = await tx.user.create({
        data: {
          phoneE164,
          fullName: dto.fullName.trim(),
          passwordHash,
          role: Role.SALES_STAFF,
          preferredLocale: language,
          preferredLanguage: language,
          smsHmacSecret,
          isActive: true,
        },
        select: { id: true, fullName: true, phoneE164: true, role: true },
      });

      await tx.securityAuditLog.create({
        data: {
          userId: user.id,
          eventType: 'STAFF_ACCOUNT_CREATED',
          details: { role: Role.SALES_STAFF, createdBySystem: true },
        },
      });

      await this.outboxService.enqueue(
        {
          aggregateType: 'User',
          aggregateId: user.id,
          eventType: 'SalesStaffCreatedEvent',
          routingKey: 'identity.sales_staff.created',
          payload: {
            userId: user.id,
            phoneE164: user.phoneE164,
            role: user.role,
          },
        },
        tx,
      );

      return user;
    });

    return {
      userId: created.id,
      fullName: created.fullName,
      phoneE164: created.phoneE164,
      role: created.role,
      isActive: true,
    };
  }

  async setSalesStaffActive(
    userId: string,
    dto: SetSalesStaffActiveDto,
    adminUserId: string,
  ) {
    if (userId === adminUserId) {
      throw new BadRequestException('You cannot change your own staff account status.');
    }

    const staff = await this.prismaService.user.findFirst({
      where: { id: userId, role: Role.SALES_STAFF },
      select: { id: true, fullName: true, isActive: true },
    });
    if (!staff) {
      throw new NotFoundException('Sales staff account was not found.');
    }

    await this.prismaService.runInTransaction('ReadCommitted', async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isActive: dto.isActive },
      });

      if (!dto.isActive) {
        await tx.refreshSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await tx.securityAuditLog.create({
        data: {
          userId,
          eventType: dto.isActive ? 'STAFF_REACTIVATED' : 'STAFF_DEACTIVATED',
          details: { adminUserId, staffName: staff.fullName, auditId: randomUUID() },
        },
      });
    });

    // JwtAuthGuard does not read isActive, so kill any live access token too.
    if (!dto.isActive) {
      this.identityService.revokeAccessToken(undefined, userId);
    }

    return {
      userId,
      fullName: staff.fullName,
      isActive: dto.isActive,
    };
  }
}
