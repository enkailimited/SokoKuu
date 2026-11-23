import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, randomInt, randomUUID } from 'crypto';
import { UserRole } from '@prisma/client';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import {
  ConvertLeadDto,
  CreateLeadDto,
  PublicLeadDto,
} from './dto/platform-admin.dto';

export function buildSwahiliLeadActivationSms(merchantName: string, pin4: string): string {
  const cleanName = merchantName.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 32) || 'Mfanyabiashara';
  const msg = `Karibu SokoKuu TZ! Akaunti ya ${cleanName} imethibitishwa. PIN ya kuingia: ${pin4}. Tumia app kukamilisha usajili.`;
  return msg.length <= 160 ? msg : msg.slice(0, 160);
}

@Injectable()
export class SalesLeadsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  async listLeads(status?: string) {
    const normalizedStatus =
      status && ['PROSPECT', 'CONVERTED', 'ARCHIVED'].includes(status.toUpperCase())
        ? (status.toUpperCase() as 'PROSPECT' | 'CONVERTED' | 'ARCHIVED')
        : undefined;

    const leads = await this.prismaService.sokoLead.findMany({
      where: normalizedStatus ? { status: normalizedStatus } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return {
      count: leads.length,
      leads: leads.map((lead) => ({
        leadId: lead.id,
        merchantName: lead.merchantName,
        ownerName: lead.ownerName,
        ownerPhoneE164: lead.ownerPhoneE164,
        wardName: lead.wardName,
        businessTier: lead.businessTier,
        latitude: lead.latitude,
        longitude: lead.longitude,
        gpsAccuracyMeters: lead.gpsAccuracyMeters,
        quoteRequest: lead.quoteRequest,
        status: lead.status,
        version: Number(lead.version),
        convertedBusinessId: lead.convertedBusinessId,
        capturedAtEat: lead.createdAt.toISOString(),
        convertedAtEat: lead.convertedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Public registration / quote requests arrive without an authenticated
   * field agent. Attribute them to the platform's Super Admin lead inbox so
   * the team sees them in the standard Sales Leads dashboard.
   */
  async capturePublicProspectLead(dto: PublicLeadDto) {
    const leadInboxAgent = await this.prismaService.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!leadInboxAgent) {
      throw new ServiceUnavailableException(
        'Public lead inbox is not configured. Please contact SokoKuu support.',
      );
    }

    const created = await this.captureProspectLead(dto, leadInboxAgent.id);
    return {
      ...created,
      message: 'Lead received. SokoKuu team will contact you to complete verification.',
    };
  }

  async captureProspectLead(dto: CreateLeadDto | PublicLeadDto, agentUserId: string) {
    const leadId = randomUUID();
    const accuracy = dto.gpsAccuracyMeters ?? 10;
    const capturedBy = ('agentId' in dto ? dto.agentId : undefined) ?? agentUserId;

    return this.prismaService.runInTransaction('ReadCommitted', async (tx) => {
      try {
        await tx.$executeRaw`
          INSERT INTO soko_leads (
            id,
            shop_name,
            owner_name,
            owner_phone_e164,
            ward_name,
            business_tier,
            latitude,
            longitude,
            gps_accuracy_meters,
            quote_request,
            location,
            status,
            version,
            captured_by_agent_id
          ) VALUES (
            ${leadId}::uuid,
            ${dto.merchantName.trim()},
            ${dto.ownerName.trim()},
            ${dto.ownerPhoneE164.trim()},
            ${dto.wardName.trim()},
            ${dto.businessTier}::business_tier,
            ${dto.latitude}::double precision,
            ${dto.longitude}::double precision,
            ${accuracy}::integer,
            ${dto.quoteRequest?.trim() ?? ''}::text,
            ST_SetSRID(ST_MakePoint(${dto.longitude}::double precision, ${dto.latitude}::double precision), 4326)::geography,
            'PROSPECT'::lead_status,
            1,
            ${capturedBy}::uuid
          )
        `;
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          throw new ConflictException('A lead with this owner phone number already exists.');
        }
        throw error;
      }

      return {
        leadId,
        merchantName: dto.merchantName.trim(),
        status: 'PROSPECT',
        version: 1,
        storageCluster: 'SokoKuu Cloud SQL Database Cluster',
        capturedAtEat: new Date().toISOString(),
      };
    });
  }

  async convertLeadToMerchant(leadId: string, dto: ConvertLeadDto, adminUserId: string) {
    const deviceSmsPin4 = String(randomInt(1000, 10000));
    const temporaryPassword = randomBytes(12).toString('base64url');
    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    const smsHmacSecret = randomBytes(32).toString('hex');
    const businessId = randomUUID();
    const shortCode = `M${randomBytes(3).toString('hex').toUpperCase()}`;

    return this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
      const existingLead = await tx.sokoLead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          merchantName: true,
          ownerName: true,
          ownerPhoneE164: true,
          wardName: true,
          businessTier: true,
          latitude: true,
          longitude: true,
          status: true,
          version: true,
          convertedBusinessId: true,
          convertedAt: true,
        },
      });

      if (!existingLead) {
        throw new NotFoundException(`Field lead ${leadId} was not found.`);
      }

      // Idempotent return: if this lead was already converted, return the
      // existing merchant instead of throwing an optimistic-lock conflict.
      if (existingLead.status === 'CONVERTED' && existingLead.convertedBusinessId) {
        return {
          leadId,
          merchantId: existingLead.convertedBusinessId,
          ownerUserId: null,
          merchantName: existingLead.merchantName,
          smsShortCode: null,
          isPlatformManaged: true,
          geospatialMapEnabled: false,
          status: 'CONVERTED',
          newVersion: Number(existingLead.version),
          nextSmsQueued: false,
          convertedAtEat:
            existingLead.convertedAt?.toISOString?.() ??
            new Date().toISOString(),
        };
      }

      // Strict Optimistic Lock: only 1 concurrent worker with matching version & PROSPECT status succeeds
      const updatedRows = await tx.$executeRaw`
        UPDATE soko_leads
           SET status = 'CONVERTED'::lead_status,
               version = version + 1,
               converted_by_admin_id = ${adminUserId}::uuid,
               converted_at = NOW(),
               updated_at = NOW()
         WHERE id = ${leadId}::uuid
           AND ${businessId}::uuid IS NOT NULL
           AND version = ${BigInt(dto.expectedVersion)}
           AND status = 'PROSPECT'::lead_status
      `;

      if (updatedRows === 0) {
        throw new ConflictException(
          'Optimistic lock conflict: this Merchant lead was already converted or modified concurrently.',
        );
      }

      const ownerRole =
        existingLead.businessTier === 'WHOLESALE' ? 'WHOLESALER' : 'RETAILER';

      let ownerUser = await tx.user.findUnique({
        where: { phoneE164: existingLead.ownerPhoneE164 },
        select: { id: true },
      });

      if (!ownerUser) {
        ownerUser = await tx.user.create({
          data: {
            phoneE164: existingLead.ownerPhoneE164,
            fullName: existingLead.ownerName,
            passwordHash,
            role: ownerRole,
            preferredLocale: 'sw',
            smsHmacSecret,
          },
          select: { id: true },
        });
      }

      await tx.$executeRaw`
        INSERT INTO business_profiles (
          id,
          owner_user_id,
          sms_short_code,
          business_name,
          tier,
          street_address,
          ward,
          district,
          latitude,
          longitude,
          is_open,
          is_platform_managed,
          geospatial_map_enabled
        ) VALUES (
          ${businessId}::uuid,
          ${ownerUser.id}::uuid,
          ${shortCode},
          ${existingLead.merchantName},
          ${existingLead.businessTier}::business_tier,
          ${dto.streetAddress?.trim() || existingLead.wardName},
          ${existingLead.wardName},
          ${dto.district?.trim() || 'Dar es Salaam'},
          ${existingLead.latitude}::numeric(9,6),
          ${existingLead.longitude}::numeric(9,6),
          TRUE,
          TRUE,
          FALSE
        )
      `;

      // Link the converted business after it exists (avoids FK violation).
      await tx.$executeRaw`
        UPDATE soko_leads
           SET converted_business_id = ${businessId}::uuid,
               updated_at = NOW()
         WHERE id = ${leadId}::uuid
      `;

      const smsMessage = buildSwahiliLeadActivationSms(
        existingLead.merchantName,
        deviceSmsPin4,
      );

      await this.outboxService.enqueue(
        {
          aggregateType: 'SokoLead',
          aggregateId: leadId,
          eventType: 'LeadConvertedEvent',
          routingKey: 'sales.lead.converted',
          payload: {
            leadId,
            merchantId: businessId,
            merchantName: existingLead.merchantName,
            ownerUserId: ownerUser.id,
            ownerPhoneE164: existingLead.ownerPhoneE164,
            smsShortCode: shortCode,
            deviceSmsPin4,
            smsMessage,
            smsLength: smsMessage.length,
          },
        },
        tx,
      );

      return {
        leadId,
        merchantId: businessId,
        ownerUserId: ownerUser.id,
        merchantName: existingLead.merchantName,
        smsShortCode: shortCode,
        isPlatformManaged: true,
        geospatialMapEnabled: false,
        status: 'CONVERTED',
        newVersion: dto.expectedVersion + 1,
        nextSmsQueued: true,
        convertedAtEat: new Date().toISOString(),
      };
    });
  }
}
